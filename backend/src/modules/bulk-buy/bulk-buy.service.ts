import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, BookingStatus, CommitmentStatus, JobCardStatus, JobCardTier, OfferStatus, PayoutAuthKind, PayoutStatus } from '../../generated/prisma/enums.js';
import type { BookingModel, JobCardModel, MilestoneModel, OfferModel, PayoutModel } from '../../generated/prisma/models.js';
import { appliedTier, minCommitmentsOf, nextTierThreshold, validateLadder, type LadderRung } from './discount-ladder.util.js';
import { validateMilestoneTemplate, type MilestoneTemplateRung } from './milestone-template.util.js';
import type { CreateOfferDto } from './dto/create-offer.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

const DEFAULT_COMMISSION_PCT = 10;
/** Same namespace BulkBuyService.authorisePayout has always used — see its
 * doc comment. Milestones (4D) and the SMALL single-shot payout (4C) are
 * mutually exclusive per booking (a booking is either SMALL or LARGE, never
 * both), so sharing the namespace is safe and keeps every money-moving call
 * on a given booking serialized against every other one. */
const PAYOUT_LOCK_NAMESPACE = 52;

/** API-facing shape: the offer row plus a live tier readout. */
export type OfferDetail = OfferModel & {
  commitmentCount: number;
  currentTierPct: number | null;
  nextTierAt: number | null;
  hasCommitted?: boolean;
};

/** API-facing shape: a booking plus its job cards, payout state (SMALL) and milestones (LARGE). */
export type BookingDetail = BookingModel & {
  jobCards: JobCardModel[];
  payout: PayoutModel | null;
  milestones: MilestoneModel[];
};

/**
 * Phase 4C — vendor-initiated bulk-buy (Flow A): offer -> resident commit
 * -> auto-fire -> escrow -> job cards -> sign-off -> dual-authorised payout.
 * Phase 4D extends this with a LARGE-tier variant of the same flow for big
 * jobs: the vendor is paid across ordered Milestones instead of one payout,
 * and a defect-liability Retention share is held back and released later.
 * Builds directly on the Phase 4A ledger (LedgerService) and Phase 4B
 * payments (PaymentsService, RazorpayService's stub) — see this class's
 * method-level doc comments for the exact money flow.
 *
 * v1 assumption (documented, not hidden): there is no vendor login/session
 * yet, so a vendor never calls these routes itself. A COMMITTEE member
 * creates an Offer "on the vendor's behalf" by naming an existing Vendor id
 * in the request body. A real vendor-authenticated flow is future work.
 *
 * Money flow summary, SMALL (see authorisePayout for the code):
 *   commit (escrow-in, via PaymentsService.createOrderForLink + the
 *     existing Phase 4B webhook path) posts EXTERNAL -> BULK_BUY per
 *     resident, exactly like any other payment capture.
 *   payout (escrow-out) posts, in one transaction:
 *     BULK_BUY -> COMMISSION_SINK   (the platform's commission share)
 *     BULK_BUY -> EXTERNAL          (the vendor's net share leaving the
 *                                    closed ledger set — see schema.prisma's
 *                                    Ledger section doc comment for why
 *                                    crediting EXTERNAL means money leaving)
 *   This conserves the total exactly: commission + vendorNet == amount ==
 *   what BULK_BUY held for this booking, so BULK_BUY nets back to (at least)
 *   zero for this booking's contribution once paid.
 *
 * Money flow summary, LARGE (see authoriseMilestone / releaseRetention for
 * the code). For an escrowed total T (sum of the booking's discounted
 * job-card prices), commissionPct c, retentionPct r:
 *   commission    = T * c/100  -> BULK_BUY -> COMMISSION_SINK (once, at the
 *                                 FIRST milestone authorisation)
 *   retention     = T * r/100  -> BULK_BUY -> RETENTION       (once, at the
 *                                 FIRST milestone authorisation — RETENTION
 *                                 is a holding account, not the vendor's)
 *   vendorPayable = T - commission - retention, released across milestones:
 *     milestone i releases vendorPayable * pct_i/100 -> BULK_BUY -> EXTERNAL
 *     (the LAST milestone by sequence instead releases whatever remains of
 *     vendorPayable, so rounding dust never gets stranded — see
 *     authoriseMilestone's doc comment)
 *   retention is released later, once every milestone is PAID and the
 *     defect-liability period has elapsed: RETENTION -> EXTERNAL.
 * At every step the sum of all account balances is conserved (nothing but a
 * transfer between two of this society's own accounts, or a transfer across
 * the EXTERNAL boundary); BULK_BUY's contribution from this booking nets
 * back to zero only once every milestone AND the retention have been
 * released.
 */
