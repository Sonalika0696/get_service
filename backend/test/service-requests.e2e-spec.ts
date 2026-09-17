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
import { AccountKind, OccupancyRole, PricingBasis, PricingCardStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 8.2 (BACKEND_PLAN.md Phase 8 item 2) Definition of Done, end-to-end
 * against real Postgres, RAZORPAY_ENABLED false (same deterministic-stub
 * assumption as bulk-buy.e2e-spec.ts/flow-b.e2e-spec.ts — no real money
 * ever moves in this suite):
 *
 *  - HEADLINE: a resident raises "AC not cooling", joins their own request,
 *    two neighbours join too — the per-category default threshold (3
 *    distinct flats) is met and the request POOLS; a committee member
 *    assigns a vendor that holds a published pricing card for the
 *    category; the committee relays the vendor's confirmation (an
 *    EXPLICIT per-flat contribution) — the card FREEZES, and all three
 *    participating flats end up with the IDENTICAL frozenPricingCardId and
 *    quoted contribution; escrow captures via the existing signed-webhook
 *    stub; the ledger's balancesIntact (I2) holds throughout, and a
 *    dual/committee payout drains escrow back to zero exactly like Flow
 *    A/Flow B's unmodified rails;
 *  - a COMMITTEE-origin request (raised on a named flat's behalf) also
 *    pools the same way;
 *  - assigning a vendor with no published card for the category is
 *    rejected (400);
 *  - a request that closes below threshold is LAPSED with ZERO
 *    Payment/LedgerEntry rows ever created for it — the structural-refund
 *    proof (nothing to reverse because nothing was ever escrowed);
 *  - a later revision/republish of the vendor's card does NOT change what
 *    an already-CONFIRMED request froze;
 *  - a non-committee resident gets 403 on assign/confirm.
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

interface ServiceRequestBody {
  id: string;
  status: 'OPEN' | 'POOLED' | 'ASSIGNED' | 'CONFIRMED' | 'LAPSED';
  pollType: string;
  origin: 'RESIDENT' | 'COMMITTEE';
  category: string | null;
  threshold: number | null;
  participantCount: number;
  hasJoined?: boolean;
  bookingId: string | null;
  assignedVendorId: string | null;
  vendorConfirmedContribution: string | number | null;
  frozenPricingCardId: string | null;
  raisedByFlatId: string | null;
}

interface JobCardBody {
  id: string;
  bookingId: string;
  commitmentId: string;
  residentId: string;
  unitPrice: string | number;
  status: 'PENDING' | 'SIGNED_OFF' | 'DISPUTED';
}

interface PayoutBody {
  id: string;
  status: 'PENDING' | 'AUTHORISED' | 'PAID';
  amount: string | number;
}

interface BookingBody {
  id: string;
  sourceType: string;
  sourceId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  jobCards: JobCardBody[];
  payout: PayoutBody | null;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

describe('ServiceRequest pooling loop — Phase 8.2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const vendorIds: string[] = [];
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

    // Ratification gate — see flow-b.e2e-spec.ts's identical helper for why this is poked directly.
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

  /** Pays whichever Commitment is linked, via the same signed webhook path every other bulk-buy suite uses. */
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

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
  }

  /** Creates a Vendor + VendorSocietyLink + (optionally) a PUBLISHED PricingCard for a category, entirely via Prisma — mirrors flow-b.e2e-spec.ts's direct-Prisma vendor fixtures (no vendor-login surface needed for this suite). */
  async function vendorWithCardFixture(category: string, opts: { published: boolean } = { published: true }) {
    const vendor = await prisma.vendor.create({ data: { name: `SR Test Vendor ${randomUUID().slice(0, 8)}` } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId } });

    if (opts.published) {
      const card = await prisma.pricingCard.create({
        data: {
          vendorId: vendor.id,
          category,
          version: 1,
          gstRatePct: 18,
          effectiveFrom: new Date(),
          status: PricingCardStatus.PUBLISHED,
          publishedAt: new Date(),
          lines: { create: [{ label: 'Visit charge', basis: PricingBasis.PER_VISIT, rate: 150 }] },
        },
      });
      return { vendorId: vendor.id, cardId: card.id };
    }
    return { vendorId: vendor.id, cardId: null as string | null };
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

    const society = await prisma.society.create({ data: { name: 'Service Request Pool Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 24; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `SR-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId } } } });
    await prisma.payout.deleteMany({ where: { booking: { societyId } } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
    await prisma.booking.deleteMany({ where: { societyId } });
    await prisma.commitment.deleteMany({ where: { serviceRequest: { societyId } } });
    await prisma.participation.deleteMany({ where: { serviceRequest: { societyId } } });
    await prisma.serviceRequest.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.pricingLine.deleteMany({ where: { card: { vendorId: { in: vendorIds } } } });
    await prisma.pricingCard.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { societyId } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
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

  it('HEADLINE: raise -> join x3 -> POOLED -> assign -> committee-relayed confirm -> card FREEZES identically for every participant -> escrow captures -> ledger balanced -> payout drains to zero', async () => {
    const committee = await signupAndLogin(`sr-committee-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const treasurer = await signupAndLogin(`sr-treasurer-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    const resident1 = await signupAndLogin(`sr-resident1-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`sr-resident2-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`sr-resident3-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);

    const { vendorId, cardId } = await vendorWithCardFixture('AC Repair');

    const startLedger = await ledgerBalances(committee.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);

    // --- Resident raises the request for their own flat.
    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'AC Repair', title: 'AC not cooling', description: 'Living room unit blowing warm air', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;
    expect(created.status).toBe('OPEN');
    expect(created.pollType).toBe('SERVICE_REQUEST');
    expect(created.origin).toBe('RESIDENT');
    expect(created.threshold).toBe(3); // documented conservative default (no per-society override configured)
    expect(created.participantCount).toBe(0); // raising is not itself joining

    // --- Raiser joins their own request, then two neighbours join.
    const afterFirstJoin = (await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201)).body as ServiceRequestBody;
    expect(afterFirstJoin.status).toBe('OPEN');
    expect(afterFirstJoin.participantCount).toBe(1);

    // Double-join by the same resident/flat is rejected.
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(409);

    const afterSecondJoin = (await resident2.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201)).body as ServiceRequestBody;
    expect(afterSecondJoin.status).toBe('OPEN'); // 2 of 3 — not pooled yet
    expect(afterSecondJoin.participantCount).toBe(2);

    const afterThirdJoin = (await resident3.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201)).body as ServiceRequestBody;
    expect(afterThirdJoin.status).toBe('POOLED'); // threshold (3) met
    expect(afterThirdJoin.participantCount).toBe(3);

    const pooledAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_POOLED' } });
    expect(pooledAudit).toHaveLength(1);

    // Joining a POOLED (non-OPEN) request is rejected.
    const resident4 = await signupAndLogin(`sr-resident4-${randomUUID()}@example.com`, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
    await resident4.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(400);

    // --- Committee assigns the vendor (linked + holds a published card for this category).
    const assignRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(201);
    const assigned = assignRes.body as ServiceRequestBody;
    expect(assigned.status).toBe('ASSIGNED');
    expect(assigned.assignedVendorId).toBe(vendorId);

    const assignedAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_ASSIGNED' } });
    expect(assignedAudit).toHaveLength(1);

    // --- Committee relays the vendor's EXPLICIT confirmation.
    const confirmRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 1200 }).expect(201);
    const confirmed = confirmRes.body as ServiceRequestBody;
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.frozenPricingCardId).toBe(cardId);
    expect(Number(confirmed.vendorConfirmedContribution)).toBe(1200);
    expect(confirmed.bookingId).toBeTruthy();

    const frozenAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_CARD_FROZEN' } });
    expect(frozenAudit).toHaveLength(1);
    expect((frozenAudit[0].payload as { pricingCardId: string }).pricingCardId).toBe(cardId);

    // Re-confirming / re-assigning after CONFIRMED is rejected.
    await committee.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 999 }).expect(400);
    await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(400);

    // --- DoD: all three participating flats hold the IDENTICAL frozenPricingCardId and quoted contribution.
    const participations = await prisma.participation.findMany({ where: { serviceRequestId: created.id } });
    expect(participations).toHaveLength(3);
    for (const p of participations) {
      expect(Number(p.contribution)).toBe(1200);
    }
    const distinctFlatIds = new Set(participations.map((p) => p.flatId));
    expect(distinctFlatIds.size).toBe(3);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: confirmed.bookingId! } });
    expect(booking.sourceType).toBe('SERVICE_REQUEST');
    expect(booking.sourceId).toBe(created.id);
    expect(booking.vendorId).toBe(vendorId);
    expect(booking.status).toBe('ACTIVE');

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    expect(jobCards).toHaveLength(3);
    for (const jc of jobCards) {
      expect(Number(jc.unitPrice)).toBe(1200);
      expect(Number(jc.appliedDiscountPct)).toBe(0);
      expect(jc.tier).toBe('SMALL');
    }

    const commitments = await prisma.commitment.findMany({ where: { serviceRequestId: created.id } });
    expect(commitments).toHaveLength(3);
    for (const c of commitments) {
      expect(c.offerId).toBeNull();
      expect(c.paymentId).toBeTruthy();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId! } });
      expect(Number(payment.amount)).toBe(1200);
      expect(payment.status).toBe('CREATED');
    }

    // --- Escrow capture via the existing signed-webhook stub, then the full unmodified Flow A/B rail (sign-off, payout).
    for (const c of commitments) {
      await payCommitment(c.id, 1200);
    }

    const afterEscrowLedger = await ledgerBalances(committee.agent);
    expect(afterEscrowLedger.balancesIntact).toBe(true); // I2
    expect(balanceOf(afterEscrowLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(3600, 6);

    const agentByResidentId = new Map([
      [resident1.userId, resident1.agent],
      [resident2.userId, resident2.agent],
      [resident3.userId, resident3.agent],
    ]);
    for (const jc of jobCards) {
      const owner = agentByResidentId.get(jc.residentId);
      if (!owner) throw new Error(`No fixture agent for job card resident ${jc.residentId}`);
      await owner.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    const bookingCompleted = (await committee.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingCompleted.status).toBe('COMPLETED');

    const payoutRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(201);
    const paidBooking = payoutRes.body as BookingBody;
    expect(paidBooking.payout!.status).toBe('PAID');
    expect(Number(paidBooking.payout!.amount)).toBe(3600);

    const finalLedger = await ledgerBalances(committee.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
  });

  it('a COMMITTEE-origin request (raised on a named flat) also pools once the threshold is met', async () => {
    const committee = await signupAndLogin(`sr-committee2-${randomUUID()}@example.com`, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`sr-c-resident1-${randomUUID()}@example.com`, flatIds[7], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`sr-c-resident2-${randomUUID()}@example.com`, flatIds[8], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`sr-c-resident3-${randomUUID()}@example.com`, flatIds[9], OccupancyRole.OWNER_OCCUPIER);

    // A plain resident cannot use the committee-create route.
    await resident1.agent
      .post('/api/v1/service-requests/committee')
      .send({ category: 'Common Area', title: 'Lobby light out', closesAt: futureIso(86_400_000), raisedByFlatId: flatIds[6] })
      .expect(403);

    const createRes = await committee.agent
      .post('/api/v1/service-requests/committee')
      .send({ category: 'Common Area', title: 'Lobby light out', closesAt: futureIso(86_400_000), raisedByFlatId: flatIds[6] })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;
    expect(created.origin).toBe('COMMITTEE');
    expect(created.raisedByFlatId).toBe(flatIds[6]);

    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    await resident2.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    const finalRes = await resident3.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    expect((finalRes.body as ServiceRequestBody).status).toBe('POOLED');
  });

  it('assigning a vendor with no published pricing card for the category is rejected (400)', async () => {
    const committee = await signupAndLogin(`sr-committee3-${randomUUID()}@example.com`, flatIds[10], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`sr-nc-resident1-${randomUUID()}@example.com`, flatIds[11], OccupancyRole.OWNER_OCCUPIER);

    const { vendorId: noCardVendorId } = await vendorWithCardFixture('Carpentry', { published: false });

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Carpentry', title: 'Broken cupboard hinge', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId: noCardVendorId }).expect(400);

    // A vendor not linked to this society at all is also rejected.
    const unlinkedVendor = await prisma.vendor.create({ data: { name: `Unlinked Vendor ${randomUUID().slice(0, 8)}` } });
    vendorIds.push(unlinkedVendor.id);
    await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId: unlinkedVendor.id }).expect(400);
  });

  it('below-threshold close: LAPSED with ZERO Payment/LedgerEntry rows for that request — the structural-refund proof', async () => {
    const committee = await signupAndLogin(`sr-committee4-${randomUUID()}@example.com`, flatIds[12], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`sr-bt-resident1-${randomUUID()}@example.com`, flatIds[13], OccupancyRole.OWNER_OCCUPIER);

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Pest Control', title: 'Cockroach infestation', closesAt: futureIso(60_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201); // 1 of 3 — below threshold

    // Closing before closesAt has passed is rejected.
    await committee.agent.post(`/api/v1/service-requests/${created.id}/close`).expect(400);

    await prisma.serviceRequest.update({ where: { id: created.id }, data: { closesAt: new Date(Date.now() - 1000) } });

    const closeRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/close`).expect(201);
    const closed = closeRes.body as ServiceRequestBody;
    expect(closed.status).toBe('LAPSED');

    const participations = await prisma.participation.findMany({ where: { serviceRequestId: created.id } });
    expect(participations).toHaveLength(1);
    expect(participations[0].status).toBe('LAPSED');

    // The structural proof: this request never escrowed a single rupee.
    const commitments = await prisma.commitment.findMany({ where: { serviceRequestId: created.id } });
    expect(commitments).toHaveLength(0);
    const bookings = await prisma.booking.findMany({ where: { sourceType: 'SERVICE_REQUEST', sourceId: created.id } });
    expect(bookings).toHaveLength(0);
    const payments = await prisma.payment.findMany({ where: { societyId, linkedEntityType: 'Commitment', linkedEntityId: { in: commitments.map((c) => c.id) } } });
    expect(payments).toHaveLength(0);
    const ledgerEntries = await prisma.ledgerEntry.findMany({ where: { societyId, linkedEntityType: 'Payment', linkedEntityId: { in: payments.map((p) => p.id) } } });
    expect(ledgerEntries).toHaveLength(0);

    const lapsedAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_LAPSED' } });
    expect(lapsedAudit).toHaveLength(1);
    expect((lapsedAudit[0].payload as { reason: string }).reason).toBe('below_threshold');

    // Terminal — cannot join, assign, or close again.
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(400);
    await committee.agent.post(`/api/v1/service-requests/${created.id}/close`).expect(400);
  });

  it("a later revision/republish of the vendor's card does not change what an already-CONFIRMED request froze", async () => {
    const committee = await signupAndLogin(`sr-committee5-${randomUUID()}@example.com`, flatIds[14], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`sr-rev-resident1-${randomUUID()}@example.com`, flatIds[15], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`sr-rev-resident2-${randomUUID()}@example.com`, flatIds[16], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`sr-rev-resident3-${randomUUID()}@example.com`, flatIds[17], OccupancyRole.OWNER_OCCUPIER);

    const { vendorId, cardId: v1CardId } = await vendorWithCardFixture('Electrical');

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Electrical', title: 'Flickering hallway light', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    await resident2.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    await resident3.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);

    await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(201);
    const confirmRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 800 }).expect(201);
    expect((confirmRes.body as ServiceRequestBody).frozenPricingCardId).toBe(v1CardId);

    // Supersede v1 with a published v2 directly (mirrors PricingCardsService.publish's supersession — no HTTP surface needed for this fixture).
    const v1 = await prisma.pricingCard.findUniqueOrThrow({ where: { id: v1CardId! } });
    await prisma.pricingCard.update({ where: { id: v1.id }, data: { supersededAt: new Date() } });
    await prisma.pricingCard.create({
      data: {
        vendorId,
        category: 'Electrical',
        version: 2,
        gstRatePct: 18,
        effectiveFrom: new Date(),
        status: PricingCardStatus.PUBLISHED,
        publishedAt: new Date(),
        lines: { create: [{ label: 'Visit charge', basis: PricingBasis.PER_VISIT, rate: 250 }] },
      },
    });

    const afterRevision = (await committee.agent.get(`/api/v1/service-requests/${created.id}`).expect(200)).body as ServiceRequestBody;
    expect(afterRevision.frozenPricingCardId).toBe(v1CardId); // unchanged — frozen forever
  });

  it('non-committee resident gets 403 on assign/confirm/decline/close', async () => {
    const resident1 = await signupAndLogin(`sr-403-resident1-${randomUUID()}@example.com`, flatIds[18], OccupancyRole.OWNER_OCCUPIER);
    const { vendorId } = await vendorWithCardFixture('Housekeeping');

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Housekeeping', title: 'Weekly deep clean', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    await resident1.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(403);
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 500 }).expect(403);
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/decline`).expect(403);
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/close`).expect(403);
  });

  it('committee-relayed decline (structural, ASSIGNED -> LAPSED) — no money exists yet either', async () => {
    const committee = await signupAndLogin(`sr-decline-committee-${randomUUID()}@example.com`, flatIds[19], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`sr-decline-resident1-${randomUUID()}@example.com`, flatIds[20], OccupancyRole.OWNER_OCCUPIER);
    const { vendorId } = await vendorWithCardFixture('Gardening');

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Gardening', title: 'Overgrown hedges', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(201);
    const declineRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/decline`).expect(201);
    expect((declineRes.body as ServiceRequestBody).status).toBe('LAPSED');

    const commitments = await prisma.commitment.findMany({ where: { serviceRequestId: created.id } });
    expect(commitments).toHaveLength(0);

    await committee.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 500 }).expect(400);
  });
});
