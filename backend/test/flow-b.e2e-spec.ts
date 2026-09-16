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
 * Phase 5 Flow B (resident-initiated, tagged-vendor bulk-buy polls)
 * Definition of Done, end-to-end against real Postgres, RAZORPAY_ENABLED
 * false (same deterministic-stub assumption as bulk-buy.e2e-spec.ts — no
 * real money ever moves in this suite):
 *  - a resident opens a poll tagging an existing vendor in their own
 *    society; a non-existent or cross-society vendor id is rejected;
 *  - residents join (PollCommitment) before the vendor ever responds — the
 *    poll does NOT auto-fire off proposedMinimum alone, even once enough
 *    residents have joined, because Flow B only fires once the vendor has
 *    confirmed;
 *  - double-joining is rejected with 409;
 *  - a committee member confirms terms on the vendor's behalf
 *    (unitPrice, confirmedMinimum, optional discount ladder). If enough
 *    residents already joined, confirming fires the poll immediately, in
 *    the same call: Poll status FIRED, a Booking(sourceType='POLL') +
 *    one JobCard/escrow Payment per participant, exactly like Flow A's
 *    fireOffer produces for an Offer;
 *  - the mirror ordering also fires: vendor confirms first, and the join
 *    that tips the commitment count over vendorConfirmedMinimum fires the
 *    poll;
 *  - downstream of firing, Flow B rides the UNMODIFIED Flow A rails: each
 *    resident "pays" via the same signed payment.captured webhook path,
 *    each signs off their own job card, the booking flips COMPLETED once
 *    both are signed off, and a treasurer's dual-authorised payout
 *    (the full amount, no commission) drains escrow back to zero with the ledger's
 *    balancesIntact holding throughout;
 *  - a vendor decline (POST /vendor-decline) sets the poll CANCELLED
 *    outright; further joins against it are rejected (400);
 *  - concurrency hardening: joinResidentPoll and vendorConfirm both take a
 *    per-poll Postgres advisory lock (namespace 53, hashtext(pollId)) as
 *    the FIRST statement in their transaction, so two DIFFERENT residents
 *    racing across the vendor-confirmed fire threshold at the same time
 *    can't both observe status=OPEN and both fire — the poll fires exactly
 *    once, with exactly one Booking and no duplicate escrow Payments;
 *  - PollsService's ownership split: creating a BULK_BUY_RESIDENT poll via
 *    the generic POST /polls is rejected with 400, directing callers to
 *    POST /bulk-buy/polls instead;
 *  - weekly-recurring offers: an Offer created with recurring=WEEKLY, once
 *    its deadline has passed, can be "rolled" into a fresh OPEN offer with
 *    deadline +7 days and no commitments.
 * No Phase 6+ concepts are exercised here.
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

interface ResidentPollBody {
  id: string;
  status: 'OPEN' | 'FIRED' | 'EXPIRED' | 'CLOSED' | 'CANCELLED' | 'PASSED' | 'FAILED';
  pollType: string;
  minCommitments: number | null;
  commitmentCount: number;
  hasJoined?: boolean;
  bookingId: string | null;
  taggedVendorId: string | null;
  vendorConfirmedAt: string | null;
  vendorDeclinedAt: string | null;
  vendorConfirmedMinimum: number | null;
  vendorUnitPrice: string | number | null;
}

