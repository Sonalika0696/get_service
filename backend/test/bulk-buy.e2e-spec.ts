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
 * Phase 4C (bulk-buy Flow A) Definition of Done, end-to-end against real
 * Postgres, RAZORPAY_ENABLED=false (the deterministic stub used by both
 * Phase 4B payments AND this phase's vendor payout — see
 * src/infra/razorpay/razorpay.service.ts's payout() doc comment: it is
 * ALWAYS stubbed, never gated on RAZORPAY_ENABLED, so no real money ever
 * moves in this suite):
 *  - a committee member creates an Offer with a 3-rung discount ladder;
 *    malformed ladders (empty / non-increasing minN / decreasing pct /
 *    duplicate minN) are rejected with 400;
 *  - two residents commit; the 2nd commit auto-fires the offer in the same
 *    request: status FIRED, appliedDiscountPct snapshotted from the ladder,
 *    one Booking + one JobCard per commitment (discounted unitPrice), and
 *    each commitment has its own escrow-in Payment(CREATED);
 *  - signing off a job card before its commitment is FUNDED is rejected
 *    (400) — the payment-before-sign-off gate;
 *  - each resident "pays" via a signed payment.captured webhook (the same
 *    Phase 4B webhook path, unmodified): BULK_BUY is credited, and the
 *    linked Commitment flips PENDING -> FUNDED reactively;
 *  - each resident signs off their own job card (a resident signing off
 *    someone else's card gets 403); the booking flips to COMPLETED only
 *    once every job card is signed off;
 *  - authorising a payout before the booking is COMPLETED is rejected
 *    (400) — the sign-off-before-payout gate; a plain resident gets 403;
 *  - Phase 6.4 (M14): a treasurer's authorisation call records ONE distinct
 *    officer authorisation and — since this suite's amounts are under the
 *    society's default approval-ladder lowerThreshold (rung 1: 1 officer
 *    suffices) — executes the payout in the same call, exactly once: the
 *    full escrowed amount to EXTERNAL (no commission — V2.0 invariant I2),
 *    BULK_BUY back to its pre-booking level, and EXTERNAL netting to zero:
 *    every rupee that came in went back out. Re-calling authorise does NOT
 *    double-pay. The multi-rung ladder itself (rung 2/3, DEPUTY_TREASURER,
 *    same-identity no-op) is exercised in approval-ladder.e2e-spec.ts;
 *  - committing to an already-FIRED offer is rejected (400);
 *  - conservation holds throughout: GET /ledger's balancesIntact stays true.
 *
 * Phase 4D (LARGE-tier milestones + defect-liability retention) is exercised
 * further down this file: a LARGE offer's milestoneTemplate is validated the
 * same way (bad templates / a LARGE offer missing one -> 400); firing
 * creates ordered Milestone rows and a retentionReleaseAt; the SMALL
 * payout/authorise route rejects a LARGE booking and vice versa; milestones
 * release strictly in order; the FIRST milestone authorisation also sets
 * aside retention (BULK_BUY -> RETENTION),
 * the LAST milestone releases whatever of vendorPayable remains (no rounding
 * dust); retention can only be released once every milestone is PAID and
 * the defect-liability period has elapsed (RETENTION -> EXTERNAL); every
 * authorisation route is idempotent and safe under concurrent calls. No
 * Phase 5 (resident-initiated polls/weekly-recurring bulk-buy) concepts are
 * exercised here.
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
  status: 'OPEN' | 'FIRED' | 'EXPIRED' | 'CANCELLED';
  minCommitments: number;
  commitmentCount: number;
  currentTierPct: number | string | null;
  nextTierAt: number | null;
  appliedDiscountPct: string | number | null;
  hasCommitted?: boolean;
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
  bookingId: string;
  amount: string | number;
  status: 'PENDING' | 'AUTHORISED' | 'PAID';
  razorpayPayoutRef: string | null;
}

interface MilestoneBody {
  id: string;
  bookingId: string;
  sequence: number;
  name: string;
  pct: string | number;
  status: 'PENDING' | 'AUTHORISED' | 'PAID';
  amount: string | number | null;
  paidAt: string | null;
  razorpayPayoutRef: string | null;
}

