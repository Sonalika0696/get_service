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
 * Phase 6.4 (BACKEND_PLAN.md Phase 6.4, M14) Definition of Done, end-to-end
 * against real Postgres, RAZORPAY_ENABLED=false (see bulk-buy.e2e-spec.ts's
 * own doc comment — the same stub is used here, no real money ever moves):
 * the N-officer approval ladder that replaces the old implied "SYSTEM +
 * TREASURER = 2" authorisation. bulk-buy.e2e-spec.ts / flow-b.e2e-spec.ts
 * keep covering the single-officer (rung 1) happy path under the DEFAULT
 * config (see approval-ladder.util.ts's DEFAULT_APPROVAL_CONFIG) — this
 * file is the ladder itself, under a CUSTOM config set via
 * PUT /bulk-buy/approval-config:
 *  - the config endpoint: set then read back;
 *  - rung 1 (amount <= lowerThreshold): 1 officer authorises AND executes;
 *  - rung 2 (lowerThreshold < amount <= upperThreshold): a plain resident
 *    gets 403; 1 officer is not enough (Payout stays PENDING); a SECOND
 *    DISTINCT officer — a DEPUTY_TREASURER, proving that role is live —
 *    executes the payout;
 *  - the SAME officer calling twice never increments the distinct count,
 *    so it alone never reaches a >1 rung;
 *  - concurrency: two DISTINCT officers racing the exact threshold-crossing
 *    call pay exactly once, ledger conservation holds throughout;
 *  - rung 3 (amount > upperThreshold): with a known 5-officer committee
 *    roster and majorityFraction 0.5 (so required = ceil(0.5*5) = 3), two
 *    officers racing CONCURRENTLY still leave the payout unpaid (negative
 *    control — the ladder doesn't just prevent double-pay, it also refuses
 *    to pay early under concurrent writes); a third (distinct) officer then
 *    completes it;
 *  - the milestone path (LARGE bookings) mirrors the payout path for rung 2,
 *    same-identity, and concurrency.
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

interface OfferBody {
  id: string;
}

interface PayoutBody {
  id: string;
  status: 'PENDING' | 'AUTHORISED' | 'PAID';
  amount: string | number;
}

interface MilestoneBody {
  id: string;
  status: 'PENDING' | 'AUTHORISED' | 'PAID';
  amount: string | number | null;
}

interface BookingBody {
  id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  payout: PayoutBody | null;
  milestones: MilestoneBody[];
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface ApprovalConfigBody {
  lowerThreshold: number;
  upperThreshold: number;
  majorityFraction: number;
}

function futureIso(ms = 86_400_000): string {
  return new Date(Date.now() + ms).toISOString();
}

describe('Approval ladder (e2e) — Phase 6.4 (M14)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  const societyIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventIds: string[] = [];
  const vendorIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(email: string, societyId: string, flatId: string, role: OccupancyRole) {
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
  type Officer = Awaited<ReturnType<typeof signupAndLogin>>;

  async function makeRole(societyId: string, userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  function signWebhook(body: string): string {
    return createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  function postWebhook(body: string, signature: string) {
    return request(app.getHttpServer()).post('/api/v1/payments/webhook').set('content-type', 'application/json').set('x-razorpay-signature', signature).send(body);
  }

  function capturedEvent(eventId: string, orderId: string, razorpayPaymentId: string, amountRupees: number) {
    webhookEventIds.push(eventId);
    return {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: razorpayPaymentId, order_id: orderId, amount: Math.round(amountRupees * 100), status: 'captured' } } },
    };
  }

  async function payCommitment(commitmentId: string, amountRupees: number): Promise<void> {
    const commitment = await prisma.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
    if (!commitment.paymentId) throw new Error(`Commitment ${commitmentId} has no linked Payment`);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: commitment.paymentId } });

    const razorpayPaymentId = `pay_stub_${randomUUID().slice(0, 8)}`;
    const event = capturedEvent(`evt_${randomUUID()}`, payment.orderId, razorpayPaymentId, amountRupees);
    const bodyStr = JSON.stringify(event);
    await postWebhook(bodyStr, signWebhook(bodyStr)).expect(200);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
  }

  /** Stands up a SMALL booking (offer -> 2 commits -> fire -> both pay -> both sign off -> COMPLETED), amount = 2 * unitPrice (0%-discount ladder). Returns the Booking id. */
  async function standUpSmallBooking(vendorId: string, committee: Officer, unitPrice: number, residentA: Officer, residentB: Officer): Promise<string> {
    const createRes = await committee.agent
      .post('/api/v1/offers')
      .send({ vendorId, category: 'Approval ladder test', title: `Ladder SMALL ${randomUUID()}`, unitPrice, deadline: futureIso(), discountLadder: [{ minN: 2, pct: 0 }] })
      .expect(201);
    const offer = createRes.body as OfferBody;

    await residentA.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    await residentB.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);

    const booking = await prisma.booking.findFirstOrThrow({ where: { sourceType: 'OFFER', sourceId: offer.id } });
    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    for (const c of commitments) {
      await payCommitment(c.id, unitPrice);
    }

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    for (const jc of jobCards) {
      const resident = jc.residentId === residentA.userId ? residentA : residentB;
      await resident.agent.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    return booking.id;
  }

  /** Stands up a LARGE booking with a single 100% milestone (retentionPct 10, so the ledger.post for retention set-aside is always > 0 — see authoriseMilestone). Returns {bookingId, milestoneId}. amount released by this milestone = 0.9 * (2 * unitPrice). */
  async function standUpLargeBooking(vendorId: string, committee: Officer, unitPrice: number, residentA: Officer, residentB: Officer): Promise<{ bookingId: string; milestoneId: string }> {
    const createRes = await committee.agent
      .post('/api/v1/offers')
      .send({
        vendorId,
        category: 'Approval ladder test',
        title: `Ladder LARGE ${randomUUID()}`,
        unitPrice,
        deadline: futureIso(),
        discountLadder: [{ minN: 2, pct: 0 }],
        tier: 'LARGE',
        milestoneTemplate: [{ name: 'Full payment', pct: 100 }],
        retentionPct: 10,
        retentionDays: 30,
      })
      .expect(201);
    const offer = createRes.body as OfferBody;

    await residentA.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    await residentB.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);

    const booking = await prisma.booking.findFirstOrThrow({ where: { sourceType: 'OFFER', sourceId: offer.id } });
    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    for (const c of commitments) {
      await payCommitment(c.id, unitPrice);
    }

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    for (const jc of jobCards) {
      const resident = jc.residentId === residentA.userId ? residentA : residentB;
      await resident.agent.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    const milestone = await prisma.milestone.findFirstOrThrow({ where: { bookingId: booking.id } });
    return { bookingId: booking.id, milestoneId: milestone.id };
  }

  async function createSocietyWithFlats(name: string, flatCount: number): Promise<{ societyId: string; vendorId: string; flatIds: string[] }> {
    const society = await prisma.society.create({ data: { name, address: 'n/a' } });
    societyIds.push(society.id);
    const flatIds: string[] = [];
    for (let i = 0; i < flatCount; i++) {
      const flat = await prisma.flat.create({ data: { societyId: society.id, unitNo: `L-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
    const vendor = await prisma.vendor.create({ data: { name: `${name} Vendor`, contactEmail: `vendor-${randomUUID()}@example.com` } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId: society.id } });
    return { societyId: society.id, vendorId: vendor.id, flatIds };
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
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId: { in: societyIds } } } } });
    await prisma.payout.deleteMany({ where: { booking: { societyId: { in: societyIds } } } });
    await prisma.milestoneAuthorisation.deleteMany({ where: { milestone: { booking: { societyId: { in: societyIds } } } } });
    await prisma.milestone.deleteMany({ where: { booking: { societyId: { in: societyIds } } } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId: { in: societyIds } } } });
    await prisma.booking.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.commitment.deleteMany({ where: { offer: { societyId: { in: societyIds } } } });
    await prisma.offer.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.payment.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.account.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  describe('SMALL payout ladder', () => {
    // Config for this whole describe block: lowerThreshold 1000, upperThreshold 5000,
    // majorityFraction 0.5 — rung 1 tests use total 800, rung 2 tests use total 3000.
    let societyId: string;
    let vendorId: string;
    let flatIds: string[];
    let committee: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Approval Ladder SMALL Society', 20);
      societyId = stood.societyId;
      vendorId = stood.vendorId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`al-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);

      const setRes = await committee.agent.put('/api/v1/bulk-buy/approval-config').send({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 }).expect(200);
      expect(setRes.body as ApprovalConfigBody).toEqual({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 });

      const getRes = await committee.agent.get('/api/v1/bulk-buy/approval-config').expect(200);
      expect(getRes.body as ApprovalConfigBody).toEqual({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 });
    });

    it('rung 1 (amount <= lowerThreshold): a single officer both authorises and executes the payout', async () => {
      const residentA = await signupAndLogin(`al-r1a-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-r1b-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-r1-treasurer-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);

      const bookingId = await standUpSmallBooking(vendorId, committee, 400, residentA, residentB); // total 800 <= 1000

      const res = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      const body = res.body as BookingBody;
      expect(body.payout!.status).toBe('PAID');
      expect(Number(body.payout!.amount)).toBe(800);

      const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: body.payout!.id } });
      expect(authorisations).toHaveLength(1);
      expect(authorisations[0].authoriserId).toBe(treasurer.userId);
    });

    it('rung 2 (lowerThreshold < amount <= upperThreshold): 403 for a plain resident, 1 officer is not enough, a second DISTINCT officer (DEPUTY_TREASURER) executes', async () => {
      const residentA = await signupAndLogin(`al-r2a-${randomUUID()}@example.com`, societyId, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-r2b-${randomUUID()}@example.com`, societyId, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-r2-treasurer-${randomUUID()}@example.com`, societyId, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      const deputy = await signupAndLogin(`al-r2-deputy-${randomUUID()}@example.com`, societyId, flatIds[7], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);
      const plainResident = await signupAndLogin(`al-r2-plain-${randomUUID()}@example.com`, societyId, flatIds[8], OccupancyRole.OWNER_OCCUPIER);

      const bookingId = await standUpSmallBooking(vendorId, committee, 1500, residentA, residentB); // total 3000, in (1000, 5000]

      // A plain resident (no TREASURER/DEPUTY_TREASURER/COMMITTEE role) is rejected outright.
      await plainResident.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(403);

      const firstRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      const firstBody = firstRes.body as BookingBody;
      expect(firstBody.payout).not.toBeNull();
      expect(firstBody.payout!.status).toBe('PENDING'); // 1 distinct officer, rung 2 needs 2 — not paid yet

      const secondRes = await deputy.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      const secondBody = secondRes.body as BookingBody;
      expect(secondBody.payout!.status).toBe('PAID'); // DEPUTY_TREASURER is a live officer role — this is the 2nd distinct approver
      expect(Number(secondBody.payout!.amount)).toBe(3000);

      const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: secondBody.payout!.id } });
      expect(authorisations).toHaveLength(2);
      expect(authorisations.map((a) => a.authoriserId).sort()).toEqual([treasurer.userId, deputy.userId].sort());
    });

    it('the SAME officer authorising twice never increments the distinct count — never reaches PAID on its own', async () => {
      const residentA = await signupAndLogin(`al-si-a-${randomUUID()}@example.com`, societyId, flatIds[9], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-si-b-${randomUUID()}@example.com`, societyId, flatIds[10], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-si-treasurer-${randomUUID()}@example.com`, societyId, flatIds[11], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);

      const bookingId = await standUpSmallBooking(vendorId, committee, 1500, residentA, residentB); // total 3000, rung 2 (needs 2 distinct)

      const firstRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      expect((firstRes.body as BookingBody).payout!.status).toBe('PENDING');

      // Same officer, called again (sequentially, and not a race) — still just 1 distinct row.
      const secondRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      expect((secondRes.body as BookingBody).payout!.status).toBe('PENDING');

      const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: (secondRes.body as BookingBody).payout!.id } });
      expect(authorisations).toHaveLength(1);
      expect(authorisations[0].authoriserId).toBe(treasurer.userId);
    });

    /**
     * Mirrors bulk-buy.e2e-spec.ts's own concurrency test, but with TWO
     * DISTINCT officers (not the same one twice) racing the exact call that
     * crosses the rung-2 threshold from 0 -> 2 — the scenario that most
     * directly exercises "two officers approve at the same instant".
     * PAYOUT_LOCK_NAMESPACE's advisory lock fully serializes the two
     * transactions, so exactly one of them is first to commit its own
     * upsert+count+execute-check: it sees distinctApprovers=1 (only its own
     * row exists yet), 1 < 2, and returns without executing. The OTHER
     * transaction, running after the first has committed, sees
     * distinctApprovers=2 (both rows now exist) and executes. Which of
     * res1/res2 is "first" vs "second" is itself a genuine race (Promise.all
     * gives no ordering guarantee) — what's deterministic, and what this
     * test asserts, is the FINAL state: exactly one execution, regardless of
     * which HTTP response happened to observe it.
     */
    it('concurrency: two DISTINCT officers racing the threshold-crossing rung-2 call pay exactly once', async () => {
      const residentA = await signupAndLogin(`al-cc-a-${randomUUID()}@example.com`, societyId, flatIds[12], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-cc-b-${randomUUID()}@example.com`, societyId, flatIds[13], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-cc-treasurer-${randomUUID()}@example.com`, societyId, flatIds[14], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      const deputy = await signupAndLogin(`al-cc-deputy-${randomUUID()}@example.com`, societyId, flatIds[15], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      const startLedger = await ledgerBalances(committee.agent);
      const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
      const externalStart = balanceOf(startLedger, AccountKind.EXTERNAL);

      const bookingId = await standUpSmallBooking(vendorId, committee, 1500, residentA, residentB); // total 3000, rung 2 (needs 2 distinct)

      const [res1, res2] = await Promise.all([
        treasurer.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`),
        deputy.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`),
      ]);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      const body1 = res1.body as BookingBody;
      const body2 = res2.body as BookingBody;
      expect(body1.payout).not.toBeNull();
      expect(body2.payout).not.toBeNull();
      expect(body1.payout!.id).toBe(body2.payout!.id);
      // Exactly one of the two racing calls observed PAID in its own
      // response — the other observed PENDING (it committed first, before
      // the second officer's row existed). See this test's doc comment.
      const statuses = [body1.payout!.status, body2.payout!.status].sort();
      expect(statuses).toEqual(['PAID', 'PENDING']);

      const payoutId = body1.payout!.id;
      const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId } });
      expect(authorisations).toHaveLength(2); // both distinct officers recorded, no duplicate/lost row

      const vendorEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payout', linkedEntityId: payoutId, reasonCode: 'BULK_BUY_PAYOUT_VENDOR' } });
      expect(vendorEntryCount).toBe(1); // exactly one disbursement despite the race

      // Final state (post-race) is unambiguously PAID.
      const finalBooking = (await committee.agent.get(`/api/v1/bookings/${bookingId}`).expect(200)).body as BookingBody;
      expect(finalBooking.payout!.status).toBe('PAID');

      const finalLedger = await ledgerBalances(committee.agent);
      expect(finalLedger.balancesIntact).toBe(true);
      expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6); // escrow drained exactly once
      expect(balanceOf(finalLedger, AccountKind.EXTERNAL) - externalStart).toBeCloseTo(0, 6); // nets to zero — no commission, no double payout
    });
  });

  describe('SMALL payout ladder — rung 3 (committee majority)', () => {
    /**
     * A dedicated society so the committee roster (COMMITTEE/TREASURER/
     * DEPUTY_TREASURER distinct-user count) is exactly known — sharing a
     * society with the other SMALL-ladder tests above would make the roster
     * grow as those tests assign more officers, making rung 3's required
     * count non-deterministic.
     */
    let societyId: string;
    let vendorId: string;
    let flatIds: string[];
    let committee: Officer;
    let officerA: Officer; // TREASURER
    let officerB: Officer; // DEPUTY_TREASURER
    let officerC: Officer; // COMMITTEE (not `committee` above — a second committee member)

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Approval Ladder RUNG3 Society', 10);
      societyId = stood.societyId;
      vendorId = stood.vendorId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`al-r3-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      await committee.agent.put('/api/v1/bulk-buy/approval-config').send({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 }).expect(200);

      officerA = await signupAndLogin(`al-r3-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerA.userId, RoleKind.TREASURER);
      officerB = await signupAndLogin(`al-r3-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerB.userId, RoleKind.DEPUTY_TREASURER);
      officerC = await signupAndLogin(`al-r3-committee2-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerC.userId, RoleKind.COMMITTEE);

      // One more officer who pads the roster to exactly 5 distinct members
      // but never authorises anything in this test — the 5th roster seat,
      // alongside {committee, officerA, officerB, officerC}.
      const officerD = await signupAndLogin(`al-r3-committee3-${randomUUID()}@example.com`, societyId, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerD.userId, RoleKind.COMMITTEE);
    });

    it('rung 3 (amount > upperThreshold): required = ceil(0.5 * 5) = 3 — 2 officers racing concurrently still leave it unpaid (negative control); a 3rd distinct officer then pays', async () => {
      const rosterSize = await prisma.role.findMany({
        where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(rosterSize).toHaveLength(5); // committee, officerA, officerB, officerC, officerD

      const residentA = await signupAndLogin(`al-r3-resa-${randomUUID()}@example.com`, societyId, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-r3-resb-${randomUUID()}@example.com`, societyId, flatIds[7], OccupancyRole.OWNER_OCCUPIER);

      const startLedger = await ledgerBalances(committee.agent);
      const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);

      const bookingId = await standUpSmallBooking(vendorId, committee, 4000, residentA, residentB); // total 8000 > 5000 -> rung 3, required ceil(0.5*5)=3

      // Escrow funding (2 x 4000) moves BULK_BUY up by 8000 before any
      // authorisation call — snapshot that level so the "still unpaid"
      // check below compares against the right baseline (bulkBuyStart, by
      // contrast, is from BEFORE escrow, so the FINAL delta-to-zero
      // assertion nets escrow-in against payout-out exactly like
      // bulk-buy.e2e-spec.ts's own pattern).
      const afterEscrowLedger = await ledgerBalances(committee.agent);
      const bulkBuyAfterEscrow = balanceOf(afterEscrowLedger, AccountKind.BULK_BUY);

      // --- Negative control: 2 of the 3 required officers race CONCURRENTLY.
      // Even under the same advisory lock that guarantees no double-pay, this
      // must NOT pay — 2 distinct approvers is still short of the required 3.
      const [negRes1, negRes2] = await Promise.all([
        officerA.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`),
        officerB.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`),
      ]);
      expect(negRes1.status).toBe(201);
      expect(negRes2.status).toBe(201);
      expect((negRes1.body as BookingBody).payout!.status).toBe('PENDING');
      expect((negRes2.body as BookingBody).payout!.status).toBe('PENDING');

      const midLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(midLedger, AccountKind.BULK_BUY) - bulkBuyAfterEscrow).toBeCloseTo(0, 6); // untouched — nothing paid yet

      const payoutIdSoFar = (negRes1.body as BookingBody).payout!.id;
      const midAuthorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: payoutIdSoFar } });
      expect(midAuthorisations).toHaveLength(2);

      // --- The 3rd DISTINCT officer completes the majority.
      const finalRes = await officerC.agent.post(`/api/v1/bookings/${bookingId}/payout/authorise`).expect(201);
      const finalBody = finalRes.body as BookingBody;
      expect(finalBody.payout!.status).toBe('PAID');
      expect(Number(finalBody.payout!.amount)).toBe(8000);

      const finalAuthorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: finalBody.payout!.id } });
      expect(finalAuthorisations).toHaveLength(3);

      const finalLedger = await ledgerBalances(committee.agent);
      expect(finalLedger.balancesIntact).toBe(true);
      expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6); // escrow drained exactly once, only once the majority was reached
    });
  });

  describe('LARGE milestone ladder — mirrors the payout ladder', () => {
    let societyId: string;
    let vendorId: string;
    let flatIds: string[];
    let committee: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Approval Ladder LARGE Society', 20);
      societyId = stood.societyId;
      vendorId = stood.vendorId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`al-m-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      // Same thresholds as the SMALL-ladder describe block. unitPrice 2000 x2
      // residents = total 4000, retentionPct 10% -> retention 400,
      // vendorPayable (= this single milestone's own release amount) 3600,
      // which lands in (1000, 5000] -> rung 2, required 2 distinct officers.
      await committee.agent.put('/api/v1/bulk-buy/approval-config').send({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 }).expect(200);
    });

    it('rung 2 mirror: 1 officer is not enough; a second DISTINCT officer (DEPUTY_TREASURER) executes the milestone release (and sets retention aside)', async () => {
      const residentA = await signupAndLogin(`al-m-r2a-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-m-r2b-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-m-r2-treasurer-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      const deputy = await signupAndLogin(`al-m-r2-deputy-${randomUUID()}@example.com`, societyId, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      const { bookingId, milestoneId } = await standUpLargeBooking(vendorId, committee, 2000, residentA, residentB);

      const firstRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`).expect(201);
      const firstMilestone = (firstRes.body as BookingBody).milestones.find((m) => m.id === milestoneId)!;
      expect(firstMilestone.status).toBe('PENDING'); // 1 distinct officer — not enough for rung 2
      const bookingAfterFirst = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(bookingAfterFirst.retentionSetAside).toBe(false); // nothing moves — not even retention — until the threshold is met

      const secondRes = await deputy.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`).expect(201);
      const secondMilestone = (secondRes.body as BookingBody).milestones.find((m) => m.id === milestoneId)!;
      expect(secondMilestone.status).toBe('PAID');
      expect(Number(secondMilestone.amount)).toBe(3600);
      const bookingAfterSecond = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(bookingAfterSecond.retentionSetAside).toBe(true);
      expect(Number(bookingAfterSecond.retentionAmount)).toBe(400);

      const authorisations = await prisma.milestoneAuthorisation.findMany({ where: { milestoneId } });
      expect(authorisations).toHaveLength(2);
      expect(authorisations.map((a) => a.authoriserId).sort()).toEqual([treasurer.userId, deputy.userId].sort());
    });

    it('same-identity mirror: the same officer authorising twice never reaches PAID on its own', async () => {
      const residentA = await signupAndLogin(`al-m-si-a-${randomUUID()}@example.com`, societyId, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-m-si-b-${randomUUID()}@example.com`, societyId, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-m-si-treasurer-${randomUUID()}@example.com`, societyId, flatIds[7], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);

      const { bookingId, milestoneId } = await standUpLargeBooking(vendorId, committee, 2000, residentA, residentB);

      const firstRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`).expect(201);
      expect((firstRes.body as BookingBody).milestones.find((m) => m.id === milestoneId)!.status).toBe('PENDING');

      const secondRes = await treasurer.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`).expect(201);
      expect((secondRes.body as BookingBody).milestones.find((m) => m.id === milestoneId)!.status).toBe('PENDING');

      const authorisations = await prisma.milestoneAuthorisation.findMany({ where: { milestoneId } });
      expect(authorisations).toHaveLength(1);
      expect(authorisations[0].authoriserId).toBe(treasurer.userId);
    });

    /**
     * Mirrors the SMALL-ladder concurrency test above, one level down:
     * authoriseMilestone takes the SAME per-booking advisory lock
     * (PAYOUT_LOCK_NAMESPACE) as authorisePayout, so two distinct officers
     * racing the exact call that crosses the rung-2 threshold still release
     * the milestone (and set aside its retention) exactly once.
     */
    it('concurrency mirror: two DISTINCT officers racing the threshold-crossing call release the milestone exactly once', async () => {
      const residentA = await signupAndLogin(`al-m-cc-a-${randomUUID()}@example.com`, societyId, flatIds[8], OccupancyRole.OWNER_OCCUPIER);
      const residentB = await signupAndLogin(`al-m-cc-b-${randomUUID()}@example.com`, societyId, flatIds[9], OccupancyRole.OWNER_OCCUPIER);
      const treasurer = await signupAndLogin(`al-m-cc-treasurer-${randomUUID()}@example.com`, societyId, flatIds[10], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      const deputy = await signupAndLogin(`al-m-cc-deputy-${randomUUID()}@example.com`, societyId, flatIds[11], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      const startLedger = await ledgerBalances(committee.agent);
      const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
      const retentionStart = balanceOf(startLedger, AccountKind.RETENTION);

      const { bookingId, milestoneId } = await standUpLargeBooking(vendorId, committee, 2000, residentA, residentB);

      const [res1, res2] = await Promise.all([
        treasurer.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`),
        deputy.agent.post(`/api/v1/bookings/${bookingId}/milestones/${milestoneId}/authorise`),
      ]);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      // Exactly one of the two racing calls observes PAID in its own
      // response — see the mirrored SMALL-ladder concurrency test's doc
      // comment for why (the lock fully serializes the two transactions;
      // whichever commits first sees only its own approval and returns
      // PENDING, the other sees both and executes).
      const statuses = [res1.body as BookingBody, res2.body as BookingBody].map((b) => b.milestones.find((m) => m.id === milestoneId)!.status).sort();
      expect(statuses).toEqual(['PAID', 'PENDING']);

      const authorisations = await prisma.milestoneAuthorisation.findMany({ where: { milestoneId } });
      expect(authorisations).toHaveLength(2);

      const payoutEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Milestone', linkedEntityId: milestoneId, reasonCode: 'BULK_BUY_MILESTONE_PAYOUT' } });
      const retentionHoldEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Booking', linkedEntityId: bookingId, reasonCode: 'BULK_BUY_MILESTONE_RETENTION_HOLD' } });
      expect(payoutEntryCount).toBe(1); // released exactly once despite the race
      expect(retentionHoldEntryCount).toBe(1); // retention set aside exactly once too

      const finalMilestone = (await committee.agent.get(`/api/v1/bookings/${bookingId}`).expect(200)).body as BookingBody;
      expect(finalMilestone.milestones.find((m) => m.id === milestoneId)!.status).toBe('PAID');

      const finalLedger = await ledgerBalances(committee.agent);
      expect(finalLedger.balancesIntact).toBe(true);
      expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6); // 3600 + 400 released, matching the 4000 escrowed
      expect(balanceOf(finalLedger, AccountKind.RETENTION) - retentionStart).toBeCloseTo(400, 6);
    });
  });
});