interface JobCardBody {
  id: string;
  bookingId: string;
  commitmentId: string;
  residentId: string;
  unitPrice: string | number;
  appliedDiscountPct: string | number;
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

interface OfferBody {
  id: string;
  status: 'OPEN' | 'FIRED' | 'EXPIRED' | 'CANCELLED';
  recurring?: 'NONE' | 'WEEKLY';
  deadline: string;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

describe('Bulk-buy Flow B — resident polls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  let societyId: string;
  let otherSocietyId: string;
  let vendorId: string;
  let otherSocietyVendorId: string;
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

  /** Pays whichever Commitment (Flow A or Flow B — same Payment mechanics either way) is linked, via the same signed webhook path Flow A's own suite uses. */
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
    expect(config.env.RAZORPAY_ENABLED).toBe(false); // this whole suite assumes the deterministic stub — no real Razorpay call, ever

    const society = await prisma.society.create({ data: { name: 'Flow B Test Society', address: 'n/a' } });
    societyId = society.id;
    const otherSociety = await prisma.society.create({ data: { name: 'Flow B Other Society', address: 'n/a' } });
    otherSocietyId = otherSociety.id;

    // 0: creation-validation test. 1-4: confirm-after-join test.
    // 5-7: confirm-before-join test. 8-9: vendor-decline test.
    // 10: ownership-split test. 12: weekly-recurring test.
    // 14-17: concurrent-join-race test. (11, 13 spare)
    for (let i = 0; i < 18; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `FB-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }

    const vendor = await prisma.vendor.create({ data: { societyId, name: 'Flow B Test Vendor', contactEmail: 'vendor@example.com' } });
    vendorId = vendor.id;
    const otherVendor = await prisma.vendor.create({ data: { societyId: otherSocietyId, name: 'Flow B Other-Society Vendor' } });
    otherSocietyVendorId = otherVendor.id;
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId } } } });
    await prisma.payout.deleteMany({ where: { booking: { societyId } } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
    await prisma.booking.deleteMany({ where: { societyId } });
    await prisma.commitment.deleteMany({ where: { OR: [{ offer: { societyId } }, { poll: { societyId } }] } });
    await prisma.pollCommitment.deleteMany({ where: { poll: { societyId } } });
    await prisma.poll.deleteMany({ where: { societyId } });
    await prisma.offer.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.vendor.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyId, otherSocietyId] } } });

    await app.close();
  });

  it('a resident opens a tagged-vendor poll; a non-existent or cross-society vendor id is rejected', async () => {
    const resident = await signupAndLogin(`fb-create-resident-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    await resident.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: 'does-not-exist', category: 'Groceries', title: 'Bulk rice order', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(404);

    await resident.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: otherSocietyVendorId, category: 'Groceries', title: 'Bulk rice order', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(404);

    const createRes = await resident.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendorId, category: 'Groceries', title: 'Bulk rice order', description: 'A resident-initiated bulk buy', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(201);
    const poll = createRes.body as ResidentPollBody;
    expect(poll.status).toBe('OPEN');
    expect(poll.pollType).toBe('BULK_BUY_RESIDENT');
    expect(poll.minCommitments).toBe(2);
    expect(poll.taggedVendorId).toBe(vendorId);
    expect(poll.vendorConfirmedAt).toBeNull();
    expect(poll.bookingId).toBeNull();

    const getRes = await resident.agent.get(`/api/v1/bulk-buy/polls/${poll.id}`).expect(200);
    expect((getRes.body as ResidentPollBody).id).toBe(poll.id);

    const listRes = await resident.agent.get('/api/v1/bulk-buy/polls').expect(200);
    expect((listRes.body as ResidentPollBody[]).some((p) => p.id === poll.id)).toBe(true);
  });

  it('residents join before the vendor responds (no auto-fire off proposedMinimum alone); vendor-confirm then fires immediately in the same call; Flow A rails complete the booking', async () => {
    const committee = await signupAndLogin(`fb-committee-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const treasurer = await signupAndLogin(`fb-treasurer-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    const resident1 = await signupAndLogin(`fb-resident1-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`fb-resident2-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);

    const startLedger = await ledgerBalances(committee.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);

    const createRes = await resident1.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendorId, category: 'Renovation', title: 'Lobby paint job', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(201);
    const poll = createRes.body as ResidentPollBody;

    const afterFirstJoin = await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);
    expect((afterFirstJoin.body as ResidentPollBody).status).toBe('OPEN');
    expect((afterFirstJoin.body as ResidentPollBody).commitmentCount).toBe(1);

    // Double-join is rejected.
    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(409);

    const afterSecondJoin = await resident2.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);
    const afterBothJoined = afterSecondJoin.body as ResidentPollBody;
    // 2 residents have joined == proposedMinimum, but the vendor hasn't
    // confirmed yet — Flow B never auto-fires off proposedMinimum alone.
    expect(afterBothJoined.status).toBe('OPEN');
    expect(afterBothJoined.commitmentCount).toBe(2);
    expect(afterBothJoined.bookingId).toBeNull();

    // Only committee can confirm on the vendor's behalf.
    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`).send({ confirmedMinimum: 2, unitPrice: 1000 }).expect(403);

    // --- Vendor confirms; 2 residents already joined >= confirmedMinimum -> fires immediately ---
    const confirmRes = await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`).send({ confirmedMinimum: 2, unitPrice: 1000 }).expect(201);
    const firedPoll = confirmRes.body as ResidentPollBody;
    expect(firedPoll.status).toBe('FIRED');
    expect(firedPoll.vendorConfirmedMinimum).toBe(2);
    expect(Number(firedPoll.vendorUnitPrice)).toBe(1000);
    expect(firedPoll.bookingId).toBeTruthy();

