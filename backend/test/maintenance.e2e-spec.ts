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
import { AccountKind, CommitmentStatus, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';

/**
 * Phase 9.2 (maintenance billing) Definition of Done, end-to-end against
 * real Postgres, RAZORPAY_ENABLED=false (the deterministic stub — see
 * src/infra/razorpay/razorpay.service.ts):
 *  - POST /maintenance/generate creates exactly one MaintenanceCharge per
 *    flat in the society for the requested period; re-running the SAME
 *    (societyId, period) is a no-op — `generated: 0`, `skipped: <flat
 *    count>`, no duplicate rows (the `@@unique([flatId, period])`
 *    constraint's idempotency);
 *  - a MaintenanceCharge-linked Payment capture (the same signed
 *    `payment.captured` webhook path Phase 4B/4C already use, unmodified)
 *    credits AccountKind.MAINTENANCE (not BULK_BUY) and advances the linked
 *    charge's paidAmount/status all the way to PAID in the same
 *    transaction;
 *  - GET /ledger stays `balancesIntact: true` throughout (Phase 6.5
 *    invariant I6 — the cached balance always matches a fresh recompute
 *    from LedgerEntry rows) and GET /ledger/verify agrees;
 *  - regression (decision #3): a Commitment-linked Payment capture is
 *    completely untouched by this phase — it still credits BULK_BUY (never
 *    MAINTENANCE) and still flips the linked Commitment PENDING -> FUNDED,
 *    byte-identical to pre-Phase-9.2 behaviour.
 *
 * Society/flats are created fresh in beforeAll and every query below is
 * scoped to this suite's own societyId, so this suite is safe to run
 * concurrently with sibling agents' e2e suites against the same shared
 * Postgres instance.
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

interface GenerateResultBody {
  generated: number;
  skipped: number;
}

interface MaintenanceChargeBody {
  id: string;
  societyId: string;
  flatId: string;
  period: string;
  amount: string | number;
  lateFeeAccrued: string | number;
  paidAmount: string | number;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'WAIVED';
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface LedgerVerifyBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

describe('Maintenance billing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let paymentsService: PaymentsService;
  let mailer: CapturingMailer;
  let cookieName: string;
  let webhookSecret: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventIds: string[] = [];
  const commitmentIds: string[] = [];

  let period: string;

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
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);

    // Phase 6.3 ratification gate — see bulk-buy.e2e-spec.ts's identical
    // helper doc comment: this fixture isn't testing ratification itself,
    // it's standing up an already-approved resident.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, kind: RoleKind) {
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

  async function captureOrder(orderId: string, amountRupees: number): Promise<void> {
    const razorpayPaymentId = `pay_stub_${randomUUID().slice(0, 8)}`;
    const event = capturedEvent(`evt_${randomUUID()}`, orderId, razorpayPaymentId, amountRupees);
    const bodyStr = JSON.stringify(event);
    await postWebhook(bodyStr, signWebhook(bodyStr)).expect(200);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
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
    paymentsService = app.get(PaymentsService);
    const config = app.get(AppConfigService);
    cookieName = config.env.SESSION_COOKIE_NAME;
    webhookSecret = config.env.RAZORPAY_WEBHOOK_SECRET;
    expect(config.env.RAZORPAY_ENABLED).toBe(false); // this whole suite assumes the deterministic stub

    const society = await prisma.society.create({ data: { name: 'Maintenance Test Society', address: 'n/a' } });
    societyId = society.id;

    // A period unlikely to collide with any other suite's fixture data —
    // this suite is the only one ever writing MaintenanceCharge rows for it.
    period = '2031-04';

    for (let i = 0; i < 4; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `M-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1500 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.instalmentPlan.deleteMany({ where: { maintenanceCharge: { societyId } } });
    await prisma.maintenanceCharge.deleteMany({ where: { societyId } });
    await prisma.commitment.deleteMany({ where: { id: { in: commitmentIds } } });
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

  it('(a) generates one charge per flat and is idempotent on re-run', async () => {
    const treasurer = await signupAndLogin(`maint-treasurer-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const firstRun = (await treasurer.agent.post('/api/v1/maintenance/generate').send({ period }).expect(201)).body as GenerateResultBody;
    expect(firstRun.generated).toBe(flatIds.length);
    expect(firstRun.skipped).toBe(0);

    const charges = await prisma.maintenanceCharge.findMany({ where: { societyId, period } });
    expect(charges).toHaveLength(flatIds.length);
    for (const flatId of flatIds) {
      expect(charges.some((c) => c.flatId === flatId)).toBe(true);
    }
    expect(charges.every((c) => c.status === 'PENDING' && Number(c.paidAmount) === 0 && Number(c.lateFeeAccrued) === 0)).toBe(true);
    expect(charges.every((c) => Number(c.amount) === 1500)).toBe(true);

    // Re-running the exact same period is a no-op: nothing new generated,
    // every flat skipped, no duplicate rows.
    const secondRun = (await treasurer.agent.post('/api/v1/maintenance/generate').send({ period }).expect(201)).body as GenerateResultBody;
    expect(secondRun.generated).toBe(0);
    expect(secondRun.skipped).toBe(flatIds.length);

    const chargesAfterRerun = await prisma.maintenanceCharge.findMany({ where: { societyId, period } });
    expect(chargesAfterRerun).toHaveLength(flatIds.length);

    // A plain resident (no TREASURER/COMMITTEE role) may not generate.
    const resident = await signupAndLogin(`maint-plain-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.post('/api/v1/maintenance/generate').send({ period: '2031-05' }).expect(403);
  });

  it('(b) a maintenance-linked payment capture credits MAINTENANCE and advances the charge to PAID', async () => {
    const treasurer = await signupAndLogin(`maint-treasurer2-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    // GET /ledger (used below to check balances) is COMMITTEE-gated, not
    // TREASURER — see LedgerController.getLedger's doc comment.
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    // flatIds[2] already has a charge for `period` from test (a)'s generate
    // run (a fresh society-wide generate, so every flat — including this
    // one — got a charge). Resolve it directly.
    const charge = await prisma.maintenanceCharge.findFirstOrThrow({ where: { societyId, period, flatId: flatIds[2] } });
    expect(charge.status).toBe('PENDING');

    const chargeOwner = await signupAndLogin(`maint-owner-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);

    const payment = await paymentsService.createOrderForLink({
      societyId,
      residentId: chargeOwner.userId,
      amount: charge.amount,
      purpose: `Maintenance ${period}`,
      linkedEntityType: 'MaintenanceCharge',
      linkedEntityId: charge.id,
      idempotencyKey: `maint-test:${charge.id}`,
    });

    const before = await ledgerBalances(treasurer.agent);
    const maintenanceBefore = balanceOf(before, AccountKind.MAINTENANCE);
    const bulkBuyBefore = balanceOf(before, AccountKind.BULK_BUY);

    await captureOrder(payment.orderId, Number(charge.amount));

    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.MAINTENANCE)).toBe(maintenanceBefore + Number(charge.amount));
    expect(balanceOf(after, AccountKind.BULK_BUY)).toBe(bulkBuyBefore); // untouched by a maintenance capture

    const chargeAfter = await prisma.maintenanceCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(chargeAfter.status).toBe('PAID');
    expect(Number(chargeAfter.paidAmount)).toBe(Number(charge.amount));

    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.status).toBe('CAPTURED');

    // Committee/treasurer listing surfaces the paid charge.
    const list = (await treasurer.agent.get(`/api/v1/maintenance/charges?period=${period}&status=PAID`).expect(200)).body as MaintenanceChargeBody[];
    expect(list.some((c) => c.id === charge.id)).toBe(true);
  });

  it('(c) ledger balances stay intact throughout (GET /ledger and GET /ledger/verify)', async () => {
    const treasurer = await signupAndLogin(`maint-treasurer3-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE); // GET /ledger is COMMITTEE-gated

    const ledger = await ledgerBalances(treasurer.agent);
    expect(ledger.balancesIntact).toBe(true);

    const verify = (await treasurer.agent.get('/api/v1/ledger/verify').expect(200)).body as LedgerVerifyBody;
    expect(verify.ok).toBe(true);
    expect(verify.accounts.every((a) => a.intact)).toBe(true);
  });

  it('(d) regression: a Commitment-linked payment capture still posts to BULK_BUY exactly as before', async () => {
    const treasurer = await signupAndLogin(`maint-treasurer4-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE); // GET /ledger is COMMITTEE-gated
    const resident = await signupAndLogin(`maint-bb-resident-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);

    const commitment = await prisma.commitment.create({
      data: { residentId: resident.userId, flatId: flatIds[1], status: CommitmentStatus.PENDING },
    });
    commitmentIds.push(commitment.id);

    const payment = await paymentsService.createOrderForLink({
      societyId,
      residentId: resident.userId,
      amount: 750,
      purpose: 'Bulk-buy regression check',
      linkedEntityType: 'Commitment',
      linkedEntityId: commitment.id,
      idempotencyKey: `maint-regression:${commitment.id}`,
    });

    const before = await ledgerBalances(treasurer.agent);
    const maintenanceBefore = balanceOf(before, AccountKind.MAINTENANCE);
    const bulkBuyBefore = balanceOf(before, AccountKind.BULK_BUY);

    await captureOrder(payment.orderId, 750);

    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.BULK_BUY)).toBe(bulkBuyBefore + 750);
    expect(balanceOf(after, AccountKind.MAINTENANCE)).toBe(maintenanceBefore); // untouched by a bulk-buy capture
    expect(after.balancesIntact).toBe(true);

    const commitmentAfter = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } });
    expect(commitmentAfter.status).toBe('FUNDED');
  });
});
