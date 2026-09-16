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
 * Phase 4B (Razorpay sandbox payments) Definition of Done, end-to-end
 * against real Postgres, RAZORPAY_ENABLED=false (the deterministic stub —
 * see src/infra/razorpay/razorpay.service.ts):
 *  - a resident creates a Razorpay order via POST /payments/orders (an
 *    Idempotency-Key is mandatory); replaying the same key returns the same
 *    order and creates no second Payment row;
 *  - the webhook is the SOLE ledger-writer: a correctly-signed
 *    `payment.captured` event flips the Payment to CAPTURED and posts one
 *    balanced LedgerEntry (EXTERNAL debited, BULK_BUY credited);
 *  - signature verification is REAL HMAC-SHA256 even in stub mode: a badly
 *    signed webhook is rejected with 400 and changes nothing;
 *  - webhook idempotency: redelivering the exact same signed event is a
 *    no-op (200, but no second LedgerEntry, no Payment change);
 *  - refund flow: only a TREASURER may POST /payments/:id/refund (a
 *    resident gets 403); that call does NOT touch the ledger itself — the
 *    reversal only happens once a signed `refund.processed` webhook is
 *    delivered (simulated here, since stub mode has no real Razorpay to
 *    deliver it), at which point the Payment flips to REFUNDED and the
 *    ledger is reversed back to its pre-capture balances.
 *
 * No offers/bookings/job-cards/payouts (Phase 4C) are exercised here.
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

interface CreateOrderBody {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

interface PaymentBody {
  id: string;
  societyId: string;
  orderId: string;
  paymentId: string | null;
  amount: string | number;
  status: 'CREATED' | 'CAPTURED' | 'REFUNDED' | 'FAILED';
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface RefundInitiatedBody {
  refundId: string;
  status: string;
  note: string;
}

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let cookieName: string;
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
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);