@Injectable()
export class BulkBuyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly razorpay: RazorpayService,
  ) {}

  // -------------------------------------------------------------------
  // Offers
  // -------------------------------------------------------------------

  async createOffer(societyId: string, dto: CreateOfferDto): Promise<OfferDetail> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId } });
    if (!vendor || vendor.societyId !== societyId) {
      throw new NotFoundException('Vendor not found');
    }

    const ladderError = validateLadder(dto.discountLadder);
    if (ladderError) {
      throw new BadRequestException(ladderError);
    }
    // Re-shape into plain {minN, pct} objects (not the DiscountLadderRungDto
    // class instances class-validator produced) before writing to the Json
    // column — keeps what's stored a plain, JSON-round-trippable value.
    const ladder: LadderRung[] = dto.discountLadder.map((rung) => ({ minN: rung.minN, pct: rung.pct }));

    const deadline = new Date(dto.deadline);
    if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('deadline must be a valid date in the future');
    }

    const tier = dto.tier ?? JobCardTier.SMALL;
    let milestoneTemplate: MilestoneTemplateRung[] | null = null;
    let retentionPct = 0;
    let retentionDays: number | null = null;

    if (tier === JobCardTier.LARGE) {
      if (dto.milestoneTemplate === undefined) {
        throw new BadRequestException('milestoneTemplate is required for a LARGE offer');
      }
      const templateError = validateMilestoneTemplate(dto.milestoneTemplate);
      if (templateError) {
        throw new BadRequestException(templateError);
      }
      milestoneTemplate = dto.milestoneTemplate.map((rung) => ({ name: rung.name, pct: rung.pct }));
      retentionPct = dto.retentionPct ?? 0;
      retentionDays = dto.retentionDays ?? null;
    } else if (dto.milestoneTemplate !== undefined || dto.retentionPct !== undefined || dto.retentionDays !== undefined) {
      throw new BadRequestException('milestoneTemplate/retentionPct/retentionDays are only valid for a LARGE offer');
    }

    const offer = await this.prisma.offer.create({
      data: {
        societyId,
        vendorId: dto.vendorId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        unitPrice: dto.unitPrice,
        discountLadder: ladder as unknown as Prisma.InputJsonValue,
        minCommitments: minCommitmentsOf(ladder),
        deadline,
        tier,
        retentionPct,
        retentionDays,
        ...(milestoneTemplate ? { milestoneTemplate: milestoneTemplate as unknown as Prisma.InputJsonValue } : {}),
      },
    });

    return this.toOfferDetail(offer, null);
  }

  async listOffers(societyId: string, status?: OfferStatus): Promise<OfferDetail[]> {
    const offers = await this.prisma.offer.findMany({
      where: { societyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(offers.map((offer) => this.toOfferDetail(offer, null)));
  }

  async getOffer(societyId: string, id: string, callerId: string): Promise<OfferDetail> {
    const offer = await this.getOfferInternal(societyId, id);
    return this.toOfferDetail(offer, callerId);
  }

  /**
   * Resident opt-in. Creates a PENDING Commitment for the caller's own flat
   * (never a client-supplied flat), then re-checks the commitment count in
   * the SAME transaction to decide whether to auto-fire — mirrors
   * PollsService.join's synchronous auto-fire pattern exactly, so firing is
   * deterministic and e2e-testable rather than depending on a background
   * job or a second request.
   */
  async commit(societyId: string, offerId: string, residentId: string): Promise<OfferDetail> {
    const offer = await this.getOfferInternal(societyId, offerId);
    if (offer.status !== OfferStatus.OPEN) {
      throw new BadRequestException(`Offer is not open for commitments (status=${offer.status})`);
    }
    if (offer.deadline.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('Offer deadline has passed');
    }

    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId: residentId, tenureEndedAt: null, flat: { societyId } },
      select: { flatId: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.commitment.create({ data: { offerId, residentId, flatId: occupancy.flatId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Already committed to this offer');
        }
        throw error;
      }

      const commitmentCount = await tx.commitment.count({ where: { offerId } });
      if (commitmentCount < offer.minCommitments) {
        return;
      }

      // Re-check status inside the tx: guards against firing twice if two
      // commits somehow both reach this point for the same offer.
      const stillOpen = await tx.offer.findUnique({ where: { id: offerId }, select: { status: true } });
      if (stillOpen?.status !== OfferStatus.OPEN) {
        return;
      }

      await this.fireOffer(tx, offer, commitmentCount);
    });

    return this.getOffer(societyId, offerId, residentId);
  }

  /**
   * Fires the offer: snapshots the ladder tier, creates one Booking and one
   * JobCard per existing Commitment (there may be more than the one that
   * just tipped commitmentCount over minCommitments, if earlier commits
   * came in first), and creates one escrow-in Payment per commitment via
   * PaymentsService.createOrderForLink — all inside the caller's own
   * transaction (`tx`), so a crash partway through leaves nothing
   * half-fired. Razorpay's createOrder is called from inside this tx too;
   * that's safe because in stub mode (the only mode this project ever runs
   * with real money at stake — see RAZORPAY_ENABLED) it's a synchronous,
   * offline, in-memory computation with no network round trip.
   *
   * Phase 4D: when the offer is LARGE, the Booking and every JobCard it
   * creates snapshot tier=LARGE too, one Milestone row per
   * offer.milestoneTemplate entry is created (all PENDING, sequence 1..n),
   * and Booking.retentionReleaseAt is set from offer.retentionDays (null if
   * the offer set no defect-liability period). retentionAmount stays 0 and
   * commissionTaken stays false until the first milestone is authorised —
   * see authoriseMilestone, which mirrors SMALL's "compute commission at
   * payout time" choice rather than snapshotting it here.
   */
  private async fireOffer(tx: Prisma.TransactionClient, offer: OfferModel, commitmentCount: number): Promise<void> {
    const ladder = offer.discountLadder as unknown as LadderRung[];
    const pct = appliedTier(ladder, commitmentCount);
    if (pct === null) {
      // Shouldn't happen: minCommitments is always the ladder's lowest
      // rung's minN, so reaching it always resolves to at least that rung.
      throw new BadRequestException('No discount tier resolves for this commitment count');
    }

    const firedAt = this.clock.now();
    await tx.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.FIRED, firedAt, appliedDiscountPct: pct },
    });

    const isLarge = offer.tier === JobCardTier.LARGE;
    const retentionReleaseAt = isLarge && offer.retentionDays != null ? new Date(firedAt.getTime() + offer.retentionDays * 24 * 60 * 60 * 1000) : null;

    const booking = await tx.booking.create({
      data: {
        societyId: offer.societyId,
        vendorId: offer.vendorId,
        sourceType: 'OFFER',
        sourceId: offer.id,
        status: BookingStatus.ACTIVE,
        tier: offer.tier,
        retentionReleaseAt,
      },
    });

    if (isLarge) {
      const template = offer.milestoneTemplate as unknown as MilestoneTemplateRung[];
      for (let i = 0; i < template.length; i++) {
        await tx.milestone.create({
          data: { bookingId: booking.id, sequence: i + 1, name: template[i].name, pct: template[i].pct, status: PayoutStatus.PENDING },
        });
      }
    }

    const commitments = await tx.commitment.findMany({ where: { offerId: offer.id } });
    const discountedUnitPrice = new Decimal(offer.unitPrice).mul(new Decimal(100).minus(pct)).div(100).toDecimalPlaces(2);

    for (const commitment of commitments) {
      const jobCard = await tx.jobCard.create({
        data: {
          bookingId: booking.id,
          commitmentId: commitment.id,
          residentId: commitment.residentId,
          flatId: commitment.flatId,
          scope: offer.title,
          unitPrice: discountedUnitPrice,
          appliedDiscountPct: pct,
          status: JobCardStatus.PENDING,
          tier: offer.tier,
        },
      });

      const payment = await this.payments.createOrderForLink(
        {
          societyId: offer.societyId,
          residentId: commitment.residentId,
          amount: discountedUnitPrice,
          purpose: `Bulk-buy: ${offer.title}`,
          linkedEntityType: 'Commitment',
          linkedEntityId: commitment.id,
          idempotencyKey: `offer:${offer.id}:commit:${commitment.id}`,
        },
        tx,
      );

      await tx.commitment.update({ where: { id: commitment.id }, data: { paymentId: payment.id } });
      void jobCard; // created for its side effect; not otherwise needed here
    }
  }

  // -------------------------------------------------------------------
  // Job cards
  // -------------------------------------------------------------------

  /**
   * The job card's own resident signs off — 403 for anyone else. Requires
   * the underlying Commitment to be FUNDED first (a resident shouldn't be
   * able to sign off work it hasn't paid escrow for yet); this is a
   * deliberate v1 gating rule, not something the task spec pinned down
   * exactly. When every JobCard in the booking is SIGNED_OFF, the Booking
   * flips to COMPLETED in the same transaction.
   */
  async signOffJobCard(societyId: string, jobCardId: string, residentId: string): Promise<JobCardModel> {
    return this.prisma.$transaction(async (tx) => {
      const jobCard = await tx.jobCard.findUnique({ where: { id: jobCardId }, include: { booking: true, commitment: true } });
      if (!jobCard || jobCard.booking.societyId !== societyId) {
        throw new NotFoundException('Job card not found');
      }
      if (jobCard.residentId !== residentId) {
        throw new ForbiddenException('Only the job card\'s own resident can sign it off');
      }
      if (jobCard.status !== JobCardStatus.PENDING) {
        throw new BadRequestException(`Job card is already ${jobCard.status}`);
      }
      if (jobCard.commitment.status !== CommitmentStatus.FUNDED) {
        throw new BadRequestException('Cannot sign off before the linked payment is captured (commitment is not FUNDED)');
      }

      const updated = await tx.jobCard.update({
        where: { id: jobCardId },
        data: { status: JobCardStatus.SIGNED_OFF, signedOffAt: this.clock.now() },
      });

      const remaining = await tx.jobCard.count({ where: { bookingId: jobCard.bookingId, status: { not: JobCardStatus.SIGNED_OFF } } });
      if (remaining === 0) {
        await tx.booking.update({ where: { id: jobCard.bookingId }, data: { status: BookingStatus.COMPLETED } });
      }

      return updated;
    });
  }

  // -------------------------------------------------------------------
  // Bookings / payout (SMALL)
  // -------------------------------------------------------------------

  async getBooking(societyId: string, bookingId: string): Promise<BookingDetail> {
    return this.loadBookingDetail(this.prisma, societyId, bookingId);
  }

  /**
   * Dual-authorisation payout — SMALL bookings only (see the LARGE-tier
   * guard just below; LARGE bookings use authoriseMilestone instead).
   * Modeling choice (documented, since the task spec left the
   * SYSTEM-vs-TREASURER sequencing to us): the SYSTEM authorisation is NOT a
   * standing background check — it is the automated rule-check ("every job
   * card signed off, every commitment funded, escrow covers the amount")
   * run and recorded the moment a TREASURER calls this endpoint. Since
   * RolesGuard already blocks any non-TREASURER from reaching this method at
   * all, a SYSTEM row is never persisted by itself without a TREASURER also
   * present in the same call — so "only the SYSTEM rule-check, no
   * treasurer" never pays, and a treasurer's very first (successful) call
   * authorises AND executes in one shot. Re-calling this endpoint after PAID
   * is a verified no-op (idempotent via the Payout.status guard below) — no
   * second ledger postings, no second razorpay.payout call.
   */
  async authorisePayout(societyId: string, bookingId: string, treasurerId: string): Promise<BookingDetail> {
    return this.prisma.$transaction(async (tx) => {
      // Serializes concurrent authorise calls for the SAME booking (namespace
      // 52 = "payout", distinct from AuditService.append's 42 and
      // IdempotencyService.runOnce's 51): without this, two racing treasurer
      // requests can both read the same pre-payout snapshot, both pass the
      // authCount>=2 && status!==PAID guard, and both post the payout ledger
      // entries — double-paying the vendor. With the lock, the second call
      // blocks until the first commits, then re-reads and sees PAID, so its
      // own guard below is a true no-op.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYOUT_LOCK_NAMESPACE}, hashtext(${bookingId}))`;

      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true, milestones: true } });
      if (!booking || booking.societyId !== societyId) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.tier === JobCardTier.LARGE) {
        throw new BadRequestException('Use milestone authorisation for LARGE bookings');
      }

      let payout = booking.payout;
      if (payout?.status === PayoutStatus.PAID) {
        return this.toBookingDetail(booking, payout, booking.milestones);
      }

      if (booking.status !== BookingStatus.COMPLETED) {
        throw new BadRequestException('Booking is not COMPLETED — not every job card has been signed off yet');
      }
      if (booking.jobCards.length === 0) {
        throw new BadRequestException('Booking has no job cards');
      }

      const commitmentIds = booking.jobCards.map((jc) => jc.commitmentId);
      const commitments = await tx.commitment.findMany({ where: { id: { in: commitmentIds } } });
      const allFunded = commitments.length === booking.jobCards.length && commitments.every((c) => c.status === CommitmentStatus.FUNDED);
      if (!allFunded) {
        throw new BadRequestException('Not every commitment on this booking is FUNDED yet');
      }

      const amount = booking.jobCards.reduce((sum, jc) => sum.plus(new Decimal(jc.unitPrice)), new Decimal(0));

      const bulkBuyAccount = await this.ledger.getOrCreateAccount(societyId, AccountKind.BULK_BUY, tx);
      if (new Decimal(bulkBuyAccount.balance).lessThan(amount)) {
        throw new BadRequestException('Escrow (BULK_BUY) balance is insufficient for this payout');
      }

      const commissionPct = await this.getCommissionPct(tx, societyId);
      const commission = amount.mul(commissionPct).div(100).toDecimalPlaces(2);
      const vendorNet = amount.minus(commission);

      if (!payout) {
        payout = await tx.payout.create({
          data: { bookingId, amount, commission, vendorNet, status: PayoutStatus.PENDING },
        });
      }

      // Both authorisation rows are upserts: replaying this call (before
      // PAID) is a safe no-op for whichever row(s) already exist.
      await tx.payoutAuthorisation.upsert({
        where: { payoutId_kind: { payoutId: payout.id, kind: PayoutAuthKind.SYSTEM } },
        update: {},
        create: { payoutId: payout.id, kind: PayoutAuthKind.SYSTEM, authoriserId: null },
      });
      await tx.payoutAuthorisation.upsert({
        where: { payoutId_kind: { payoutId: payout.id, kind: PayoutAuthKind.TREASURER } },
        update: {},
        create: { payoutId: payout.id, kind: PayoutAuthKind.TREASURER, authoriserId: treasurerId },
      });

      const authCount = await tx.payoutAuthorisation.count({ where: { payoutId: payout.id } });
      if (authCount >= 2 && payout.status !== PayoutStatus.PAID) {
        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.BULK_BUY,
            creditKind: AccountKind.COMMISSION_SINK,
            amount: commission,
            reasonCode: 'BULK_BUY_PAYOUT_COMMISSION',
            linkedEntityType: 'Payout',
            linkedEntityId: payout.id,
          },
          tx,
        );
        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.BULK_BUY,
            creditKind: AccountKind.EXTERNAL,
            amount: vendorNet,
            reasonCode: 'BULK_BUY_PAYOUT_VENDOR',
            linkedEntityType: 'Payout',
            linkedEntityId: payout.id,
          },
          tx,
        );

        // STUBBED — no real RazorpayX transfer, ever (hard project
        // constraint). See RazorpayService.payout's doc comment.
        const payoutRef = await this.razorpay.payout({ vendorId: booking.vendorId, amount: Math.round(Number(vendorNet) * 100) });

        payout = await tx.payout.update({
          where: { id: payout.id },
          data: { status: PayoutStatus.PAID, paidAt: this.clock.now(), razorpayPayoutRef: payoutRef.id },
        });
      }

      return this.toBookingDetail(booking, payout, booking.milestones);
    });
  }

  // -------------------------------------------------------------------
  // Milestones / retention (LARGE) — Phase 4D
  // -------------------------------------------------------------------

  /**
   * Dual-authorisation milestone release — LARGE bookings only (the
   * SMALL-tier guard below; SMALL bookings use authorisePayout instead).
   * Mirrors authorisePayout's SYSTEM+TREASURER shape and its per-booking
   * advisory lock (same namespace — see PAYOUT_LOCK_NAMESPACE's doc
   * comment), one level down: SYSTEM+TREASURER authorisation rows and the
   * PAID idempotency guard are per-Milestone here instead of per-Payout.
   *
   * Rule-check (400 otherwise, exactly like authorisePayout's): booking is
   * LARGE; booking is COMPLETED (every job card signed off); every
   * commitment on the booking is FUNDED; escrow (BULK_BUY) covers what's
   * about to move; and — the one LARGE-specific rule — every
   * lower-sequence milestone on this booking is already PAID (milestones
   * release strictly in order).
   *
   * On the FIRST milestone ever authorised on this booking (Booking.
   * commissionTaken === false), this also performs the once-only
   * commission + retention set-aside: T = sum of the booking's job-card
   * unitPrices, commission = T * commissionPct/100, retention = T *
   * offer.retentionPct/100 (the offer is looked up via booking.sourceId,
   * the same loose OFFER pointer fireOffer used — read at authorise time
   * rather than snapshotted at fire time, mirroring authorisePayout's own
   * "read commissionPct at payout time" choice). commission is posted
   * BULK_BUY -> COMMISSION_SINK and retention BULK_BUY -> RETENTION;
   * Booking.retentionAmount and commissionTaken are updated so every later
   * milestone call on this booking skips this step. On every later call,
   * `commission` is instead read back off the LedgerEntry this step wrote
   * (rather than recomputed) and `retention` off the persisted
   * Booking.retentionAmount — both exact, so vendorPayable
   * (= T - commission - retention) is bit-for-bit identical on every call
   * regardless of whether commissionPct's config value changes in between.
   *
   * Releases this milestone: amount = vendorPayable * milestone.pct/100,
   * rounded to 2dp — EXCEPT the last milestone by sequence, which instead
   * releases whatever remains of vendorPayable (vendorPayable minus the sum
   * of every already-PAID milestone's snapshotted amount), so the
   * milestones sum to vendorPayable exactly with no rounding dust left
   * stranded in BULK_BUY. Posts BULK_BUY -> EXTERNAL (reasonCode
   * 'BULK_BUY_MILESTONE_PAYOUT', linked to this Milestone), records the
   * SYSTEM + TREASURER MilestoneAuthorisation rows, and marks the milestone
   * PAID with its snapshotted amount and a STUBBED razorpay.payout ref
   * (same hard constraint as authorisePayout — never a real RazorpayX
   * call).
   */
  async authoriseMilestone(societyId: string, bookingId: string, milestoneId: string, treasurerId: string): Promise<BookingDetail> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYOUT_LOCK_NAMESPACE}, hashtext(${bookingId}))`;

      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true, milestones: { orderBy: { sequence: 'asc' } } } });
      if (!booking || booking.societyId !== societyId) {
        throw new NotFoundException('Booking not found');
      }
      if (booking.tier !== JobCardTier.LARGE) {
        throw new BadRequestException('This booking is SMALL — use POST /bookings/:id/payout/authorise instead');
      }

      const milestone = booking.milestones.find((m) => m.id === milestoneId);
      if (!milestone) {
        throw new NotFoundException('Milestone not found on this booking');
      }

      // Idempotent: exactly like authorisePayout's Payout.status===PAID
      // guard, replaying this call after PAID is a verified no-op.
      if (milestone.status === PayoutStatus.PAID) {
        return this.toBookingDetail(booking, booking.payout, booking.milestones);
      }

      if (booking.status !== BookingStatus.COMPLETED) {
        throw new BadRequestException('Booking is not COMPLETED — not every job card has been signed off yet');
      }
      if (booking.jobCards.length === 0) {
        throw new BadRequestException('Booking has no job cards');
      }

      const commitmentIds = booking.jobCards.map((jc) => jc.commitmentId);
      const commitments = await tx.commitment.findMany({ where: { id: { in: commitmentIds } } });
      const allFunded = commitments.length === booking.jobCards.length && commitments.every((c) => c.status === CommitmentStatus.FUNDED);
      if (!allFunded) {
        throw new BadRequestException('Not every commitment on this booking is FUNDED yet');
      }

      const lowerUnpaid = booking.milestones.filter((m) => m.sequence < milestone.sequence && m.status !== PayoutStatus.PAID);
      if (lowerUnpaid.length > 0) {
        throw new BadRequestException('Milestones must be authorised in order — an earlier milestone is not yet PAID');
      }

      const total = booking.jobCards.reduce((sum, jc) => sum.plus(new Decimal(jc.unitPrice)), new Decimal(0));

      let commission: Decimal;
      let retention: Decimal;
      const isFirstMilestone = !booking.commissionTaken;

      if (isFirstMilestone) {
        const commissionPct = await this.getCommissionPct(tx, societyId);
        commission = total.mul(commissionPct).div(100).toDecimalPlaces(2);

        const offer = await tx.offer.findUniqueOrThrow({ where: { id: booking.sourceId } });
        retention = total.mul(new Decimal(offer.retentionPct)).div(100).toDecimalPlaces(2);
      } else {
        const commissionEntry = await tx.ledgerEntry.findFirst({
          where: { societyId, linkedEntityType: 'Booking', linkedEntityId: booking.id, reasonCode: 'BULK_BUY_MILESTONE_COMMISSION' },
        });
        commission = commissionEntry ? new Decimal(commissionEntry.amount) : new Decimal(0);
        retention = new Decimal(booking.retentionAmount);
      }

      const vendorPayable = total.minus(commission).minus(retention);
      const maxSequence = Math.max(...booking.milestones.map((m) => m.sequence));
      const isLastMilestone = milestone.sequence === maxSequence;

      let amount: Decimal;
      if (isLastMilestone) {
        const alreadyPaid = booking.milestones
          .filter((m) => m.status === PayoutStatus.PAID)
          .reduce((sum, m) => sum.plus(new Decimal(m.amount ?? 0)), new Decimal(0));
        amount = vendorPayable.minus(alreadyPaid).toDecimalPlaces(2);
      } else {
        amount = vendorPayable.mul(milestone.pct).div(100).toDecimalPlaces(2);
      }

      const bulkBuyAccount = await this.ledger.getOrCreateAccount(societyId, AccountKind.BULK_BUY, tx);
      const totalMovingOut = isFirstMilestone ? amount.plus(commission).plus(retention) : amount;
      if (new Decimal(bulkBuyAccount.balance).lessThan(totalMovingOut)) {
        throw new BadRequestException('Escrow (BULK_BUY) balance is insufficient for this milestone release');
      }

      if (isFirstMilestone) {
        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.BULK_BUY,
            creditKind: AccountKind.COMMISSION_SINK,
            amount: commission,
            reasonCode: 'BULK_BUY_MILESTONE_COMMISSION',
            linkedEntityType: 'Booking',
            linkedEntityId: booking.id,
          },
          tx,
        );
        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.BULK_BUY,
            creditKind: AccountKind.RETENTION,
            amount: retention,
            reasonCode: 'BULK_BUY_MILESTONE_RETENTION_HOLD',
            linkedEntityType: 'Booking',
            linkedEntityId: booking.id,
          },
          tx,
        );
        await tx.booking.update({ where: { id: booking.id }, data: { retentionAmount: retention, commissionTaken: true } });
        booking.retentionAmount = retention;
        booking.commissionTaken = true;
      }

      // Both authorisation rows are upserts: replaying this call (before
      // PAID) is a safe no-op for whichever row(s) already exist — same
      // pattern as authorisePayout's PayoutAuthorisation upserts.
      await tx.milestoneAuthorisation.upsert({
        where: { milestoneId_kind: { milestoneId: milestone.id, kind: PayoutAuthKind.SYSTEM } },
        update: {},
        create: { milestoneId: milestone.id, kind: PayoutAuthKind.SYSTEM, authoriserId: null },
      });
      await tx.milestoneAuthorisation.upsert({
        where: { milestoneId_kind: { milestoneId: milestone.id, kind: PayoutAuthKind.TREASURER } },
        update: {},
        create: { milestoneId: milestone.id, kind: PayoutAuthKind.TREASURER, authoriserId: treasurerId },
      });

      await this.ledger.post(
        {
          societyId,
          debitKind: AccountKind.BULK_BUY,
          creditKind: AccountKind.EXTERNAL,
          amount,
          reasonCode: 'BULK_BUY_MILESTONE_PAYOUT',
          linkedEntityType: 'Milestone',
          linkedEntityId: milestone.id,
        },
        tx,
      );

      // STUBBED — no real RazorpayX transfer, ever (hard project
      // constraint). See RazorpayService.payout's doc comment.
      const payoutRef = await this.razorpay.payout({ vendorId: booking.vendorId, amount: Math.round(Number(amount) * 100) });

      const updatedMilestone = await tx.milestone.update({
        where: { id: milestone.id },
        data: { status: PayoutStatus.PAID, amount, paidAt: this.clock.now(), razorpayPayoutRef: payoutRef.id },
      });

      const milestones = booking.milestones.map((m) => (m.id === updatedMilestone.id ? updatedMilestone : m));
      return this.toBookingDetail(booking, booking.payout, milestones);
    });
  }

  /**
   * Releases a LARGE booking's defect-liability retention share
   * (RETENTION -> EXTERNAL) — the money BULK_BUY -> RETENTION moved aside
   * at the first milestone authorisation (see authoriseMilestone). Same
   * per-booking advisory lock as authorisePayout/authoriseMilestone
   * (mutually exclusive with both on this booking) and the same idempotency
   * shape: Booking.retentionReleasedAt is this route's PAID-equivalent
   * guard, so replaying this call after release is a verified no-op.
   *
   * Rule-check (400 otherwise): booking is LARGE; every milestone on the
   * booking is PAID; Clock.now() has reached Booking.retentionReleaseAt
   * (the defect-liability period has elapsed — a null retentionReleaseAt,
   * meaning the offer set no such period, is treated as "never releasable"
   * rather than "always releasable"); and retentionAmount > 0 (nothing to
   * release otherwise, e.g. a LARGE offer created with retentionPct 0).
   */
  async releaseRetention(societyId: string, bookingId: string, _treasurerId: string): Promise<BookingDetail> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYOUT_LOCK_NAMESPACE}, hashtext(${bookingId}))`;

      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true, milestones: { orderBy: { sequence: 'asc' } } } });
      if (!booking || booking.societyId !== societyId) {
        throw new NotFoundException('Booking not found');
      }

      if (booking.retentionReleasedAt) {
        return this.toBookingDetail(booking, booking.payout, booking.milestones);
      }

      if (booking.tier !== JobCardTier.LARGE) {
        throw new BadRequestException('Retention release is only applicable to LARGE bookings');
      }
      if (booking.milestones.length === 0 || !booking.milestones.every((m) => m.status === PayoutStatus.PAID)) {
        throw new BadRequestException('Every milestone must be PAID before the retention can be released');
      }
      if (!booking.retentionReleaseAt || this.clock.now().getTime() < booking.retentionReleaseAt.getTime()) {
        throw new BadRequestException('The defect-liability retention period has not elapsed yet');
      }
      const retentionAmount = new Decimal(booking.retentionAmount);
      if (retentionAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('This booking has no retention to release');
      }

      await this.ledger.post(
        {
          societyId,
          debitKind: AccountKind.RETENTION,
          creditKind: AccountKind.EXTERNAL,
          amount: retentionAmount,
          reasonCode: 'RETENTION_RELEASE',
          linkedEntityType: 'Booking',
          linkedEntityId: booking.id,
        },
        tx,
      );

      // STUBBED — no real RazorpayX transfer, ever (hard project
      // constraint). See RazorpayService.payout's doc comment. There is no
      // dedicated column to stamp this ref onto (releaseRetention is a
      // one-shot event on Booking, not a repeatable per-row entity like
      // Payout/Milestone) — the ledger entry above and retentionReleasedAt
      // below are this event's durable record.
      await this.razorpay.payout({ vendorId: booking.vendorId, amount: Math.round(Number(retentionAmount) * 100) });

      const updatedBooking = await tx.booking.update({ where: { id: booking.id }, data: { retentionReleasedAt: this.clock.now() } });

      return this.toBookingDetail({ ...booking, ...updatedBooking }, booking.payout, booking.milestones);
    });
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async getCommissionPct(tx: Prisma.TransactionClient, societyId: string): Promise<number> {
    const society = await tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    const config = society.config as Record<string, unknown>;
    return typeof config.commissionPct === 'number' ? config.commissionPct : DEFAULT_COMMISSION_PCT;
  }

  private async getOfferInternal(societyId: string, id: string): Promise<OfferModel> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || offer.societyId !== societyId) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }

  private async toOfferDetail(offer: OfferModel, callerId: string | null): Promise<OfferDetail> {
    const ladder = offer.discountLadder as unknown as LadderRung[];
    const [commitmentCount, hasCommitted] = await Promise.all([
      this.prisma.commitment.count({ where: { offerId: offer.id } }),
      callerId ? this.prisma.commitment.findUnique({ where: { offerId_residentId: { offerId: offer.id, residentId: callerId } } }).then(Boolean) : Promise.resolve(undefined),
    ]);

    return {
      ...offer,
      commitmentCount,
      currentTierPct: appliedTier(ladder, commitmentCount),
      nextTierAt: nextTierThreshold(ladder, commitmentCount),
      ...(callerId ? { hasCommitted } : {}),
    };
  }

  private async loadBookingDetail(client: PrismaService | Prisma.TransactionClient, societyId: string, bookingId: string): Promise<BookingDetail> {
    const booking = await client.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true, milestones: { orderBy: { sequence: 'asc' } } } });
    if (!booking || booking.societyId !== societyId) {
      throw new NotFoundException('Booking not found');
    }
    return this.toBookingDetail(booking, booking.payout, booking.milestones);
  }

  private toBookingDetail(booking: BookingModel & { jobCards: JobCardModel[] }, payout: PayoutModel | null, milestones: MilestoneModel[]): BookingDetail {
    const { jobCards, ...rest } = booking as BookingModel & { jobCards: JobCardModel[] };
    return { ...rest, jobCards, payout, milestones: [...milestones].sort((a, b) => a.sequence - b.sequence) };
  }
}
