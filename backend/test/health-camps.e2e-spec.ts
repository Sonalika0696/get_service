import { randomUUID, createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { AccountKind, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 12 M9 — health camps, end-to-end against real Postgres,
 * RAZORPAY_ENABLED false (same deterministic-stub assumption as every other
 * suite in this codebase). Covers this lane's brief DoD:
 *  - committee creates a camp with 2 slots (capacity 1 each);
 *  - a racing double-registration on one slot: exactly one succeeds;
 *  - a paid registration captured via the signed webhook credits EVENTS;
 *  - the roster returns EXACTLY the 4 allowed keys (I5);
 *  - cancelling the camp refunds and reverses EVENTS via the refund webhook;
 *  - a resident cannot register after close / for another camp's slot;
 *  - a non-officer gets 403 on create and roster.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

interface SlotBody {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  remaining: number;
}

interface CampBody {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';
  slots?: SlotBody[];
  slotCount?: number;
}

interface RegistrationBody {
  id: string;
  campId: string;
  slotId: string;
  flatId: string;
  attendeeName: string;
  status: 'REGISTERED' | 'CANCELLED';
  amountDue: string | number;
  paidAmount: string | number;
  paymentId: string | null;
}

interface RosterRowBody {
  attendeeName: string;
  flatUnitNo: string;
  slotStartsAt: string;
  slotEndsAt: string;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

describe('Health camps (e2e) — Phase 12 M9', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(email: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId, flatId, role })
      .expect(201);

    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);

    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }
  type Fixture = Awaited<ReturnType<typeof signupAndLogin>>;

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  function signWebhook(body: string): string {
    return createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  function postWebhook(body: string, signature: string) {
    return request(app.getHttpServer()).post('/api/v1/payments/webhook').set('content-type', 'application/json').set('x-razorpay-signature', signature).send(body);
  }

  async function payRegistration(paymentId: string, amountRupees: number): Promise<void> {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const razorpayPaymentId = `pay_stub_${randomUUID().slice(0, 8)}`;
    const eventId = `evt_${randomUUID()}`;
    webhookEventIds.push(eventId);
    const event = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: razorpayPaymentId, order_id: payment.orderId, amount: Math.round(amountRupees * 100), status: 'captured' } } },
    };
    const bodyStr = JSON.stringify(event);
    await postWebhook(bodyStr, signWebhook(bodyStr)).expect(200);

    lastCapturedRazorpayPaymentId.set(paymentId, razorpayPaymentId);
  }
  const lastCapturedRazorpayPaymentId = new Map<string, string>();

  async function refundRegistration(paymentId: string, amountRupees: number): Promise<void> {
    const razorpayPaymentId = lastCapturedRazorpayPaymentId.get(paymentId);
    if (!razorpayPaymentId) throw new Error(`No captured razorpay payment id for ${paymentId}`);
    const eventId = `evt_rf_${randomUUID()}`;
    webhookEventIds.push(eventId);
    const event = {
      id: eventId,
      event: 'refund.processed',
      payload: { refund: { entity: { id: `rfnd_${randomUUID().slice(0, 8)}`, payment_id: razorpayPaymentId, amount: Math.round(amountRupees * 100) } } },
    };
    const bodyStr = JSON.stringify(event);
    await postWebhook(bodyStr, signWebhook(bodyStr)).expect(200);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
  }

  function isoOnDay(day: Date, hour: number): string {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0)).toISOString();
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    const config = app.get(AppConfigService);
    webhookSecret = config.env.RAZORPAY_WEBHOOK_SECRET;
    expect(config.env.RAZORPAY_ENABLED).toBe(false);

    const society = await prisma.society.create({ data: { name: 'Health Camps Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 12; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `HC-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.campRegistration.deleteMany({ where: { camp: { societyId } } });
    await prisma.healthCampSlot.deleteMany({ where: { camp: { societyId } } });
    await prisma.healthCamp.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  let committee: Fixture;
  let resident1: Fixture;
  let resident2: Fixture;
  let resident3: Fixture;
  let resident4: Fixture;

  beforeAll(async () => {
    committee = await signupAndLogin(`hc-committee-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    resident1 = await signupAndLogin(`hc-resident1-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    resident2 = await signupAndLogin(`hc-resident2-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    resident3 = await signupAndLogin(`hc-resident3-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    resident4 = await signupAndLogin(`hc-resident4-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
  });

  it('non-officer gets 403 on create and roster', async () => {
    const campDay = new Date(Date.now() + 5 * 86_400_000);
    await resident1.agent
      .post('/api/v1/health-camps')
      .send({
        providerName: 'Apollo Clinic',
        title: '403 probe camp',
        campDate: isoOnDay(campDay, 10),
        registrationClosesAt: isoOnDay(campDay, 8),
        chargePerRegistration: 0,
        slots: [{ startsAt: isoOnDay(campDay, 9), endsAt: isoOnDay(campDay, 10), capacity: 1 }],
      })
      .expect(403);

    await resident1.agent.get('/api/v1/health-camps/nonexistent/roster').expect(403);
  });

  it('HEADLINE: committee creates a camp with 2 slots (capacity 1 each); one racing slot allows exactly one registration; a paid registration captures via webhook and credits EVENTS; the roster returns exactly 4 keys; cancelling refunds and reverses EVENTS', async () => {
    const campDay = new Date(Date.now() + 5 * 86_400_000);

    const startLedger = await ledgerBalances(committee.agent);
    const eventsStart = balanceOf(startLedger, AccountKind.EVENTS);

    const createRes = await committee.agent
      .post('/api/v1/health-camps')
      .send({
        providerName: 'Apollo Clinic',
        title: 'General Health Camp',
        description: 'Free BP and sugar screening — bring your last checkup card',
        venue: 'Community Hall',
        campDate: isoOnDay(campDay, 18),
        registrationClosesAt: isoOnDay(campDay, 8),
        chargePerRegistration: 100,
        slots: [
          { startsAt: isoOnDay(campDay, 9), endsAt: isoOnDay(campDay, 10), capacity: 1 },
          { startsAt: isoOnDay(campDay, 10), endsAt: isoOnDay(campDay, 11), capacity: 1 },
        ],
      })
      .expect(201);
    const camp = createRes.body as CampBody;
    expect(camp.status).toBe('OPEN');

    const detail = (await resident1.agent.get(`/api/v1/health-camps/${camp.id}`).expect(200)).body as CampBody;
    expect(detail.slots).toHaveLength(2);
    const [slotA, slotB] = detail.slots!;
    expect(slotA.remaining).toBe(1);

    // --- Racing double-registration on slotA: exactly one succeeds.
    const [raceRes1, raceRes2] = await Promise.all([
      resident1.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotA.id, attendeeName: 'Resident One' }),
      resident2.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotA.id, attendeeName: 'Resident Two' }),
    ]);
    const statuses = [raceRes1.status, raceRes2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = raceRes1.status === 201 ? raceRes1 : raceRes2;
    const winnerFixture = raceRes1.status === 201 ? resident1 : resident2;
    const winningRegistration = winner.body as RegistrationBody;
    expect(winningRegistration.status).toBe('REGISTERED');
    expect(Number(winningRegistration.amountDue)).toBe(100);
    expect(winningRegistration.paymentId).toBeTruthy();

    const afterRaceDetail = (await resident1.agent.get(`/api/v1/health-camps/${camp.id}`).expect(200)).body as CampBody;
    expect(afterRaceDetail.slots!.find((s) => s.id === slotA.id)!.remaining).toBe(0);

    // A third resident registering the now-full slot is rejected too.
    await resident3.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotA.id, attendeeName: 'Resident Three' }).expect(409);

    // A duplicate attendee name for the SAME flat is rejected (409).
    await winnerFixture.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotB.id, attendeeName: winningRegistration.attendeeName }).expect(409);

    // --- Second slot: resident3 registers normally.
    const reg2Res = await resident3.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotB.id, attendeeName: 'Resident Three' }).expect(201);
    const reg2 = reg2Res.body as RegistrationBody;

    // --- Pay both registrations via the signed webhook — credits EVENTS.
    await payRegistration(winningRegistration.paymentId!, 100);
    await payRegistration(reg2.paymentId!, 100);

    const afterCaptureLedger = await ledgerBalances(committee.agent);
    expect(afterCaptureLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterCaptureLedger, AccountKind.EVENTS) - eventsStart).toBeCloseTo(200, 6);

    const paidReg = await prisma.campRegistration.findUniqueOrThrow({ where: { id: winningRegistration.id } });
    expect(Number(paidReg.paidAmount)).toBe(100);

    // --- Roster returns EXACTLY the 4 allowed keys, for both REGISTERED rows.
    const rosterRes = await committee.agent.get(`/api/v1/health-camps/${camp.id}/roster`).expect(200);
    const roster = rosterRes.body as RosterRowBody[];
    expect(roster).toHaveLength(2);
    for (const row of roster) {
      expect(Object.keys(row).sort()).toEqual(['attendeeName', 'flatUnitNo', 'slotEndsAt', 'slotStartsAt'].sort());
    }
    expect(roster.map((r) => r.attendeeName).sort()).toEqual([winningRegistration.attendeeName, 'Resident Three'].sort());

    // --- Cancelling the camp cancels registrations and refunds paid ones, reversing EVENTS.
    const cancelRes = await committee.agent.post(`/api/v1/health-camps/${camp.id}/cancel`).expect(201);
    expect((cancelRes.body as CampBody).status).toBe('CANCELLED');

    const cancelledRegs = await prisma.campRegistration.findMany({ where: { campId: camp.id } });
    expect(cancelledRegs.every((r) => r.status === 'CANCELLED')).toBe(true);

    await refundRegistration(winningRegistration.paymentId!, 100);
    await refundRegistration(reg2.paymentId!, 100);

    const afterRefundLedger = await ledgerBalances(committee.agent);
    expect(afterRefundLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterRefundLedger, AccountKind.EVENTS) - eventsStart).toBeCloseTo(0, 6);

    // Cannot register into a CANCELLED camp.
    await resident4.agent.post(`/api/v1/health-camps/${camp.id}/registrations`).send({ slotId: slotB.id, attendeeName: 'Late Comer' }).expect(400);
  });

  it('a resident cannot register after the registration close, nor for another camp\'s slot', async () => {
    const campDay = new Date(Date.now() + 6 * 86_400_000);
    const closedCampRes = await committee.agent
      .post('/api/v1/health-camps')
      .send({
        providerName: 'Wellness Trust',
        title: 'Already-closing camp',
        campDate: isoOnDay(campDay, 18),
        registrationClosesAt: new Date(Date.now() + 1000).toISOString(),
        chargePerRegistration: 0,
        slots: [{ startsAt: isoOnDay(campDay, 9), endsAt: isoOnDay(campDay, 10), capacity: 5 }],
      })
      .expect(201);
    const closedCamp = closedCampRes.body as CampBody;
    const detail = (await resident1.agent.get(`/api/v1/health-camps/${closedCamp.id}`).expect(200)).body as CampBody;
    const slotId = detail.slots![0].id;

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await committee.agent.post('/api/v1/health-camps/process-due').expect(201);

    await resident1.agent.post(`/api/v1/health-camps/${closedCamp.id}/registrations`).send({ slotId, attendeeName: 'Too Late' }).expect(400);

    // Another camp entirely, still OPEN — a slot id from camp A used against camp B is rejected.
    const otherCampDay = new Date(Date.now() + 7 * 86_400_000);
    const otherCampRes = await committee.agent
      .post('/api/v1/health-camps')
      .send({
        providerName: 'Wellness Trust',
        title: 'Other open camp',
        campDate: isoOnDay(otherCampDay, 18),
        registrationClosesAt: isoOnDay(otherCampDay, 8),
        chargePerRegistration: 0,
        slots: [{ startsAt: isoOnDay(otherCampDay, 9), endsAt: isoOnDay(otherCampDay, 10), capacity: 5 }],
      })
      .expect(201);
    const otherCamp = otherCampRes.body as CampBody;

    await resident1.agent.post(`/api/v1/health-camps/${otherCamp.id}/registrations`).send({ slotId, attendeeName: 'Wrong Camp Slot' }).expect(400);
  });
});