    // Phase 6.3 ratification gate: a self-registered occupancy starts
    // PENDING and UserContextService blocks it entirely (401) until a
    // committee officer ratifies it. This fixture helper isn't testing
    // the ratification gate itself (see ratification.e2e-spec.ts for
    // that) — it's standing up a normal, already-approved resident for
    // every other suite, so ratify directly via Prisma, matching how
    // other suites poke fixture state directly (e.g. identity.e2e-spec.ts
    // backdating otp.createdAt).
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  /** Signs `body` (the exact bytes that must be sent) with the app's own RAZORPAY_WEBHOOK_SECRET. */
  function signWebhook(body: string): string {
    return createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  function postWebhook(body: string, signature: string) {
    return request(app.getHttpServer()).post('/api/v1/payments/webhook').set('content-type', 'application/json').set('x-razorpay-signature', signature).send(body);
  }

  function capturedEvent(eventId: string, orderId: string, razorpayPaymentId: string, amountRupees: number, eventType: 'payment.captured' | 'order.paid' = 'payment.captured') {
    webhookEventIds.push(eventId);
    return {
      id: eventId,
      event: eventType,
      payload: { payment: { entity: { id: razorpayPaymentId, order_id: orderId, amount: Math.round(amountRupees * 100), status: 'captured' } } },
    };
  }

  function refundProcessedEvent(eventId: string, razorpayPaymentId: string, amountRupees: number) {
    webhookEventIds.push(eventId);
    return {
      id: eventId,
      event: 'refund.processed',
      payload: { refund: { entity: { id: `rfnd_${randomUUID().slice(0, 8)}`, payment_id: razorpayPaymentId, amount: Math.round(amountRupees * 100), status: 'processed' } } },
    };
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
    cookieName = config.env.SESSION_COOKIE_NAME;
    webhookSecret = config.env.RAZORPAY_WEBHOOK_SECRET;
    expect(config.env.RAZORPAY_ENABLED).toBe(false); // this whole suite assumes the deterministic stub

    const society = await prisma.society.create({ data: { name: 'Payments Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 4; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `P-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    // FK-ordered cleanup. WebhookEvent has no societyId FK (it's a global,
    // durable log — see schema.prisma) so it's cleaned up by the exact
    // eventIds this suite generated rather than a society-scoped filter.
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
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

  it('a resident creates an order (Idempotency-Key required, 400 without it); replay returns the same order and creates no second Payment row', async () => {
    const resident = await signupAndLogin(`payments-resident-order-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    await resident.agent.post('/api/v1/payments/orders').send({ amount: 1500, purpose: 'bulk-buy contribution' }).expect(400);

    const idempotencyKey = randomUUID();
    const first = await resident.agent
      .post('/api/v1/payments/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 1500, purpose: 'bulk-buy contribution' })
      .expect(201);
    const body = first.body as CreateOrderBody;
    expect(body.orderId).toMatch(/^order_stub_/);
    expect(body.amount).toBe(1500);
    expect(body.currency).toBe('INR');
    expect(body.keyId).toBeTruthy();

    const paymentRow = await prisma.payment.findUnique({ where: { orderId: body.orderId } });
    expect(paymentRow?.status).toBe('CREATED');
    expect(Number(paymentRow?.amount)).toBe(1500);

    const replay = await resident.agent
      .post('/api/v1/payments/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 1500, purpose: 'bulk-buy contribution' })
      .expect(201);
    expect(replay.body).toEqual(body);

    const paymentCount = await prisma.payment.count({ where: { orderId: body.orderId } });
    expect(paymentCount).toBe(1);
  });

  it('signed payment.captured webhook captures the payment and posts exactly one balanced ledger entry; bad signature and redelivery are both no-ops', async () => {
    const resident = await signupAndLogin(`payments-resident-capture-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    const committee = await signupAndLogin(`payments-committee-capture-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    const idempotencyKey = randomUUID();
    const orderRes = await resident.agent.post('/api/v1/payments/orders').set('Idempotency-Key', idempotencyKey).send({ amount: 2200, purpose: 'test' }).expect(201);
    const { orderId } = orderRes.body as CreateOrderBody;

    const beforeLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    const externalBefore = Number(beforeLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0);
    const bulkBuyBefore = Number(beforeLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0);

    const razorpayPaymentId = `pay_stub_${randomUUID().slice(0, 8)}`;
    const eventId = `evt_${randomUUID()}`;
    const event = capturedEvent(eventId, orderId, razorpayPaymentId, 2200);
    const bodyStr = JSON.stringify(event);
    const goodSig = signWebhook(bodyStr);

    // --- bad signature: rejected, no state change ---
    const badSig = signWebhook(JSON.stringify({ ...event, id: 'tampered' }));
    await postWebhook(bodyStr, badSig).expect(400);

    const paymentAfterBadSig = await prisma.payment.findUnique({ where: { orderId } });
    expect(paymentAfterBadSig?.status).toBe('CREATED');
    const ledgerCountAfterBadSig = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: paymentAfterBadSig?.id } });
    expect(ledgerCountAfterBadSig).toBe(0);

    // --- correctly signed webhook: captures ---
    const goodRes = await postWebhook(bodyStr, goodSig).expect(200);
    expect(goodRes.body).toEqual({ received: true });

    const payment = await prisma.payment.findUnique({ where: { orderId } });
    expect(payment?.status).toBe('CAPTURED');
    expect(payment?.paymentId).toBe(razorpayPaymentId);

    const afterLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    expect(afterLedger.balancesIntact).toBe(true);
    const externalAfter = Number(afterLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0);
    const bulkBuyAfter = Number(afterLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0);
    expect(externalAfter - externalBefore).toBeCloseTo(-2200, 6);
    expect(bulkBuyAfter - bulkBuyBefore).toBeCloseTo(2200, 6);

    const ledgerCountAfterCapture = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: payment?.id, reasonCode: 'PAYMENT_CAPTURED' } });
    expect(ledgerCountAfterCapture).toBe(1);

    // --- idempotent redelivery: exact same signed event again -> no-op ---
    const replayRes = await postWebhook(bodyStr, goodSig).expect(200);
    expect(replayRes.body).toEqual({ received: true });

    const paymentAfterReplay = await prisma.payment.findUnique({ where: { orderId } });
    expect(paymentAfterReplay?.status).toBe('CAPTURED');
    expect(paymentAfterReplay?.updatedAt).toEqual(payment?.updatedAt);

    const ledgerCountAfterReplay = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: payment?.id, reasonCode: 'PAYMENT_CAPTURED' } });
    expect(ledgerCountAfterReplay).toBe(1); // still exactly one — redelivery posted nothing new

    // --- Payment-level dedupe: Razorpay commonly sends BOTH payment.captured
    // AND order.paid for one capture, as two DIFFERENT event ids, so the
    // event-id idempotency check above does not catch this pair. A second,
    // validly-signed capture-type event (order.paid) for the same order must
    // still not double-credit BULK_BUY. ---
    const secondEventId = `evt_${randomUUID()}`;
    const secondEvent = capturedEvent(secondEventId, orderId, razorpayPaymentId, 2200, 'order.paid');
    const secondBodyStr = JSON.stringify(secondEvent);
    const secondRes = await postWebhook(secondBodyStr, signWebhook(secondBodyStr)).expect(200);
    expect(secondRes.body).toEqual({ received: true });

    const paymentAfterSecondEvent = await prisma.payment.findUnique({ where: { orderId } });
    expect(paymentAfterSecondEvent?.status).toBe('CAPTURED');
    expect(paymentAfterSecondEvent?.paymentId).toBe(razorpayPaymentId);

    const ledgerCountAfterSecondEvent = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: payment?.id, reasonCode: 'PAYMENT_CAPTURED' } });
    expect(ledgerCountAfterSecondEvent).toBe(1); // still exactly one — no double credit for the same Payment

    const finalLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    expect(finalLedger.balancesIntact).toBe(true);
    expect(Number(finalLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0) - bulkBuyBefore).toBeCloseTo(2200, 6);
  });

  it('refund flow: only a TREASURER may initiate a refund; the ledger reversal only lands once the signed refund.processed webhook arrives', async () => {
    const resident = await signupAndLogin(`payments-resident-refund-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    const treasurer = await signupAndLogin(`payments-treasurer-refund-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    const committee = await signupAndLogin(`payments-committee-refund-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    // Snapshot balances at the very start, before any money moves.
    const startLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    const externalStart = Number(startLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0);
    const bulkBuyStart = Number(startLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0);

    // Create + capture a payment first.
    const idempotencyKey = randomUUID();
    const orderRes = await resident.agent.post('/api/v1/payments/orders').set('Idempotency-Key', idempotencyKey).send({ amount: 800, purpose: 'test-refund' }).expect(201);
    const { orderId } = orderRes.body as CreateOrderBody;
    const razorpayPaymentId = `pay_stub_${randomUUID().slice(0, 8)}`;
    const captureEvent = capturedEvent(`evt_${randomUUID()}`, orderId, razorpayPaymentId, 800);
    const captureBodyStr = JSON.stringify(captureEvent);
    await postWebhook(captureBodyStr, signWebhook(captureBodyStr)).expect(200);

    const payment = (await resident.agent.get(`/api/v1/payments/${(await prisma.payment.findUniqueOrThrow({ where: { orderId } })).id}`).expect(200)).body as PaymentBody;
    expect(payment.status).toBe('CAPTURED');

    const afterCaptureLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    const externalAfterCapture = Number(afterCaptureLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0);
    const bulkBuyAfterCapture = Number(afterCaptureLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0);
    expect(externalAfterCapture - externalStart).toBeCloseTo(-800, 6);
    expect(bulkBuyAfterCapture - bulkBuyStart).toBeCloseTo(800, 6);

    // Non-treasurer forbidden.
    await resident.agent.post(`/api/v1/payments/${payment.id}/refund`).expect(403);

    // Treasurer initiates the refund — no ledger change yet.
    const refundRes = await treasurer.agent.post(`/api/v1/payments/${payment.id}/refund`).expect(201);
    const refundBody = refundRes.body as RefundInitiatedBody;
    expect(refundBody.refundId).toMatch(/^rfnd_stub_/);
    expect(refundBody.status).toBe('refund_initiated');
    expect(refundBody.note).toMatch(/webhook/i);

    const paymentAfterInitiate = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    expect(paymentAfterInitiate.status).toBe('CAPTURED'); // unchanged until the webhook lands

    const midLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    expect(Number(midLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0)).toBeCloseTo(externalAfterCapture, 6);
    expect(Number(midLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0)).toBeCloseTo(bulkBuyAfterCapture, 6);

    // Stub mode has no real Razorpay to deliver the follow-up webhook, so the
    // test plays Razorpay's part itself: a signed refund.processed event.
    const refundEvent = refundProcessedEvent(`evt_${randomUUID()}`, razorpayPaymentId, 800);
    const refundBodyStr = JSON.stringify(refundEvent);
    await postWebhook(refundBodyStr, signWebhook(refundBodyStr)).expect(200);

    const paymentAfterWebhook = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    expect(paymentAfterWebhook.status).toBe('REFUNDED');

    const afterRefundLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    expect(afterRefundLedger.balancesIntact).toBe(true);
    // Reversed all the way back to the pre-capture starting point — conservation holds.
    expect(Number(afterRefundLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0)).toBeCloseTo(externalStart, 6);
    expect(Number(afterRefundLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0)).toBeCloseTo(bulkBuyStart, 6);

    const reversalCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: paymentAfterWebhook.id, reasonCode: 'PAYMENT_REFUNDED' } });
    expect(reversalCount).toBe(1);

    // --- duplicate refund.processed delivery (different event id, same
    // Razorpay payment): must not reverse the ledger a second time. ---
    const duplicateRefundEvent = refundProcessedEvent(`evt_${randomUUID()}`, razorpayPaymentId, 800);
    const duplicateRefundBodyStr = JSON.stringify(duplicateRefundEvent);
    const duplicateRes = await postWebhook(duplicateRefundBodyStr, signWebhook(duplicateRefundBodyStr)).expect(200);
    expect(duplicateRes.body).toEqual({ received: true });

    const paymentAfterDuplicateRefund = await prisma.payment.findUniqueOrThrow({ where: { orderId } });
    expect(paymentAfterDuplicateRefund.status).toBe('REFUNDED');

    const reversalCountAfterDuplicate = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payment', linkedEntityId: paymentAfterWebhook.id, reasonCode: 'PAYMENT_REFUNDED' } });
    expect(reversalCountAfterDuplicate).toBe(1); // still exactly one — no double reversal

    const finalLedger = (await committee.agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
    expect(finalLedger.balancesIntact).toBe(true);
    expect(Number(finalLedger.balances.find((b) => b.kind === AccountKind.EXTERNAL)?.balance ?? 0)).toBeCloseTo(externalStart, 6);
    expect(Number(finalLedger.balances.find((b) => b.kind === AccountKind.BULK_BUY)?.balance ?? 0)).toBeCloseTo(bulkBuyStart, 6);
  });
});