interface BookingBody {
  id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  tier?: 'SMALL' | 'LARGE';
  jobCards: JobCardBody[];
  payout: PayoutBody | null;
  milestones: MilestoneBody[];
  retentionAmount?: string | number;
  retentionReleaseAt?: string | null;
  retentionReleasedAt?: string | null;
  retentionSetAside?: boolean;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

describe('Bulk-buy Flow A (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let cookieName: string;
  let webhookSecret: string;

  let societyId: string;
  let vendorId: string;
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

    const society = await prisma.society.create({ data: { name: 'Bulk-Buy Test Society', address: 'n/a' } });
    societyId = society.id;
    // flats 0-4: SMALL sequential-flow test. 5-8: SMALL concurrent-payout
    // test. 9-12: LARGE sequential-flow test (Phase 4D). 13-16: LARGE
    // concurrent-milestone-authorisation test (Phase 4D). Kept separate so
    // no two tests' users/bookings ever overlap.
    for (let i = 0; i < 17; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `B-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }

    const vendor = await prisma.vendor.create({ data: { societyId, name: 'Bulk-Buy Test Vendor', contactEmail: 'vendor@example.com' } });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId } } } });
    await prisma.payout.deleteMany({ where: { booking: { societyId } } });
    await prisma.milestoneAuthorisation.deleteMany({ where: { milestone: { booking: { societyId } } } });
    await prisma.milestone.deleteMany({ where: { booking: { societyId } } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
    await prisma.booking.deleteMany({ where: { societyId } });
    await prisma.commitment.deleteMany({ where: { offer: { societyId } } });
    await prisma.offer.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.vendor.deleteMany({ where: { societyId } });
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

  it('runs the full offer -> commit -> fire -> escrow -> sign-off -> dual-auth payout chain', async () => {
    const committee = await signupAndLogin(`bb-committee-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const treasurer = await signupAndLogin(`bb-treasurer-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    const resident1 = await signupAndLogin(`bb-resident1-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`bb-resident2-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`bb-resident3-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);

    // Snapshot ledger before any money moves, so this suite's assertions are
    // independent of anything another suite left behind in a shared account.
    const startLedger = await ledgerBalances(committee.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
    const externalStart = balanceOf(startLedger, AccountKind.EXTERNAL);

    // --- 1. Offer creation: bad ladders rejected with 400 ---
    const baseOffer = { vendorId, category: 'Groceries', title: 'Bulk rice order', description: 'Bulk-buy of rice sacks', unitPrice: 1000, deadline: new Date(Date.now() + 86_400_000).toISOString() };

    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: [] }).expect(400);
    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: [{ minN: 4, pct: 5 }, { minN: 2, pct: 10 }] }).expect(400);
    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: [{ minN: 2, pct: 10 }, { minN: 4, pct: 5 }] }).expect(400);
    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: [{ minN: 2, pct: 5 }, { minN: 2, pct: 8 }] }).expect(400);

    // Non-committee residents can't create offers.
    await resident1.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: [{ minN: 2, pct: 5 }] }).expect(403);

    const ladder = [
      { minN: 2, pct: 5 },
      { minN: 4, pct: 10 },
      { minN: 6, pct: 15 },
    ];
    const createRes = await committee.agent.post('/api/v1/offers').send({ ...baseOffer, discountLadder: ladder }).expect(201);
    const offer = createRes.body as OfferBody;
    expect(offer.status).toBe('OPEN');
    expect(offer.minCommitments).toBe(2);

    // --- 2. Two residents commit; the 2nd fires the offer ---
    const firstCommitRes = await resident1.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    const afterFirstCommit = firstCommitRes.body as OfferBody;
    expect(afterFirstCommit.status).toBe('OPEN');
    expect(afterFirstCommit.commitmentCount).toBe(1);

    const secondCommitRes = await resident2.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    const firedOffer = secondCommitRes.body as OfferBody;
    expect(firedOffer.status).toBe('FIRED');
    expect(firedOffer.commitmentCount).toBe(2);
    expect(Number(firedOffer.appliedDiscountPct)).toBe(5);

    const booking = await prisma.booking.findFirstOrThrow({ where: { societyId, sourceType: 'OFFER', sourceId: offer.id } });
    expect(booking.status).toBe('ACTIVE');

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' } });
    expect(jobCards).toHaveLength(2);
    for (const jc of jobCards) {
      expect(Number(jc.unitPrice)).toBe(950);
      expect(Number(jc.appliedDiscountPct)).toBe(5);
      expect(jc.status).toBe('PENDING');
    }

    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    expect(commitments).toHaveLength(2);
    for (const c of commitments) {
      expect(c.paymentId).toBeTruthy();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId! } });
      expect(payment.status).toBe('CREATED');
      expect(payment.linkedEntityType).toBe('Commitment');
      expect(payment.linkedEntityId).toBe(c.id);
      expect(c.status).toBe('PENDING');
    }

    // --- Guard: committing to an already-FIRED offer is rejected ---
    await resident3.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(400);

    const resident1Commitment = commitments.find((c) => c.residentId === resident1.userId)!;
    const resident2Commitment = commitments.find((c) => c.residentId === resident2.userId)!;
    const resident1JobCard = jobCards.find((jc) => jc.commitmentId === resident1Commitment.id)!;
    const resident2JobCard = jobCards.find((jc) => jc.commitmentId === resident2Commitment.id)!;

    // --- Guard: sign-off before payment is rejected ---
    await resident1.agent.post(`/api/v1/job-cards/${resident1JobCard.id}/sign-off`).expect(400);

    // --- Guard: payout authorisation before the booking is COMPLETED is rejected ---
    await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(400);

    // --- 3. Each resident pays: escrow BULK_BUY credited, commitment FUNDED ---
    await payCommitment(resident1Commitment.id, 950);
    const resident1CommitmentAfterPay = await prisma.commitment.findUniqueOrThrow({ where: { id: resident1Commitment.id } });
    expect(resident1CommitmentAfterPay.status).toBe('FUNDED');

    await payCommitment(resident2Commitment.id, 950);
    const resident2CommitmentAfterPay = await prisma.commitment.findUniqueOrThrow({ where: { id: resident2Commitment.id } });
    expect(resident2CommitmentAfterPay.status).toBe('FUNDED');

    const afterEscrowLedger = await ledgerBalances(committee.agent);
    expect(afterEscrowLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterEscrowLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(1900, 6);

    // --- 4. Sign-off: own card only; booking completes once both are signed off ---
    await resident2.agent.post(`/api/v1/job-cards/${resident1JobCard.id}/sign-off`).expect(403);

    const signOff1 = await resident1.agent.post(`/api/v1/job-cards/${resident1JobCard.id}/sign-off`).expect(201);
    expect((signOff1.body as JobCardBody).status).toBe('SIGNED_OFF');

    const bookingMidSignOff = (await committee.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingMidSignOff.status).toBe('ACTIVE'); // not yet COMPLETED — resident2 hasn't signed off

    // Payout attempted before booking is fully COMPLETED still 400.
    await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(400);

    const signOff2 = await resident2.agent.post(`/api/v1/job-cards/${resident2JobCard.id}/sign-off`).expect(201);
    expect((signOff2.body as JobCardBody).status).toBe('SIGNED_OFF');

    const bookingCompleted = (await committee.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingCompleted.status).toBe('COMPLETED');
    expect(bookingCompleted.payout).toBeNull(); // no Payout row exists until a treasurer authorises

    // --- 5. Dual-authorised payout ---
    await resident1.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(403);

    const authRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(201);
    const paidBooking = authRes.body as BookingBody;
    expect(paidBooking.payout).not.toBeNull();
    expect(paidBooking.payout!.status).toBe('PAID');
    expect(Number(paidBooking.payout!.amount)).toBe(1900);
    expect(paidBooking.payout!.razorpayPayoutRef).toMatch(/^payout_stub_/);

    // Phase 6.4: authorisation rows are keyed by DISTINCT authoriserId, not
    // a SYSTEM/TREASURER kind pair (see bulk-buy.service.ts's
    // authorisePayout doc comment) — 1 officer suffices here because the
    // amount (1900) is under the society's default approval-ladder
    // lowerThreshold (rung 1), so the treasurer's single call both
    // authorises and executes.
    const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId: paidBooking.payout!.id } });
    expect(authorisations).toHaveLength(1);
    expect(authorisations[0].authoriserId).toBe(treasurer.userId);

    const afterPayoutLedger = await ledgerBalances(committee.agent);
    expect(afterPayoutLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterPayoutLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
    // EXTERNAL was debited 1900 at capture (money coming in) and credited
    // 1900 at payout (money going back out to the vendor) — net zero. The
    // platform retains nothing (invariant I2).
    expect(balanceOf(afterPayoutLedger, AccountKind.EXTERNAL) - externalStart).toBeCloseTo(0, 6);

    const vendorEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payout', linkedEntityId: paidBooking.payout!.id, reasonCode: 'BULK_BUY_PAYOUT_VENDOR' } });
    expect(vendorEntryCount).toBe(1);
    const totalPayoutEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payout', linkedEntityId: paidBooking.payout!.id } });
    expect(totalPayoutEntryCount).toBe(1); // a single vendor posting — no commission leg

    // --- Re-calling authorise does NOT double-pay ---
    const replayRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(201);
    const replayBooking = replayRes.body as BookingBody;
    expect(replayBooking.payout!.status).toBe('PAID');
    expect(replayBooking.payout!.razorpayPayoutRef).toBe(paidBooking.payout!.razorpayPayoutRef);

    const vendorEntryCountAfterReplay = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payout', linkedEntityId: paidBooking.payout!.id, reasonCode: 'BULK_BUY_PAYOUT_VENDOR' } });
    expect(vendorEntryCountAfterReplay).toBe(1); // still exactly one — no double payout

    const finalLedger = await ledgerBalances(committee.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
  });

  /**
   * Concurrency hardening: authorisePayout takes a per-booking Postgres
   * advisory lock (namespace 52, hashtext(bookingId)) as the FIRST statement
   * inside its transaction, precisely so two treasurer requests racing on
   * the SAME booking can't both observe a pre-payout snapshot and both post
   * the payout ledger entries. Without that lock, this test reproduces the
   * exact double-pay: two `$transaction` calls opened on separate pool
   * connections both read Payout as PENDING (or absent) before either
   * commits, both pass the authCount>=2 guard, and both credit
   * EXTERNAL — draining BULK_BUY twice for one booking. With
   * the lock, the second transaction blocks on pg_advisory_xact_lock until
   * the first commits, then re-reads and finds Payout.status already PAID,
   * making its own guard a true no-op.
   *
   * Fires both HTTP requests via Promise.all (neither awaited before the
   * other starts) so the two `authorisePayout` transactions are genuinely
   * concurrent at the Postgres connection-pool level, not just sequential
   * awaits serialized by Node's single-threaded event loop.
   */
  it('serializes concurrent payout-authorisation calls on the same booking so the vendor is paid exactly once', async () => {
    const committee2 = await signupAndLogin(`bb-committee2-${randomUUID()}@example.com`, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee2.userId, RoleKind.COMMITTEE);
    const treasurer2 = await signupAndLogin(`bb-treasurer2-${randomUUID()}@example.com`, flatIds[6], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer2.userId, RoleKind.TREASURER);
    const residentA = await signupAndLogin(`bb-residentA-${randomUUID()}@example.com`, flatIds[7], OccupancyRole.OWNER_OCCUPIER);
    const residentB = await signupAndLogin(`bb-residentB-${randomUUID()}@example.com`, flatIds[8], OccupancyRole.OWNER_OCCUPIER);

    const startLedger = await ledgerBalances(committee2.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
    const externalStart = balanceOf(startLedger, AccountKind.EXTERNAL);

    const ladder = [{ minN: 2, pct: 5 }];
    const createRes = await committee2.agent
      .post('/api/v1/offers')
      .send({ vendorId, category: 'Groceries', title: 'Concurrency test order', unitPrice: 1000, deadline: new Date(Date.now() + 86_400_000).toISOString(), discountLadder: ladder })
      .expect(201);
    const offer = createRes.body as OfferBody;

    await residentA.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    const fireRes = await residentB.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    expect((fireRes.body as OfferBody).status).toBe('FIRED');

    const booking = await prisma.booking.findFirstOrThrow({ where: { societyId, sourceType: 'OFFER', sourceId: offer.id } });
    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    expect(commitments).toHaveLength(2);
    for (const c of commitments) {
      await payCommitment(c.id, 950);
    }

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    for (const jc of jobCards) {
      const resident = jc.residentId === residentA.userId ? residentA : residentB;
      await resident.agent.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    const bookingReady = (await committee2.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingReady.status).toBe('COMPLETED');
    expect(bookingReady.payout).toBeNull(); // no Payout row exists yet — created by the first authorise call below

    // --- The actual race: two authorise calls in flight at once ---
    const [res1, res2] = await Promise.all([
      treasurer2.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`),
      treasurer2.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`),
    ]);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = res1.body as BookingBody;
    const body2 = res2.body as BookingBody;
    expect(body1.payout).not.toBeNull();
    expect(body2.payout).not.toBeNull();
    expect(body1.payout!.status).toBe('PAID');
    expect(body2.payout!.status).toBe('PAID');
    expect(body1.payout!.id).toBe(body2.payout!.id); // both calls resolved the same Payout row

    const payoutId = body1.payout!.id;
    const authorisations = await prisma.payoutAuthorisation.findMany({ where: { payoutId } });
    // Phase 6.4: both racing calls are the SAME treasurer identity, so this
    // also exercises the same-identity no-double-count guard (@@unique on
    // [payoutId, authoriserId] + the upsert no-op) at the same time as the
    // advisory-lock double-pay guard — exactly 1 distinct-officer row,
    // which is already >= this amount's rung-1 requirement (1 officer).
    expect(authorisations).toHaveLength(1);
    expect(authorisations[0].authoriserId).toBe(treasurer2.userId);

    const vendorEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Payout', linkedEntityId: payoutId, reasonCode: 'BULK_BUY_PAYOUT_VENDOR' } });
    expect(vendorEntryCount).toBe(1); // paid exactly once, despite the race

    const finalLedger = await ledgerBalances(committee2.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    // amount = 1900 (2 x 950), paid in full — drained from BULK_BUY exactly
    // once, not twice.
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
    expect(balanceOf(finalLedger, AccountKind.EXTERNAL) - externalStart).toBeCloseTo(0, 6);
  });

  /**
   * Phase 4D — LARGE-tier: offer -> commit -> fire (creates ordered
   * Milestones + a retentionReleaseAt) -> escrow -> sign-off -> in-order
   * dual-authorised milestone releases -> defect-liability retention
   * release. Money flow for T=1900 (2 residents x 950, same 5%-off ladder
   * tier as the SMALL test), 40/60 milestone split, retentionPct 10%, no
   * commission (V2.0, invariant I2):
   *   retention = 190 -> RETENTION (set aside once, at milestone #1's
   *     authorisation)
   *   vendorPayable = 1900 - 190 = 1710
   *   milestone #1 (Advance, 40%)    = 1710 * 0.40 = 684  -> EXTERNAL
   *   milestone #2 (Completion, 60%) = 1710 - 684  = 1026 -> EXTERNAL
   *     (the LAST milestone always takes whatever of vendorPayable remains,
   *     rather than 1710 * 0.60 exactly, so rounding dust never gets
   *     stranded in BULK_BUY — irrelevant to the arithmetic here since
   *     1710 * 0.60 is exactly 1026 too, but exercised by construction)
   *   retention (190) is released later, once every milestone is PAID and
   *     Clock.now() has reached retentionReleaseAt: RETENTION -> EXTERNAL.
   * So EXTERNAL's net delta across the whole chain is exactly zero: -1900 in
   * at escrow, +684 +1026 +190 back out. The platform retains nothing.
   */
  it('runs the full LARGE-tier chain: ordered milestone releases + defect-liability retention (Phase 4D)', async () => {
    const committee = await signupAndLogin(`bb-committee-large-${randomUUID()}@example.com`, flatIds[9], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const treasurer = await signupAndLogin(`bb-treasurer-large-${randomUUID()}@example.com`, flatIds[10], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    const resident1 = await signupAndLogin(`bb-resident1-large-${randomUUID()}@example.com`, flatIds[11], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`bb-resident2-large-${randomUUID()}@example.com`, flatIds[12], OccupancyRole.OWNER_OCCUPIER);

    const startLedger = await ledgerBalances(committee.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
    const retentionStart = balanceOf(startLedger, AccountKind.RETENTION);
    const externalStart = balanceOf(startLedger, AccountKind.EXTERNAL);

    const baseOffer = {
      vendorId,
      category: 'Renovation',
      title: 'Large lobby renovation',
      description: 'Bulk-buy of a large renovation job',
      unitPrice: 1000,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      discountLadder: [{ minN: 2, pct: 5 }],
      tier: 'LARGE',
    };

    // --- 1. Offer creation: bad milestone templates rejected with 400 ---
    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, milestoneTemplate: [], retentionPct: 10, retentionDays: 30 }).expect(400);
    await committee.agent
      .post('/api/v1/offers')
      .send({ ...baseOffer, milestoneTemplate: [{ name: 'Advance', pct: 40 }, { name: 'Completion', pct: 50 }], retentionPct: 10, retentionDays: 30 })
      .expect(400); // sums to 90, not 100
    await committee.agent
      .post('/api/v1/offers')
      .send({ ...baseOffer, milestoneTemplate: [{ name: 'Advance', pct: 0 }, { name: 'Completion', pct: 100 }], retentionPct: 10, retentionDays: 30 })
      .expect(400); // pct <= 0
    // A LARGE offer missing milestoneTemplate entirely is also rejected.
    await committee.agent.post('/api/v1/offers').send({ ...baseOffer, retentionPct: 10, retentionDays: 30 }).expect(400);

    const milestoneTemplate = [
      { name: 'Advance', pct: 40 },
      { name: 'Completion', pct: 60 },
    ];
    const createRes = await committee.agent.post('/api/v1/offers').send({ ...baseOffer, milestoneTemplate, retentionPct: 10, retentionDays: 30 }).expect(201);
    const offer = createRes.body as OfferBody;
    expect(offer.status).toBe('OPEN');

    // --- 2. Two residents commit; the 2nd fires the offer ---
    await resident1.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    const fireRes = await resident2.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    expect((fireRes.body as OfferBody).status).toBe('FIRED');

    const booking = await prisma.booking.findFirstOrThrow({ where: { societyId, sourceType: 'OFFER', sourceId: offer.id } });
    expect(booking.tier).toBe('LARGE');
    expect(booking.retentionReleaseAt).not.toBeNull();
    const daysOut = (booking.retentionReleaseAt!.getTime() - booking.createdAt.getTime()) / 86_400_000;
    expect(daysOut).toBeCloseTo(30, 0);

    const milestoneRows = await prisma.milestone.findMany({ where: { bookingId: booking.id }, orderBy: { sequence: 'asc' } });
    expect(milestoneRows).toHaveLength(2);
    expect(milestoneRows[0].name).toBe('Advance');
    expect(Number(milestoneRows[0].pct)).toBe(40);
    expect(milestoneRows[0].status).toBe('PENDING');
    expect(milestoneRows[1].name).toBe('Completion');
    expect(Number(milestoneRows[1].pct)).toBe(60);
    expect(milestoneRows[1].status).toBe('PENDING');

    // --- 3. Both residents pay; sign off both job cards; booking completes ---
    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    expect(commitments).toHaveLength(2);
    for (const c of commitments) {
      await payCommitment(c.id, 950);
    }

    const afterEscrowLedger = await ledgerBalances(committee.agent);
    expect(afterEscrowLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterEscrowLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(1900, 6);

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    expect(jobCards).toHaveLength(2);
    for (const jc of jobCards) {
      const resident = jc.residentId === resident1.userId ? resident1 : resident2;
      await resident.agent.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    const bookingCompleted = (await committee.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingCompleted.status).toBe('COMPLETED');
    expect(bookingCompleted.milestones).toHaveLength(2);

    // --- 4. The SMALL payout route rejects a LARGE booking ---
    await treasurer.agent.post(`/api/v1/bookings/${booking.id}/payout/authorise`).expect(400);

    // --- 5. Out-of-order milestone authorisation is rejected ---
    await treasurer.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestoneRows[1].id}/authorise`).expect(400);

    // --- 6. Milestone #1: non-treasurer 403; treasurer sets aside retention
    //        and releases the Advance share; replay is a no-op ---
    await resident1.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestoneRows[0].id}/authorise`).expect(403);

    const m1Res = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestoneRows[0].id}/authorise`).expect(201);
    const bookingAfterM1 = m1Res.body as BookingBody;
    const m1 = bookingAfterM1.milestones.find((m) => m.id === milestoneRows[0].id)!;
    expect(m1.status).toBe('PAID');
    expect(Number(m1.amount)).toBe(684);
    expect(m1.razorpayPayoutRef).toMatch(/^payout_stub_/);
    expect(Number(bookingAfterM1.retentionAmount)).toBe(190);
    expect(bookingAfterM1.retentionSetAside).toBe(true);

    // Phase 6.4: 1 distinct-officer row suffices — 684 is under the
    // society's default approval-ladder lowerThreshold (rung 1).
    const m1Authorisations = await prisma.milestoneAuthorisation.findMany({ where: { milestoneId: milestoneRows[0].id } });
    expect(m1Authorisations).toHaveLength(1);
    expect(m1Authorisations[0].authoriserId).toBe(treasurer.userId);

    const afterM1Ledger = await ledgerBalances(committee.agent);
    expect(afterM1Ledger.balancesIntact).toBe(true);
    expect(balanceOf(afterM1Ledger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(1900 - 190 - 684, 6);
    expect(balanceOf(afterM1Ledger, AccountKind.RETENTION) - retentionStart).toBeCloseTo(190, 6);

    // Re-authorise #1 -> idempotent no-op: exactly one payout ledger entry,
    // balances unchanged.
    const m1ReplayRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestoneRows[0].id}/authorise`).expect(201);
    expect((m1ReplayRes.body as BookingBody).milestones.find((m) => m.id === milestoneRows[0].id)!.status).toBe('PAID');
    const m1PayoutEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Milestone', linkedEntityId: milestoneRows[0].id, reasonCode: 'BULK_BUY_MILESTONE_PAYOUT' } });
    expect(m1PayoutEntryCount).toBe(1);
    const m1RetentionHoldEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Booking', linkedEntityId: booking.id, reasonCode: 'BULK_BUY_MILESTONE_RETENTION_HOLD' } });
    expect(m1RetentionHoldEntryCount).toBe(1);
    const afterM1ReplayLedger = await ledgerBalances(committee.agent);
    expect(balanceOf(afterM1ReplayLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(1900 - 190 - 684, 6);

    // --- 7. Milestone #2 (last): releases whatever of vendorPayable remains ---
    const m2Res = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestoneRows[1].id}/authorise`).expect(201);
    const bookingAfterM2 = m2Res.body as BookingBody;
    const m2 = bookingAfterM2.milestones.find((m) => m.id === milestoneRows[1].id)!;
    expect(m2.status).toBe('PAID');
    expect(Number(m2.amount)).toBe(1026);

    const afterM2Ledger = await ledgerBalances(committee.agent);
    expect(afterM2Ledger.balancesIntact).toBe(true);
    expect(balanceOf(afterM2Ledger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6); // vendorPayable fully released
    expect(balanceOf(afterM2Ledger, AccountKind.RETENTION) - retentionStart).toBeCloseTo(190, 6); // still held — not released yet

    // --- 8. Retention release: too early -> 400; then fast-forward past the
    //        defect-liability period and release; replay is a no-op ---
    await treasurer.agent.post(`/api/v1/bookings/${booking.id}/retention/release`).expect(400);

    await prisma.booking.update({ where: { id: booking.id }, data: { retentionReleaseAt: new Date(Date.now() - 1000) } });

    const releaseRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/retention/release`).expect(201);
    const releasedBooking = releaseRes.body as BookingBody;
    expect(releasedBooking.retentionReleasedAt).not.toBeNull();

    const afterReleaseLedger = await ledgerBalances(committee.agent);
    expect(afterReleaseLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterReleaseLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
    expect(balanceOf(afterReleaseLedger, AccountKind.RETENTION) - retentionStart).toBeCloseTo(0, 6);
    expect(balanceOf(afterReleaseLedger, AccountKind.EXTERNAL) - externalStart).toBeCloseTo(0, 6); // nets to zero, exactly as the SMALL flow's own invariant

    const releaseReplayRes = await treasurer.agent.post(`/api/v1/bookings/${booking.id}/retention/release`).expect(201);
    expect((releaseReplayRes.body as BookingBody).retentionReleasedAt).toBe(releasedBooking.retentionReleasedAt);
    const retentionReleaseEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Booking', linkedEntityId: booking.id, reasonCode: 'RETENTION_RELEASE' } });
    expect(retentionReleaseEntryCount).toBe(1); // still exactly one — no double release

    const finalLedger = await ledgerBalances(committee.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
  });

  /**
   * Concurrency hardening for the LARGE-tier flow, mirroring the SMALL
   * flow's own concurrency test above: authoriseMilestone takes the SAME
   * per-booking advisory lock (namespace 52, hashtext(bookingId)) as
   * authorisePayout as its very first statement, so two treasurer requests
   * racing on the SAME milestone can't both observe a pre-release snapshot
   * and both post the release ledger entries. A single-milestone (100%)
   * LARGE booking keeps this focused purely on the race, independent of the
   * ordering/last-milestone-remainder logic already covered above.
   */
  it('serializes concurrent milestone-authorisation calls on the same milestone so the vendor is paid exactly once', async () => {
    const committee3 = await signupAndLogin(`bb-committee-large2-${randomUUID()}@example.com`, flatIds[13], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee3.userId, RoleKind.COMMITTEE);
    const treasurer3 = await signupAndLogin(`bb-treasurer-large2-${randomUUID()}@example.com`, flatIds[14], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer3.userId, RoleKind.TREASURER);
    const residentC = await signupAndLogin(`bb-residentC-large-${randomUUID()}@example.com`, flatIds[15], OccupancyRole.OWNER_OCCUPIER);
    const residentD = await signupAndLogin(`bb-residentD-large-${randomUUID()}@example.com`, flatIds[16], OccupancyRole.OWNER_OCCUPIER);

    const startLedger = await ledgerBalances(committee3.agent);
    const bulkBuyStart = balanceOf(startLedger, AccountKind.BULK_BUY);
    const retentionStart = balanceOf(startLedger, AccountKind.RETENTION);

    const milestoneTemplate = [{ name: 'Full payment', pct: 100 }];
    const createRes = await committee3.agent
      .post('/api/v1/offers')
      .send({
        vendorId,
        category: 'Renovation',
        title: 'Concurrency LARGE test',
        unitPrice: 1000,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        discountLadder: [{ minN: 2, pct: 5 }],
        tier: 'LARGE',
        milestoneTemplate,
        retentionPct: 10,
        retentionDays: 30,
      })
      .expect(201);
    const offer = createRes.body as OfferBody;

    await residentC.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    const fireRes = await residentD.agent.post(`/api/v1/offers/${offer.id}/commit`).expect(201);
    expect((fireRes.body as OfferBody).status).toBe('FIRED');

    const booking = await prisma.booking.findFirstOrThrow({ where: { societyId, sourceType: 'OFFER', sourceId: offer.id } });
    const commitments = await prisma.commitment.findMany({ where: { offerId: offer.id } });
    expect(commitments).toHaveLength(2);
    for (const c of commitments) {
      await payCommitment(c.id, 950);
    }

    const jobCards = await prisma.jobCard.findMany({ where: { bookingId: booking.id } });
    for (const jc of jobCards) {
      const resident = jc.residentId === residentC.userId ? residentC : residentD;
      await resident.agent.post(`/api/v1/job-cards/${jc.id}/sign-off`).expect(201);
    }

    const bookingReady = (await committee3.agent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body as BookingBody;
    expect(bookingReady.status).toBe('COMPLETED');
    const milestone = bookingReady.milestones[0];
    expect(milestone.status).toBe('PENDING');

    // --- The actual race: two authorise calls in flight at once ---
    const [res1, res2] = await Promise.all([
      treasurer3.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestone.id}/authorise`),
      treasurer3.agent.post(`/api/v1/bookings/${booking.id}/milestones/${milestone.id}/authorise`),
    ]);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = res1.body as BookingBody;
    const body2 = res2.body as BookingBody;
    const m1 = body1.milestones.find((m) => m.id === milestone.id)!;
    const m2 = body2.milestones.find((m) => m.id === milestone.id)!;
    expect(m1.status).toBe('PAID');
    expect(m2.status).toBe('PAID');

    // Phase 6.4: same-identity race (both calls are treasurer3) — exactly 1
    // distinct-officer row, already sufficient for this amount's rung-1
    // requirement (1 officer).
    const authorisations = await prisma.milestoneAuthorisation.findMany({ where: { milestoneId: milestone.id } });
    expect(authorisations).toHaveLength(1);
    expect(authorisations[0].authoriserId).toBe(treasurer3.userId);

    const payoutEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Milestone', linkedEntityId: milestone.id, reasonCode: 'BULK_BUY_MILESTONE_PAYOUT' } });
    const retentionHoldEntryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'Booking', linkedEntityId: booking.id, reasonCode: 'BULK_BUY_MILESTONE_RETENTION_HOLD' } });
    expect(payoutEntryCount).toBe(1); // paid exactly once, despite the race
    expect(retentionHoldEntryCount).toBe(1);

    const finalLedger = await ledgerBalances(committee3.agent);
    expect(finalLedger.balancesIntact).toBe(true);
    // T = 1900 (2 x 950), retention = 190, vendor = 1710 —
    // the single (100%) milestone releases the full 1710, drained from
    // BULK_BUY exactly once, not twice.
    expect(balanceOf(finalLedger, AccountKind.BULK_BUY) - bulkBuyStart).toBeCloseTo(0, 6);
    expect(balanceOf(finalLedger, AccountKind.RETENTION) - retentionStart).toBeCloseTo(190, 6);
  });
});