    // A second confirm (or a decline) after the vendor already responded is rejected.
    await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`).send({ confirmedMinimum: 2, unitPrice: 1000 }).expect(400);
    await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-decline`).expect(400);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: firedPoll.bookingId! } });
    expect(booking.sourceType).toBe('POLL');
    expect(booking.sourceId).toBe(poll.id);
    expect(booking.vendorId).toBe(vendorId);
    expect(booking.status).toBe('ACTIVE');

    // No discount ladder was confirmed -> appliedDiscountPct 0, full unitPrice.
    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' } });
    expect(jobCards).toHaveLength(2);
    for (const jc of jobCards) {
      expect(Number(jc.unitPrice)).toBe(1000);
      expect(Number(jc.appliedDiscountPct)).toBe(0);
      expect(jc.tier).toBe('SMALL');
    }

    const commitments = await prisma.commitment.findMany({ where: { pollId: poll.id } });
    expect(commitments).toHaveLength(2);
    for (const c of commitments) {
      expect(c.offerId).toBeNull();
      expect(c.paymentId).toBeTruthy();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId! } });
      expect(payment.status).toBe('CREATED');
      expect(payment.linkedEntityType).toBe('Commitment');
    }

    const resident1Commitment = commitments.find((c) => c.residentId === resident1.userId)!;
    const resident2Commitment = commitments.find((c) => c.residentId === resident2.userId)!;
    const resident1JobCard = jobCards.find((jc) => jc.commitmentId === resident1Commitment.id)!;
    const resident2JobCard = jobCards.find((jc) => jc.commitmentId === resident2Commitment.id)!;

    // --- Pay, sign off, payout — the exact Flow A booking/escrow/payout rails ---
    await payCommitment(resident1Commitment.id, 1000);
    await payCommitment(resident2Commitment.id, 1000);

    const afterEscrowLedger = await ledgerBalances(committee.agent);
    expect(afterEscrowLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterEscrowLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(2000, 6);

    await resident1.agent.post(`/api/v1/job-cards/${resident1JobCard.id}/sign-off`).expect(201);
    const signOff2 = await resident2.agent.post(`/api/v1/job-cards/${resident2JobCard.id}/sign-off`).expect(201);
    expect((signOff2.body as JobCardBody).status).toBe('SIGNED_OFF');

    const bookingCompleted = (await committee.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingCompleted.status).toBe('COMPLETED');

    const payoutRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(201);
    const paidBooking = payoutRes.body as BookingBody;
    expect(paidBooking.payout!.status).toBe('PAID');
    expect(Number(paidBooking.payout!.amount)).toBe(2000);

    const finalLedger = await ledgerBalances(committee.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
  });

  it('vendor confirms first (with a discount ladder); the join that tips the count over vendorConfirmedMinimum fires the poll', async () => {
    const committee = await signupAndLogin(`fb-committee2-${randomUUID()}@example.com`, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`fb-resident1b-${randomUUID()}@example.com`, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`fb-resident2b-${randomUUID()}@example.com`, flatIds[7], OccupancyRole.OWNER_OCCUPIER);

    const createRes = await resident1.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendorId, category: 'Groceries', title: 'Bulk atta order', proposedMinimum: 3, closesAt: futureIso(86_400_000) })
      .expect(201);
    const poll = createRes.body as ResidentPollBody;

    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);

    // Vendor confirms a lower minimum (2) with a discount ladder, before the 2nd resident joins.
    const confirmRes = await committee.agent
      .post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`)
      .send({ confirmedMinimum: 2, unitPrice: 1000, discountLadder: [{ minN: 2, pct: 5 }] })
      .expect(201);
    const confirmedPoll = confirmRes.body as ResidentPollBody;
    expect(confirmedPoll.status).toBe('OPEN'); // not fired yet — only 1 has joined
    expect(confirmedPoll.minCommitments).toBe(2);

    const firedRes = await resident2.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);
    const firedPoll = firedRes.body as ResidentPollBody;
    expect(firedPoll.status).toBe('FIRED');
    expect(firedPoll.bookingId).toBeTruthy();

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: firedPoll.bookingId! } });
    expect(jobCards).toHaveLength(2);
    for (const jc of jobCards) {
      expect(Number(jc.unitPrice)).toBe(950); // 1000 * (1 - 5/100)
      expect(Number(jc.appliedDiscountPct)).toBe(5);
    }
  });

  it('vendor decline: poll is CANCELLED outright; further joins are rejected', async () => {
    const committee = await signupAndLogin(`fb-committee3-${randomUUID()}@example.com`, flatIds[8], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`fb-resident1c-${randomUUID()}@example.com`, flatIds[9], OccupancyRole.OWNER_OCCUPIER);

    const createRes = await resident1.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendorId, category: 'Plumbing', title: 'Bulk pipe replacement', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(201);
    const poll = createRes.body as ResidentPollBody;

    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);

    const declineRes = await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-decline`).expect(201);
    const declined = declineRes.body as ResidentPollBody;
    expect(declined.status).toBe('CANCELLED');
    expect(declined.vendorDeclinedAt).not.toBeNull();

    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(400);
    await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`).send({ confirmedMinimum: 2, unitPrice: 1000 }).expect(400);
  });

  it('PollsService rejects BULK_BUY_RESIDENT via POST /polls — ownership split confirmed', async () => {
    const resident = await signupAndLogin(`fb-ownership-${randomUUID()}@example.com`, flatIds[10], OccupancyRole.OWNER_OCCUPIER);

    await resident.agent
      .post('/api/v1/polls')
      .send({ pollType: 'BULK_BUY_RESIDENT', title: 'Should be rejected', minCommitments: 2, closesAt: futureIso(3_600_000) })
      .expect(400);
  });

  it('weekly-recurring: rolling a WEEKLY offer past its deadline creates a fresh OPEN offer with deadline +7 days and no commitments', async () => {
    const committee = await signupAndLogin(`fb-recurring-committee-${randomUUID()}@example.com`, flatIds[12], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    const createRes = await committee.agent
      .post('/api/v1/offers')
      .send({
        vendorId,
        category: 'Groceries',
        title: 'Weekly milk delivery',
        unitPrice: 500,
        deadline: futureIso(60_000),
        discountLadder: [{ minN: 2, pct: 5 }],
        recurring: 'WEEKLY',
      })
      .expect(201);
    const offer = createRes.body as OfferBody;
    expect(offer.recurring).toBe('WEEKLY');

    // Rolling before the deadline passes is rejected.
    await committee.agent.post(`/api/v1/offers/${offer.id}/roll`).expect(400);

    // Push the deadline into the past directly via Prisma — same technique
    // polls.e2e-spec.ts uses to model "time passing" deterministically.
    await prisma.offer.update({ where: { id: offer.id }, data: { deadline: new Date(Date.now() - 1000) } });

    const rollRes = await committee.agent.post(`/api/v1/offers/${offer.id}/roll`).expect(201);
    const rolled = rollRes.body as OfferBody;
    expect(rolled.id).not.toBe(offer.id);
    expect(rolled.status).toBe('OPEN');
    expect(rolled.recurring).toBe('WEEKLY');

    const originalDeadline = await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(originalDeadline.status).toBe('EXPIRED'); // rolled-from offer no longer accepts commits

    const daysOut = (new Date(rolled.deadline).getTime() - originalDeadline.deadline.getTime()) / 86_400_000;
    expect(daysOut).toBeCloseTo(7, 0);

    const rolledCommitmentCount = await prisma.commitment.count({ where: { offerId: rolled.id } });
    expect(rolledCommitmentCount).toBe(0);

    // A non-WEEKLY (default NONE) offer can't be rolled.
    const plainOfferRes = await committee.agent
      .post('/api/v1/offers')
      .send({ vendorId, category: 'Groceries', title: 'One-off order', unitPrice: 500, deadline: futureIso(60_000), discountLadder: [{ minN: 2, pct: 5 }] })
      .expect(201);
    const plainOffer = plainOfferRes.body as OfferBody;
    await prisma.offer.update({ where: { id: plainOffer.id }, data: { deadline: new Date(Date.now() - 1000) } });
    await committee.agent.post(`/api/v1/offers/${plainOffer.id}/roll`).expect(400);
  });

  /**
   * Concurrency hardening: joinResidentPoll takes a per-poll Postgres
   * advisory lock (namespace 53, hashtext(pollId)) as the FIRST statement
   * inside its transaction — same shape as authorisePayout's own
   * PAYOUT_LOCK_NAMESPACE lock (bulk-buy.e2e-spec.ts's own concurrency
   * test) — precisely so two DIFFERENT residents racing across the
   * vendor-confirmed fire threshold on the SAME poll can't both read
   * commitmentCount >= vendorConfirmedMinimum and status=OPEN before either
   * commits, and both call fireResidentPoll. Without the lock, this test
   * reproduces the exact double-fire: two `$transaction` calls opened on
   * separate pool connections both insert their own PollCommitment, both
   * see the resulting count >= 2 and status OPEN, and both fire — two
   * Bookings, two sets of escrow Payments for one poll. With the lock, the
   * second transaction blocks on pg_advisory_xact_lock until the first
   * commits, then re-reads status FIRED and correctly skips firing.
   *
   * Fires both HTTP requests via Promise.all (neither awaited before the
   * other starts) so the two `joinResidentPoll` transactions are genuinely
   * concurrent at the Postgres connection-pool level, not just sequential
   * awaits serialized by Node's event loop — mirrors
   * bulk-buy.e2e-spec.ts's "serializes concurrent payout-authorisation
   * calls" test exactly.
   */
  it('concurrent joins racing across the vendor-confirmed fire threshold fire the poll exactly once, with no duplicate Booking/escrow Payments', async () => {
    const committee = await signupAndLogin(`fb-race-committee-${randomUUID()}@example.com`, flatIds[14], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`fb-race-resident1-${randomUUID()}@example.com`, flatIds[15], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`fb-race-resident2-${randomUUID()}@example.com`, flatIds[16], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`fb-race-resident3-${randomUUID()}@example.com`, flatIds[17], OccupancyRole.OWNER_OCCUPIER);

    const createRes = await resident1.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendorId, category: 'Groceries', title: 'Race condition bulk order', proposedMinimum: 2, closesAt: futureIso(86_400_000) })
      .expect(201);
    const poll = createRes.body as ResidentPollBody;

    // One resident joins first — commitmentCount 1.
    await resident1.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`).expect(201);

    // Vendor confirms a minimum of 2 — commitmentCount is still only 1, so this does NOT fire yet.
    const confirmRes = await committee.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/vendor-confirm`).send({ confirmedMinimum: 2, unitPrice: 1000 }).expect(201);
    expect((confirmRes.body as ResidentPollBody).status).toBe('OPEN');

    // --- The actual race: two DIFFERENT residents join concurrently,
    // together tipping the commitment count (1 -> 3) across
    // vendorConfirmedMinimum (2).
    const [res1, res2] = await Promise.all([
      resident2.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`),
      resident3.agent.post(`/api/v1/bulk-buy/polls/${poll.id}/join`),
    ]);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const finalPoll = (await committee.agent.get(`/api/v1/bulk-buy/polls/${poll.id}`).expect(200)).body as ResidentPollBody;
    expect(finalPoll.status).toBe('FIRED');
    expect(finalPoll.commitmentCount).toBe(3); // resident1 + both racers all recorded a PollCommitment, win or lose the race
    expect(finalPoll.bookingId).toBeTruthy();

    const bookings = await prisma.booking.findMany({ where: { sourceType: 'POLL', sourceId: poll.id } });
    expect(bookings).toHaveLength(1); // fired exactly once — no duplicate Booking despite the race

    // Only the 2 participants captured at the instant the poll actually
    // fired (resident1 + whichever racer's transaction won the lock first)
    // get a JobCard/Commitment/escrow Payment — the loser's PollCommitment
    // is still recorded (commitmentCount above is 3), but it lands after
    // the poll is already FIRED, so fireResidentPoll never picks it up.
    // That's the same "a late commitment after fire is never picked up"
    // behavior Flow A's own commit() has always had — this test is only
    // about closing the double-fire hazard, not about that orphan case.
    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: bookings[0].id } });
    expect(jobCards).toHaveLength(2);

    const commitments = await prisma.commitment.findMany({ where: { pollId: poll.id, paymentId: { not: null } } });
    expect(commitments).toHaveLength(2); // exactly one funded-escrow Commitment per JobCard — no duplicates

    const payments = await prisma.payment.findMany({ where: { linkedEntityType: 'Commitment', linkedEntityId: { in: commitments.map((c) => c.id) } } });
    expect(payments).toHaveLength(2); // no duplicate escrow Payments
  });
});
