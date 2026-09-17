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
import { PaymentsService } from '../src/modules/payments/payments.service.js';

/**
 * Phase 10 CAPSTONE (billing-cycle pipeline: ingest -> validate -> compute ->
 * apportion -> reconcile -> publish) Definition of Done, end-to-end against
 * real Postgres, BILLING_WORKER_INLINE=true (the default — every stage runs
 * synchronously inside the `run()` call, no Redis/worker needed):
 *
 *  - a full happy-path ELECTRICITY cycle: one FLAT-metered flat + one
 *    unmetered (FALLBACK) flat, a BULK meter, apportionment of the
 *    common-area cost by carpetAreaSqft, reconciliation against a licensee
 *    bulk invoice (variance published, never absorbed), FlatBills published
 *    with a full computationTrace, and GET /me/bills surfacing the
 *    published ELECTRICITY line for the flat's resident;
 *  - a FlatBill-linked Payment capture (the same signed `payment.captured`
 *    webhook path Phase 4B/4C/9.2 already use, unmodified) credits
 *    AccountKind.ELECTRICITY (not BULK_BUY/MAINTENANCE) and advances the
 *    linked FlatBill's paidAmount/status to PAID, with GET /ledger and
 *    GET /ledger/verify staying intact throughout;
 *  - a WATER cycle with an anomalous (negative-consumption) reading HALTS
 *    the cycle: status HALTED, the offending meter FLAGGED, a
 *    MeterReadingAnomaly recorded, and NO FlatBills published.
 *
 * Society/flats/meters/tariffs are created fresh in beforeAll and every
 * query below is scoped to this suite's own societyId, so this suite is
 * safe to run concurrently with sibling agents' e2e suites against the same
 * shared Postgres instance.
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

interface BillingCycleBody {
  id: string;
  societyId: string;
  utility: 'ELECTRICITY' | 'WATER';
  period: string;
  stage: string;
  status: string;
  tariffScheduleId: string | null;
  bulkInvoiceAmount: string | null;
  bulkConsumption: string | null;
  variance: string | null;
  haltedReason: string | null;
  flatBillCount: number;
  anomalyCount: number;
}

interface MeterBody {
  id: string;
  serial: string;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface LedgerVerifyBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

interface BillLineBody {
  id: string;
  kind: string;
  amountDue: string;
  status: string;
  evidenceType: string;
  evidenceId: string;
}

interface BillsPageBody {
  items: BillLineBody[];
}

describe('Electricity/water billing-cycle pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let paymentsService: PaymentsService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventIds: string[] = [];
  const meterIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const last = mailer.sent.filter((m) => m.to === email && m.subject === subject).at(-1);
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

    // Phase 6.3 ratification gate — standing up an already-approved
    // resident, not testing ratification itself (see maintenance.e2e-spec.ts's
    // identical helper doc comment).
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
    webhookSecret = config.env.RAZORPAY_WEBHOOK_SECRET;
    expect(config.env.RAZORPAY_ENABLED).toBe(false); // this suite assumes the deterministic Razorpay stub
    expect(config.env.BILLING_WORKER_INLINE).toBe(true); // this suite exercises the inline pipeline path, not the BullMQ worker

    const society = await prisma.society.create({ data: { name: 'Electricity Billing Test Society', address: 'n/a' } });
    societyId = society.id;

    // flatA: FLAT-metered. flatB: no meter of its own -> billed on FALLBACK
    // basis (apportioned common-area share only). Distinct carpetAreaSqft so
    // the area-apportionment split is asymmetric and verifiable.
    const flatA = await prisma.flat.create({ data: { societyId, unitNo: `EB-A-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000, carpetAreaSqft: 1000 } });
    const flatB = await prisma.flat.create({ data: { societyId, unitNo: `EB-B-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000, carpetAreaSqft: 500 } });
    flatIds.push(flatA.id, flatB.id);
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.flatBill.deleteMany({ where: { societyId } });
    await prisma.meterReadingAnomaly.deleteMany({ where: { billingCycle: { societyId } } });
    await prisma.reading.deleteMany({ where: { meter: { societyId } } });
    await prisma.billingCycle.deleteMany({ where: { societyId } });
    await prisma.meter.deleteMany({ where: { societyId } });
    await prisma.waterSource.deleteMany({ where: { societyId } });
    await prisma.tariffSchedule.deleteMany({ where: { societyId } });
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

  it('(a) full ELECTRICITY cycle: apportionment by area, reconciliation variance, published FlatBills with a full trace, and GET /me/bills', async () => {
    const treasurer = await signupAndLogin(`eb-treasurer-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE); // GET /ledger is COMMITTEE-gated

    const flatAResident = await signupAndLogin(`eb-resident-a-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    const period = '2031-07';

    // Tariff: 0-100 units @ ₹5, beyond @ ₹7, plus a ₹50 fixed connection charge.
    await treasurer.agent
      .post('/api/v1/tariffs')
      .send({ utility: 'ELECTRICITY', effectiveFrom: '2020-01-01', slabs: [{ upTo: 100, rate: 5 }, { upTo: null, rate: 7 }], fixedCharges: { perConnection: 50 }, dutyCess: {} })
      .expect(201);

    const bulkMeter = (await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'BULK', serial: `EB-BULK-${randomUUID().slice(0, 6)}` }).expect(201)).body as MeterBody;
    const flatAMeter = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'FLAT', serial: `EB-FLAT-A-${randomUUID().slice(0, 6)}`, flatId: flatIds[0] }).expect(201)
    ).body as MeterBody;
    meterIds.push(bulkMeter.id, flatAMeter.id);
    // flatIds[1] deliberately has NO meter — it is billed on FALLBACK basis.

    const cycle = (await treasurer.agent.post('/api/v1/billing-cycles').send({ utility: 'ELECTRICITY', period }).expect(201)).body as BillingCycleBody;
    expect(cycle.stage).toBe('OPEN');
    expect(cycle.status).toBe('RUNNING');
    expect(cycle.tariffScheduleId).toBeTruthy();

    // Bulk draws 500 units; flatA's sub-meter draws 300 -> common-area
    // consumption = 500 - 300 = 200 units, apportioned by carpetAreaSqft
    // (flatA 1000 sqft, flatB 500 sqft -> 2:1 split).
    await treasurer.agent.post(`/api/v1/meters/${bulkMeter.id}/readings`).send({ value: 500, billingCycleId: cycle.id }).expect(201);
    await treasurer.agent.post(`/api/v1/meters/${flatAMeter.id}/readings`).send({ value: 300, billingCycleId: cycle.id }).expect(201);

    // Set the licensee's bulk invoice BEFORE running the cycle, via the
    // dedicated reconcile-figures endpoint (not passed at open time).
    await treasurer.agent.post(`/api/v1/billing-cycles/${cycle.id}/reconcile`).send({ bulkInvoiceAmount: 3150 }).expect(201);

    const ran = (await treasurer.agent.post(`/api/v1/billing-cycles/${cycle.id}/run`).expect(201)).body as BillingCycleBody;
    expect(ran.stage).toBe('PUBLISHED');
    expect(ran.status).toBe('COMPLETED');
    expect(ran.flatBillCount).toBe(2);
    expect(ran.anomalyCount).toBe(0);
    // Σ(flat charges) = flatA(energy 1900 + fixed 50 = 1950) + common cost
    // (200 units -> 1200 energy + 50 fixed = 1250), apportioned exactly
    // (paise-conserving) across both flats -> Σ = 1950 + 1250 = 3200.00.
    // variance = 3200.00 - 3150 = 50.00.
    expect(Number(ran.variance)).toBeCloseTo(50, 2);

    // Idempotent re-run: already PUBLISHED/COMPLETED, every stage no-ops.
    const reran = (await treasurer.agent.post(`/api/v1/billing-cycles/${cycle.id}/run`).expect(201)).body as BillingCycleBody;
    expect(reran.stage).toBe('PUBLISHED');
    expect(reran.flatBillCount).toBe(2);
    expect(Number(reran.variance)).toBeCloseTo(50, 2);

    const flatABill = await prisma.flatBill.findUniqueOrThrow({ where: { billingCycleId_flatId: { billingCycleId: cycle.id, flatId: flatIds[0] } } });
    expect(flatABill.basis).toBe('METERED');
    expect(Number(flatABill.consumption)).toBe(300);
    expect(Number(flatABill.amount)).toBeCloseTo(1950 + 833.33, 2); // energy+fixed (1950) + area share of the 1250 common cost (2/3 -> 833.33)
    expect(flatABill.status).toBe('PENDING');
    const flatATrace = flatABill.computationTrace as Record<string, unknown>;
    expect(flatATrace.slabBreakdown).toBeTruthy();
    expect(flatATrace.apportionment).toBeTruthy();

    const flatBBill = await prisma.flatBill.findUniqueOrThrow({ where: { billingCycleId_flatId: { billingCycleId: cycle.id, flatId: flatIds[1] } } });
    expect(flatBBill.basis).toBe('FALLBACK');
    expect(flatBBill.consumption).toBeNull();
    expect(Number(flatBBill.amount)).toBeCloseTo(416.67, 2); // 1/3 share of the 1250 common cost
    // Paise-exact conservation: the two shares sum to exactly the common cost.
    expect(Math.round(Number(flatABill.amount) * 100) + Math.round(Number(flatBBill.amount) * 100)).toBe(Math.round(1950 * 100) + Math.round(1250 * 100));

    // GET /me/bills (Phase 9.3, extended in this lane) surfaces flatA's
    // published ELECTRICITY bill for its resident.
    const billsPage = (await flatAResident.agent.get('/api/v1/me/bills?kind=ELECTRICITY').expect(200)).body as BillsPageBody;
    const electricityLine = billsPage.items.find((l) => l.evidenceId === flatABill.id);
    expect(electricityLine).toBeTruthy();
    expect(electricityLine?.evidenceType).toBe('FlatBill');
    expect(Number(electricityLine?.amountDue)).toBeCloseTo(Number(flatABill.amount), 2);
    expect(electricityLine?.status).toBe('PENDING');

    // --- Payment: FlatBill -> ELECTRICITY pocket, via the payment-link registry ---
    const before = await ledgerBalances(treasurer.agent);
    const electricityBefore = balanceOf(before, AccountKind.ELECTRICITY);
    const bulkBuyBefore = balanceOf(before, AccountKind.BULK_BUY);

    const payment = await paymentsService.createOrderForLink({
      societyId,
      residentId: flatAResident.userId,
      amount: flatABill.amount,
      purpose: `Electricity ${period}`,
      linkedEntityType: 'FlatBill',
      linkedEntityId: flatABill.id,
      idempotencyKey: `eb-test:${flatABill.id}`,
    });

    await captureOrder(payment.orderId, Number(flatABill.amount));

    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.ELECTRICITY)).toBeCloseTo(electricityBefore + Number(flatABill.amount), 2);
    expect(balanceOf(after, AccountKind.BULK_BUY)).toBe(bulkBuyBefore); // untouched by a utility-bill capture
    expect(after.balancesIntact).toBe(true);

    const flatABillAfter = await prisma.flatBill.findUniqueOrThrow({ where: { id: flatABill.id } });
    expect(flatABillAfter.status).toBe('PAID');
    expect(Number(flatABillAfter.paidAmount)).toBeCloseTo(Number(flatABill.amount), 2);

    const verify = (await treasurer.agent.get('/api/v1/ledger/verify').expect(200)).body as LedgerVerifyBody;
    expect(verify.ok).toBe(true);
    expect(verify.accounts.every((acct) => acct.intact)).toBe(true);
  });

  it('(b) an anomalous (negative-consumption) reading HALTS the cycle: meter FLAGGED, anomaly recorded, no FlatBills published', async () => {
    const treasurer = await signupAndLogin(`eb-treasurer-halt-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const period = '2031-08';

    // A minimal tariff is required to OPEN the cycle (TariffScheduleService.
    // currentFor 404s otherwise) even though this test never reaches the
    // compute stage that would actually apply it.
    await treasurer.agent
      .post('/api/v1/tariffs')
      .send({ utility: 'WATER', effectiveFrom: '2020-01-01', slabs: [{ upTo: null, rate: 1 }], fixedCharges: {}, dutyCess: {} })
      .expect(201);

    const bulkMeter = (await treasurer.agent.post('/api/v1/meters').send({ utility: 'WATER', kind: 'BULK', serial: `EB-W-BULK-${randomUUID().slice(0, 6)}` }).expect(201)).body as MeterBody;
    const flatMeter = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'WATER', kind: 'FLAT', serial: `EB-W-FLAT-${randomUUID().slice(0, 6)}`, flatId: flatIds[1] }).expect(201)
    ).body as MeterBody;
    meterIds.push(bulkMeter.id, flatMeter.id);

    // An UNTAGGED prior reading establishes this meter's dial history at 100...
    await treasurer.agent.post(`/api/v1/meters/${flatMeter.id}/readings`).send({ value: 100 }).expect(201);

    const cycle = (await treasurer.agent.post('/api/v1/billing-cycles').send({ utility: 'WATER', period }).expect(201)).body as BillingCycleBody;

    // ...and THIS period's reading goes BACKWARDS to 50 — with no
    // meterMaxValue on file, that can only be NEGATIVE_CONSUMPTION, never a
    // plausible rollover (see BillingCycleService's ADAPTATION NOTE).
    await treasurer.agent.post(`/api/v1/meters/${flatMeter.id}/readings`).send({ value: 50, billingCycleId: cycle.id }).expect(201);
    await treasurer.agent.post(`/api/v1/meters/${bulkMeter.id}/readings`).send({ value: 10, billingCycleId: cycle.id }).expect(201);

    const ran = (await treasurer.agent.post(`/api/v1/billing-cycles/${cycle.id}/run`).expect(201)).body as BillingCycleBody;
    expect(ran.stage).toBe('READINGS_CLOSED'); // did NOT advance to VALIDATED
    expect(ran.status).toBe('HALTED');
    expect(ran.haltedReason).toBeTruthy();
    expect(ran.haltedReason).toMatch(/NEGATIVE_CONSUMPTION/);
    expect(ran.anomalyCount).toBeGreaterThan(0);
    expect(ran.flatBillCount).toBe(0);

    const anomaly = await prisma.meterReadingAnomaly.findFirstOrThrow({ where: { billingCycleId: cycle.id, meterId: flatMeter.id } });
    expect(anomaly.kind).toBe('NEGATIVE_CONSUMPTION');

    const flaggedMeter = await prisma.meter.findUniqueOrThrow({ where: { id: flatMeter.id } });
    expect(flaggedMeter.status).toBe('FLAGGED');

    const flatBillCount = await prisma.flatBill.count({ where: { billingCycleId: cycle.id } });
    expect(flatBillCount).toBe(0);

    // Re-running a HALTED cycle is a safe, verified no-op — it does not
    // throw, does not advance the stage, and creates no additional rows.
    const reran = (await treasurer.agent.post(`/api/v1/billing-cycles/${cycle.id}/run`).expect(201)).body as BillingCycleBody;
    expect(reran.stage).toBe('READINGS_CLOSED');
    expect(reran.status).toBe('HALTED');
    const anomalyCountAfterRerun = await prisma.meterReadingAnomaly.count({ where: { billingCycleId: cycle.id } });
    expect(anomalyCountAfterRerun).toBe(1);
  });

  it('(c) GET /billing-cycles lists both cycles, filterable by utility/status', async () => {
    const treasurer = await signupAndLogin(`eb-treasurer-list-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const all = (await treasurer.agent.get('/api/v1/billing-cycles').expect(200)).body as BillingCycleBody[];
    expect(all.length).toBeGreaterThanOrEqual(2);

    const halted = (await treasurer.agent.get('/api/v1/billing-cycles?status=HALTED').expect(200)).body as BillingCycleBody[];
    expect(halted.every((c) => c.status === 'HALTED')).toBe(true);
    expect(halted.length).toBeGreaterThanOrEqual(1);

    const electricityOnly = (await treasurer.agent.get('/api/v1/billing-cycles?utility=ELECTRICITY').expect(200)).body as BillingCycleBody[];
    expect(electricityOnly.every((c) => c.utility === 'ELECTRICITY')).toBe(true);
    expect(electricityOnly.length).toBeGreaterThanOrEqual(1);
  });
});
