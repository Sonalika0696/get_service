import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AuditService, type AppendAuditLogInput } from '../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, BookingStatus, CommitmentStatus, JobCardStatus, JobCardTier, OfferRecurrence, OfferStatus, PayoutStatus, PollStatus, PollType, RoleKind } from '../../generated/prisma/enums.js';
import type { BookingModel, JobCardModel, MilestoneModel, OfferModel, PayoutModel, PollModel } from '../../generated/prisma/models.js';
import { appliedTier, minCommitmentsOf, nextTierThreshold, validateLadder, type LadderRung } from './discount-ladder.util.js';
import { validateMilestoneTemplate, type MilestoneTemplateRung } from './milestone-template.util.js';
import { parseApprovalConfig, requiredApprovers, validateApprovalConfig, type ApprovalConfig } from './approval-ladder.util.js';
import type { CreateOfferDto } from './dto/create-offer.dto.js';
import type { CreateResidentPollDto } from './dto/create-resident-poll.dto.js';
import type { VendorConfirmDto } from './dto/vendor-confirm.dto.js';
import type { SetApprovalConfigDto } from './dto/set-approval-config.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Same namespace BulkBuyService.authorisePayout has always used — see its
 * doc comment. Milestones (4D) and the SMALL single-shot payout (4C) are
 * mutually exclusive per booking (a booking is either SMALL or LARGE, never
 * both), so sharing the namespace is safe and keeps every money-moving call
 * on a given booking serialized against every other one. */
const PAYOUT_LOCK_NAMESPACE = 52;
/** Phase 5 Flow B: serializes vendorConfirm and joinResidentPoll on the SAME
 * poll against each other (both take this lock, keyed on pollId, as the
 * FIRST statement in their transaction), so two concurrent callers racing
 * across the fire threshold can't both observe status=OPEN and both fire —
 * exactly the double-fire hazard authorisePayout's PAYOUT_LOCK_NAMESPACE
 * already guards against for payouts. Distinct namespace from 52 since
 * these lock different entities (a Poll, not a Booking). */
const RESIDENT_POLL_FIRE_LOCK_NAMESPACE = 53;

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

/** API-facing shape: a Flow B (BULK_BUY_RESIDENT) poll plus a live commitment count, the caller's own join state, and (once fired) the Booking it fired into. */
export type ResidentPollDetail = PollModel & {
  commitmentCount: number;
  hasJoined?: boolean;
  bookingId: string | null;
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
 *   payout (escrow-out) posts BULK_BUY -> EXTERNAL for the full escrowed
 *     amount (the vendor's payment leaving the closed ledger set — see
 *     schema.prisma's Ledger section doc comment for why crediting EXTERNAL
 *     means money leaving). No commission is split out: the platform holds
 *     no account in the society's chart of accounts (V2.0, invariant I2),
 *     so BULK_BUY nets back to zero for this booking's contribution once paid.
 *
 * Money flow summary, LARGE (see authoriseMilestone / releaseRetention for
 * the code). For an escrowed total T (sum of the booking's discounted
 * job-card prices) and retentionPct r:
 *   retention     = T * r/100  -> BULK_BUY -> RETENTION (once, at the
 *                                 FIRST milestone authorisation — RETENTION
 *                                 is a holding account, not the vendor's)
 *   vendorPayable = T - retention, released across milestones:
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
 *
 * Phase 5 adds Flow B (resident-initiated, tagged-vendor bulk-buy) in the
 * "Resident polls (Flow B)" section below: a resident opens a
 * PollType.BULK_BUY_RESIDENT poll (reusing the Phase 3 Poll/PollCommitment
 * tables, but owned end-to-end by this module — see PollsService's own doc
 * comment for the ownership split), a COMMITTEE member confirms terms on the
 * vendor's behalf, and once enough residents join, Flow B fires down the
 * EXACT SAME booking/escrow path as Flow A: fireOffer and Flow B's
 * fireResidentPoll both delegate to createBookingWithEscrow, a private
 * helper extracted from what used to be fireOffer's own inline booking/
 * job-card/escrow-creation logic. Everything downstream of firing (pay via
 * webhook, sign off, authorisePayout) is untouched Flow A code — Flow B
 * booking rows are indistinguishable from Flow A ones except for
 * sourceType='POLL' instead of 'OFFER'. Flow B is SMALL-tier only in v1
 * (documented at fireResidentPoll — no LARGE-via-poll milestone/retention
 * support yet). Phase 5 also adds weekly-recurring Offers (rollOffer).
 */
@Injectable()
export class BulkBuyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly razorpay: RazorpayService,
    private readonly auditService: AuditService,
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
        recurring: dto.recurring ?? OfferRecurrence.NONE,
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
   * Fires the offer: snapshots the ladder tier, then delegates the actual
   * Booking/JobCard/escrow creation to createBookingWithEscrow (shared with
   * Flow B's fireResidentPoll — see that method and this class's doc
   * comment). All inside the caller's own transaction (`tx`), so a crash
   * partway through leaves nothing half-fired.
   */
  private async fireOffer(tx: Prisma.TransactionClient, offer: OfferModel, commitmentCount: number): Promise<void> {
    const ladder = offer.discountLadder as unknown as LadderRung[];
    const pct = appliedTier(ladder, commitmentCount);
    if (pct === null) {
      // Shouldn't happen: minCommitments is always the ladder's lowest
      // rung's minN, so reaching it always resolves to at least that rung.
      throw new BadRequestException('No discount tier resolves for this commitment count');
    }

    await tx.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.FIRED, firedAt: this.clock.now(), appliedDiscountPct: pct },
    });

    const commitments = await tx.commitment.findMany({ where: { offerId: offer.id } });
    const discountedUnitPrice = new Decimal(offer.unitPrice).mul(new Decimal(100).minus(pct)).div(100).toDecimalPlaces(2);
    const milestoneTemplate = offer.tier === JobCardTier.LARGE ? (offer.milestoneTemplate as unknown as MilestoneTemplateRung[]) : null;

    await this.createBookingWithEscrow(tx, {
      societyId: offer.societyId,
      vendorId: offer.vendorId,
      sourceType: 'OFFER',
      sourceId: offer.id,
      tier: offer.tier,
      milestoneTemplate,
      retentionDays: offer.retentionDays,
      discountedUnitPrice,
      appliedDiscountPct: pct,
      scope: offer.title,
      idempotencyPrefix: `offer:${offer.id}`,
      participants: commitments.map((c) => ({ commitmentId: c.id, residentId: c.residentId, flatId: c.flatId })),
    });
  }

  /**
   * Shared by fireOffer (Flow A) and fireResidentPoll (Flow B, Phase 5) —
   * extracted from what used to be fireOffer's own inline logic so both
   * flows fire down the exact same path. Creates one Booking (sourceType/
   * sourceId identify which flow/entity fired it — a loose pointer, same
   * pattern as LedgerEntry.linkedEntityType, so this stays flow-agnostic),
   * one JobCard per participant (unitPrice=discountedUnitPrice,
   * appliedDiscountPct snapshotted, tier), and one escrow-in Payment per
   * participant via PaymentsService.createOrderForLink, linked to that
   * participant's Commitment (Commitment.paymentId is set here). For LARGE
   * (Flow A only — Flow B is SMALL-only, see fireResidentPoll) this also
   * creates one Milestone row per milestoneTemplate entry (all PENDING,
   * sequence 1..n) and sets Booking.retentionReleaseAt from retentionDays
   * (null if none). Razorpay's createOrder is called from inside this tx
   * too; that's safe because in stub mode (the only mode this project ever
   * runs with real money at stake — see RAZORPAY_ENABLED) it's a
   * synchronous, offline, in-memory computation with no network round trip.
   * Returns the created Booking.
   */
  private async createBookingWithEscrow(
    tx: Prisma.TransactionClient,
    input: {
      societyId: string;
      vendorId: string;
      sourceType: string;
      sourceId: string;
      tier: JobCardTier;
      milestoneTemplate: MilestoneTemplateRung[] | null;
      retentionDays: number | null;
      discountedUnitPrice: Decimal;
      appliedDiscountPct: number;
      /** Booking-level label used as every JobCard's `scope` and the escrow Payment's `purpose` (an Offer's title, or a Poll's title). */
      scope: string;
      /** Prefix for each participant's PaymentsService idempotency key — `${prefix}:commit:${commitmentId}`. */
      idempotencyPrefix: string;
      participants: { commitmentId: string; residentId: string; flatId: string }[];
    },
  ): Promise<BookingModel> {
    const firedAt = this.clock.now();
    const isLarge = input.tier === JobCardTier.LARGE;
    const retentionReleaseAt = isLarge && input.retentionDays != null ? new Date(firedAt.getTime() + input.retentionDays * 24 * 60 * 60 * 1000) : null;

    const booking = await tx.booking.create({
      data: {
        societyId: input.societyId,
        vendorId: input.vendorId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: BookingStatus.ACTIVE,
        tier: input.tier,
        retentionReleaseAt,
      },
    });

    if (isLarge) {
      const template = input.milestoneTemplate ?? [];
      for (let i = 0; i < template.length; i++) {
        await tx.milestone.create({
          data: { bookingId: booking.id, sequence: i + 1, name: template[i].name, pct: template[i].pct, status: PayoutStatus.PENDING },
        });
      }
    }

    for (const participant of input.participants) {
      const jobCard = await tx.jobCard.create({
        data: {
          bookingId: booking.id,
          commitmentId: participant.commitmentId,
          residentId: participant.residentId,
          flatId: participant.flatId,
          scope: input.scope,
          unitPrice: input.discountedUnitPrice,
          appliedDiscountPct: input.appliedDiscountPct,
          status: JobCardStatus.PENDING,
          tier: input.tier,
        },
      });

      const payment = await this.payments.createOrderForLink(
        {
          societyId: input.societyId,
          residentId: participant.residentId,
          amount: input.discountedUnitPrice,
          purpose: `Bulk-buy: ${input.scope}`,
          linkedEntityType: 'Commitment',
          linkedEntityId: participant.commitmentId,
          idempotencyKey: `${input.idempotencyPrefix}:commit:${participant.commitmentId}`,
        },
        tx,
      );

      await tx.commitment.update({ where: { id: participant.commitmentId }, data: { paymentId: payment.id } });
      void jobCard; // created for its side effect; not otherwise needed here
    }

    return booking;
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
   * N-officer approval-ladder payout (Phase 6.4, M14) — SMALL bookings only
   * (see the LARGE-tier guard just below; LARGE bookings use
   * authoriseMilestone instead).
   *
   * Replaces the old implied "2 approvers" (an auto SYSTEM row + 1
   * TREASURER) with a per-society ladder driven by Society.config.approval
   * (see approval-ladder.util.ts's doc comment for the full rung table and
   * the "amount basis" design choice — here, the Payout's full amount).
   * `authoriserId` is any of TREASURER/DEPUTY_TREASURER/COMMITTEE (enforced
   * by BookingsController's `@Roles(...)`) — each DISTINCT such officer who
   * calls this endpoint gets exactly one PayoutAuthorisation row
   * (`@@unique([payoutId, authoriserId])`, plus the upsert below being a
   * no-op on repeat): the SAME officer calling twice never increments the
   * distinct count, so it alone can never cross a >1 rung. The old
   * automated "every job card signed off, every commitment funded, escrow
   * covers the amount" rule-check still runs on every call (the guards
   * below) — it's just no longer persisted as a countable authorisation,
   * because a rung is about distinct HUMAN officers only.
   *
   * Execution (the ledger post + stubbed razorpay payout + Payout ->PAID)
   * happens the moment the distinct officer count reaches the required
   * rung, INSIDE the same per-booking advisory lock (namespace 52) as
   * every call — so two officers racing the threshold-crossing call still
   * pay exactly once (see this method's own concurrency test). Re-calling
   * after PAID is a verified no-op (idempotent via the Payout.status guard
   * below) — no second ledger postings, no second razorpay.payout call.
   */
  async authorisePayout(societyId: string, bookingId: string, authoriserId: string): Promise<BookingDetail> {
    let executedAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent authorise calls for the SAME booking (namespace
      // 52 = "payout", distinct from AuditService.append's 42 and
      // IdempotencyService.runOnce's 51): without this, two racing officer
      // requests can both read the same pre-payout snapshot, both pass the
      // requiredApprovers-crossing && status!==PAID guard, and both post the
      // payout ledger entries — double-paying the vendor. With the lock, the
      // second call blocks until the first commits, then re-reads and sees
      // PAID, so its own guard below is a true no-op.
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

      if (!payout) {
        payout = await tx.payout.create({
          data: { bookingId, amount, status: PayoutStatus.PENDING },
        });
      }

      // Upsert: replaying this call (before PAID), whether by the same
      // officer or a genuinely new one, is a safe no-op / single-insert —
      // the @@unique([payoutId, authoriserId]) constraint is the
      // belt-and-suspenders backstop against the same identity ever being
      // counted twice.
      await tx.payoutAuthorisation.upsert({
        where: { payoutId_authoriserId: { payoutId: payout.id, authoriserId } },
        update: {},
        create: { payoutId: payout.id, authoriserId },
      });

      const distinctApprovers = await tx.payoutAuthorisation.count({ where: { payoutId: payout.id } });
      const [society, committeeRosterSize] = await Promise.all([tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } }), this.committeeRosterSize(tx, societyId)]);
      const approvalConfig = parseApprovalConfig(society.config);
      const required = requiredApprovers(Number(amount), approvalConfig, committeeRosterSize);

      if (distinctApprovers >= required && payout.status !== PayoutStatus.PAID) {
        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.BULK_BUY,
            creditKind: AccountKind.EXTERNAL,
            amount,
            reasonCode: 'BULK_BUY_PAYOUT_VENDOR',
            linkedEntityType: 'Payout',
            linkedEntityId: payout.id,
          },
          tx,
        );

        // STUBBED — no real RazorpayX transfer, ever (hard project
        // constraint). See RazorpayService.payout's doc comment.
        const payoutRef = await this.razorpay.payout({ vendorId: booking.vendorId, amount: Math.round(Number(amount) * 100) });

        payout = await tx.payout.update({
          where: { id: payout.id },
          data: { status: PayoutStatus.PAID, paidAt: this.clock.now(), razorpayPayoutRef: payoutRef.id },
        });

        // Stashed, not written yet — see below the transaction for why.
        executedAudit = {
          societyId,
          actorId: authoriserId,
          action: 'BULK_BUY_PAYOUT_EXECUTED',
          subjectType: 'Payout',
          subjectId: payout.id,
          payload: { bookingId, amount: amount.toString(), distinctApprovers, required },
        };
      }

      return this.toBookingDetail(booking, payout, booking.milestones);
    });

    // Explicit execution audit entry — stronger than the generic
    // @AuditLog('PAYOUT_AUTHORISE', ...) on the controller route (which
    // fires post-response on EVERY call, executed or not): this one marks
    // the exact moment money actually moved, with the ladder context that
    // decided it. Written AFTER the transaction above has committed (never
    // from inside it) so this can never claim an execution that the
    // transaction itself then rolled back — still awaited before returning
    // to the caller, the same "stronger than fire-and-forget" stance
    // SocietyRolesService's own doc comment documents for its own writes.
    if (executedAudit) {
      await this.auditService.appendBestEffort(executedAudit);
    }

    return detail;
  }

  // -------------------------------------------------------------------
  // Milestones / retention (LARGE) — Phase 4D
  // -------------------------------------------------------------------

  /**
   * N-officer approval-ladder milestone release (Phase 6.4, M14) — LARGE
   * bookings only (the SMALL-tier guard below; SMALL bookings use
   * authorisePayout instead). Mirrors authorisePayout's distinct-officer
   * ladder and its per-booking advisory lock (same namespace — see
   * PAYOUT_LOCK_NAMESPACE's doc comment and authorisePayout's own doc
   * comment for the full rung table), one level down: MilestoneAuthorisation
   * rows (one per distinct officer, `@@unique([milestoneId, authoriserId])`)
   * and the PAID idempotency guard are per-Milestone here instead of
   * per-Payout. Amount basis (see approval-ladder.util.ts): THIS
   * milestone's own release amount, computed below — never the booking's
   * overall escrowed total, and never including the retention share.
   *
   * Rule-check (400 otherwise, exactly like authorisePayout's): booking is
   * LARGE; booking is COMPLETED (every job card signed off); every
   * commitment on the booking is FUNDED; escrow (BULK_BUY) covers what's
   * about to move; and — the one LARGE-specific rule — every
   * lower-sequence milestone on this booking is already PAID (milestones
   * release strictly in order).
   *
   * Every call (including one that doesn't yet cross the required rung)
   * records this officer's distinct MilestoneAuthorisation row. EXECUTION —
   * the once-only retention set-aside on the first milestone (BULK_BUY ->
   * RETENTION, Booking.retentionAmount/retentionSetAside), the milestone's
   * own BULK_BUY -> EXTERNAL release, the stubbed razorpay call, and
   * Milestone -> PAID — only happens the moment the distinct officer count
   * reaches the amount-derived requirement, inside the same per-booking
   * advisory lock as every call (see this method's own concurrency test:
   * two officers racing the threshold-crossing call still release exactly
   * once). Until then the milestone stays PENDING and nothing moves,
   * INCLUDING retention — so a rung-2/3 milestone's retention set-aside
   * waits for the same threshold as its own release, not the first
   * (possibly insufficient) approval call.
   *
   * T = sum of the booking's job-card unitPrices. On the first EXECUTED
   * milestone, retention = T * offer.retentionPct/100 (the offer is looked
   * up via booking.sourceId, the same loose OFFER pointer fireOffer used);
   * on every later call `retention` is read back off the persisted
   * Booking.retentionAmount rather than recomputed, so vendorPayable
   * (= T - retention) is bit-for-bit identical on every call. This
   * milestone's amount = vendorPayable * milestone.pct/100, rounded to 2dp
   * — EXCEPT the last milestone by sequence, which instead releases
   * whatever remains of vendorPayable (vendorPayable minus the sum of every
   * already-PAID milestone's snapshotted amount), so the milestones sum to
   * vendorPayable exactly with no rounding dust left stranded in BULK_BUY.
   * Re-calling after PAID is a verified no-op (same as authorisePayout).
   */
  async authoriseMilestone(societyId: string, bookingId: string, milestoneId: string, authoriserId: string): Promise<BookingDetail> {
    let executedAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
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

      // Pure computation only below — isFirstMilestone here means "no
      // execution has set retention aside yet", not "this call will
      // execute". Nothing is written until the distinct-approver threshold
      // is actually reached, further down.
      let retention: Decimal;
      const isFirstMilestone = !booking.retentionSetAside;

      if (isFirstMilestone) {
        const offer = await tx.offer.findUniqueOrThrow({ where: { id: booking.sourceId } });
        retention = total.mul(new Decimal(offer.retentionPct)).div(100).toDecimalPlaces(2);
      } else {
        retention = new Decimal(booking.retentionAmount);
      }

      const vendorPayable = total.minus(retention);
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
      const totalMovingOut = isFirstMilestone ? amount.plus(retention) : amount;
      if (new Decimal(bulkBuyAccount.balance).lessThan(totalMovingOut)) {
        throw new BadRequestException('Escrow (BULK_BUY) balance is insufficient for this milestone release');
      }

      // Upsert: replaying this call (before PAID), whether by the same
      // officer or a genuinely new one, is a safe no-op / single-insert —
      // @@unique([milestoneId, authoriserId]) is the belt-and-suspenders
      // backstop against the same identity ever being counted twice.
      await tx.milestoneAuthorisation.upsert({
        where: { milestoneId_authoriserId: { milestoneId: milestone.id, authoriserId } },
        update: {},
        create: { milestoneId: milestone.id, authoriserId },
      });

      const distinctApprovers = await tx.milestoneAuthorisation.count({ where: { milestoneId: milestone.id } });
      const [society, committeeRosterSize] = await Promise.all([tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } }), this.committeeRosterSize(tx, societyId)]);
      const approvalConfig = parseApprovalConfig(society.config);
      const required = requiredApprovers(Number(amount), approvalConfig, committeeRosterSize);

      if (distinctApprovers < required) {
        // Rung not yet met — nothing moves (not even retention). Return the
        // still-PENDING state as-is.
        return this.toBookingDetail(booking, booking.payout, booking.milestones);
      }

      if (isFirstMilestone) {
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
        await tx.booking.update({ where: { id: booking.id }, data: { retentionAmount: retention, retentionSetAside: true } });
        booking.retentionAmount = retention;
        booking.retentionSetAside = true;
      }

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

      executedAudit = {
        societyId,
        actorId: authoriserId,
        action: 'BULK_BUY_MILESTONE_EXECUTED',
        subjectType: 'Milestone',
        subjectId: updatedMilestone.id,
        payload: { bookingId, amount: amount.toString(), retentionSetAsideNow: isFirstMilestone, distinctApprovers, required },
      };

      const milestones = booking.milestones.map((m) => (m.id === updatedMilestone.id ? updatedMilestone : m));
      return this.toBookingDetail(booking, booking.payout, milestones);
    });

    // See authorisePayout's identical comment: written after the
    // transaction commits, never from inside it.
    if (executedAudit) {
      await this.auditService.appendBestEffort(executedAudit);
    }

    return detail;
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
  // Approval-ladder config — Phase 6.4 (M14)
  // -------------------------------------------------------------------

  /** Read-only: the society's effective approval-ladder config — the stored `config.approval` if present and valid, else DEFAULT_APPROVAL_CONFIG (see approval-ladder.util.ts's parseApprovalConfig). */
  async getApprovalConfig(societyId: string): Promise<ApprovalConfig> {
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId } });
    return parseApprovalConfig(society.config);
  }

  /**
   * Sets this society's approval-ladder thresholds (BACKEND_PLAN.md Phase
   * 6.4 item 6) — writes `{ ...existingConfig, approval: {...} }` onto
   * Society.config, i.e. merges only the `approval` sub-key, leaving any
   * other config key (e.g. the job-post rate limit, or an operator-set
   * feature toggle) untouched. This is deliberately NOT the same as
   * UpdateSocietyDto's operator-facing `config` field, which replaces the
   * whole object — see that DTO's doc comment; the two would otherwise
   * clobber each other.
   *
   * Committee-scoped, not operator-only (see BookingsController/
   * ApprovalConfigController's `@Roles(...)`): thresholds for a bulk-buy
   * disbursement's approval ladder are a SOCIETY governance decision (how
   * many of ITS OWN officers must sign off, and when a full committee
   * majority kicks in) — the same category of decision SocietyRolesService
   * already lets a COMMITTEE member make (who holds TREASURER/
   * DEPUTY_TREASURER/COMMITTEE at all). A platform operator has no visibility
   * into a specific society's officer roster or risk appetite and
   * shouldn't be setting its money-movement policy; that's why this is
   * COMMITTEE/TREASURER-gated in this module rather than folded into the
   * operator-only `PATCH /operator/societies/:id`.
   */
  async setApprovalConfig(societyId: string, actorId: string, dto: SetApprovalConfigDto): Promise<ApprovalConfig> {
    const candidate: ApprovalConfig = { lowerThreshold: dto.lowerThreshold, upperThreshold: dto.upperThreshold, majorityFraction: dto.majorityFraction };
    const validationError = validateApprovalConfig(candidate);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId } });
    const existingConfig = typeof society.config === 'object' && society.config !== null ? (society.config as Record<string, unknown>) : {};
    const newConfig = { ...existingConfig, approval: candidate };

    await this.prisma.society.update({ where: { id: societyId }, data: { config: newConfig as unknown as Prisma.InputJsonValue } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'APPROVAL_CONFIG_SET',
      subjectType: 'Society',
      subjectId: societyId,
      payload: candidate,
    });

    return candidate;
  }

  // -------------------------------------------------------------------
  // Resident polls (Flow B) — Phase 5
  // -------------------------------------------------------------------

  /**
   * Resident opens a Flow B poll: a PollType.BULK_BUY_RESIDENT row (the
   * shared Phase 3 Poll table, owned end-to-end by this module — see
   * PollsService's own doc comment for the ownership split) tagging an
   * existing Vendor in the caller's own society. `proposedMinimum` becomes
   * Poll.minCommitments until (and unless) the vendor confirms a different
   * figure via vendorConfirm. Nothing fires here — the poll starts OPEN
   * with no vendor response yet.
   */
  async createResidentPoll(societyId: string, creatorId: string, dto: CreateResidentPollDto): Promise<ResidentPollDetail> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.taggedVendorId } });
    if (!vendor || vendor.societyId !== societyId) {
      throw new NotFoundException('Vendor not found');
    }

    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('closesAt must be a valid date in the future');
    }

    const poll = await this.prisma.poll.create({
      data: {
        societyId,
        creatorId,
        pollType: PollType.BULK_BUY_RESIDENT,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        minCommitments: dto.proposedMinimum,
        closesAt,
        status: PollStatus.OPEN,
        taggedVendorId: dto.taggedVendorId,
      },
    });

    return this.toResidentPollDetail(poll, creatorId);
  }

  async listResidentPolls(societyId: string, callerId: string): Promise<ResidentPollDetail[]> {
    const polls = await this.prisma.poll.findMany({
      where: { societyId, pollType: PollType.BULK_BUY_RESIDENT },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(polls.map((poll) => this.toResidentPollDetail(poll, callerId)));
  }

  async getResidentPoll(societyId: string, id: string, callerId: string): Promise<ResidentPollDetail> {
    const poll = await this.getResidentPollInternal(societyId, id);
    return this.toResidentPollDetail(poll, callerId);
  }

  /**
   * A COMMITTEE member, acting for the tagged vendor (no vendor login in
   * v1 — same stance as CreateOfferDto/createOffer), confirms the terms
   * Flow B fires under: a minimum headcount (replacing the resident's
   * proposedMinimum outright), a unit price, and an optional discount
   * ladder (validated exactly like Offer.discountLadder). Guards: the poll
   * is BULK_BUY_RESIDENT, still OPEN, and hasn't already been confirmed or
   * declined (one vendor response per poll, whichever comes first).
   *
   * If the commitment count already meets confirmedMinimum (residents piled
   * in before the vendor responded), this fires the poll immediately, in
   * the SAME transaction as the confirmation — mirroring
   * PollsService.join's synchronous auto-fire pattern (re-checking status
   * inside the tx right before firing, so a poll can never be fired twice).
   */
  async vendorConfirm(societyId: string, pollId: string, dto: VendorConfirmDto): Promise<ResidentPollDetail> {
    const ladderError = dto.discountLadder ? validateLadder(dto.discountLadder) : null;
    if (ladderError) {
      throw new BadRequestException(ladderError);
    }
    const ladder: LadderRung[] | null = dto.discountLadder ? dto.discountLadder.map((rung) => ({ minN: rung.minN, pct: rung.pct })) : null;

    return this.prisma.$transaction(async (tx) => {
      // Serializes against joinResidentPoll on the SAME poll (same
      // namespace+key) — see RESIDENT_POLL_FIRE_LOCK_NAMESPACE's doc
      // comment. Must be the first statement, before any read.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESIDENT_POLL_FIRE_LOCK_NAMESPACE}, hashtext(${pollId}))`;

      const poll = await tx.poll.findUnique({ where: { id: pollId } });
      if (!poll || poll.societyId !== societyId) {
        throw new NotFoundException('Poll not found');
      }
      if (poll.pollType !== PollType.BULK_BUY_RESIDENT) {
        throw new BadRequestException('Not a resident bulk-buy poll');
      }
      if (poll.status !== PollStatus.OPEN) {
        throw new BadRequestException(`Poll is not open (status=${poll.status})`);
      }
      if (poll.vendorConfirmedAt || poll.vendorDeclinedAt) {
        throw new BadRequestException('The vendor has already responded to this poll');
      }

      const updated = await tx.poll.update({
        where: { id: pollId },
        data: {
          vendorConfirmedAt: this.clock.now(),
          vendorConfirmedMinimum: dto.confirmedMinimum,
          vendorUnitPrice: dto.unitPrice,
          minCommitments: dto.confirmedMinimum,
          ...(ladder ? { vendorDiscountLadder: ladder as unknown as Prisma.InputJsonValue } : {}),
        },
      });

      const commitmentCount = await tx.pollCommitment.count({ where: { pollId } });
      if (commitmentCount >= dto.confirmedMinimum) {
        // Re-check status inside the tx (mirrors fireOffer's caller,
        // BulkBuyService.commit): guards against firing twice.
        const stillOpen = await tx.poll.findUnique({ where: { id: pollId }, select: { status: true } });
        if (stillOpen?.status === PollStatus.OPEN) {
          await this.fireResidentPoll(tx, updated, commitmentCount);
        }
      }

      const finalPoll = await tx.poll.findUniqueOrThrow({ where: { id: pollId } });
      return this.loadResidentPollDetail(tx, finalPoll, null);
    });
  }

  /** Vendor declines (via a COMMITTEE member) — poll is CANCELLED outright; no fire, ever, for this poll. */
  async vendorDecline(societyId: string, pollId: string): Promise<ResidentPollDetail> {
    return this.prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({ where: { id: pollId } });
      if (!poll || poll.societyId !== societyId) {
        throw new NotFoundException('Poll not found');
      }
      if (poll.pollType !== PollType.BULK_BUY_RESIDENT) {
        throw new BadRequestException('Not a resident bulk-buy poll');
      }
      if (poll.status !== PollStatus.OPEN) {
        throw new BadRequestException(`Poll is not open (status=${poll.status})`);
      }
      if (poll.vendorConfirmedAt || poll.vendorDeclinedAt) {
        throw new BadRequestException('The vendor has already responded to this poll');
      }

      const now = this.clock.now();
      const updated = await tx.poll.update({
        where: { id: pollId },
        data: { vendorDeclinedAt: now, status: PollStatus.CANCELLED, closedAt: now },
      });

      return this.loadResidentPollDetail(tx, updated, null);
    });
  }

  /**
   * Resident registers interest (mirrors PollsService.join's shape exactly,
   * but against PollType.BULK_BUY_RESIDENT specifically, and with a
   * vendor-confirmation-aware fire condition instead of EVENT's plain
   * commitmentCount >= minCommitments). 409 on double-join (the shared
   * PollCommitment [pollId, residentId] unique constraint); 400 if the poll
   * isn't OPEN (covers "declined" — vendorDecline sets status CANCELLED —
   * and "already fired") or its closesAt has passed.
   *
   * After recording the join, fires in the SAME transaction iff: the vendor
   * has confirmed (vendorConfirmedAt set), the commitment count has reached
   * vendorConfirmedMinimum, and closesAt hasn't passed — re-checked fresh
   * inside the tx (not off the pre-join snapshot) so a race with
   * vendorConfirm/vendorDecline can't double-fire or fire a declined poll.
   */
  async joinResidentPoll(societyId: string, pollId: string, residentId: string): Promise<ResidentPollDetail> {
    const poll = await this.getResidentPollInternal(societyId, pollId);
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException(`Poll is not open for joining (status=${poll.status})`);
    }
    if (poll.closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('Poll closesAt has passed');
    }

    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId: residentId, tenureEndedAt: null, flat: { societyId } },
      select: { flatId: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }

    await this.prisma.$transaction(async (tx) => {
      // Serializes against vendorConfirm (and other concurrent joins) on the
      // SAME poll (same namespace+key) — see
      // RESIDENT_POLL_FIRE_LOCK_NAMESPACE's doc comment. Must be the first
      // statement, before any read, so two different residents racing
      // across the fire threshold can't both observe status=OPEN and both
      // fire (the [pollId, residentId] unique constraint below only stops
      // the SAME resident joining twice, not two different residents
      // racing past minCommitments together).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESIDENT_POLL_FIRE_LOCK_NAMESPACE}, hashtext(${pollId}))`;

      try {
        await tx.pollCommitment.create({ data: { pollId, residentId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Already joined');
        }
        throw error;
      }

      const commitmentCount = await tx.pollCommitment.count({ where: { pollId } });
      const current = await tx.poll.findUnique({ where: { id: pollId } });
      const now = this.clock.now().getTime();
      if (
        current &&
        current.status === PollStatus.OPEN &&
        current.vendorConfirmedAt &&
        current.vendorConfirmedMinimum !== null &&
        commitmentCount >= current.vendorConfirmedMinimum &&
        now < current.closesAt.getTime()
      ) {
        await this.fireResidentPoll(tx, current, commitmentCount);
      }
    });

    return this.getResidentPoll(societyId, pollId, residentId);
  }

  /**
   * Fires a Flow B poll: sets status FIRED (+firedAt); resolves each
   * PollCommitment's resident to their active Occupancy in this society
   * (skipped — shouldn't happen — if a resident who joined has since lost
   * their occupancy here); creates one Commitment per resolved participant
   * with pollId set (offerId null, per Commitment's "exactly one of
   * offerId/pollId" invariant) and status PENDING; computes
   * appliedDiscountPct from the vendor's confirmed discountLadder via
   * appliedTier (0 if the vendor set no ladder); computes
   * discountedUnitPrice from vendorUnitPrice; then delegates to
   * createBookingWithEscrow — the SAME helper fireOffer uses — with
   * tier=SMALL (Flow B is SMALL-only in v1; a LARGE-via-poll
   * milestone/retention variant is out of scope for this phase),
   * sourceType='POLL', sourceId=this poll's id, vendorId=taggedVendorId.
   * Downstream (pay via webhook, sign off, authorisePayout) is the
   * unmodified Flow A booking/payout code — it can't tell a POLL-sourced
   * booking from an OFFER-sourced one.
   */
  private async fireResidentPoll(tx: Prisma.TransactionClient, poll: PollModel, commitmentCount: number): Promise<void> {
    const ladder = poll.vendorDiscountLadder as unknown as LadderRung[] | null;
    const pct = ladder ? (appliedTier(ladder, commitmentCount) ?? 0) : 0;

    await tx.poll.update({ where: { id: poll.id }, data: { status: PollStatus.FIRED, firedAt: this.clock.now() } });

    const pollCommitments = await tx.pollCommitment.findMany({ where: { pollId: poll.id }, orderBy: { createdAt: 'asc' } });
    const discountedUnitPrice = new Decimal(poll.vendorUnitPrice ?? 0)
      .mul(new Decimal(100).minus(pct))
      .div(100)
      .toDecimalPlaces(2);

    const participants: { commitmentId: string; residentId: string; flatId: string }[] = [];
    for (const pollCommitment of pollCommitments) {
      const occupancy = await tx.occupancy.findFirst({
        where: { userId: pollCommitment.residentId, tenureEndedAt: null, flat: { societyId: poll.societyId } },
        select: { flatId: true },
      });
      if (!occupancy) {
        // Shouldn't happen (see this method's doc comment) — skip rather
        // than blocking the whole poll from firing for everyone else.
        continue;
      }

      const commitment = await tx.commitment.create({
        data: { pollId: poll.id, residentId: pollCommitment.residentId, flatId: occupancy.flatId, status: CommitmentStatus.PENDING },
      });
      participants.push({ commitmentId: commitment.id, residentId: pollCommitment.residentId, flatId: occupancy.flatId });
    }

    await this.createBookingWithEscrow(tx, {
      societyId: poll.societyId,
      vendorId: poll.taggedVendorId!,
      sourceType: 'POLL',
      sourceId: poll.id,
      tier: JobCardTier.SMALL,
      milestoneTemplate: null,
      retentionDays: null,
      discountedUnitPrice,
      appliedDiscountPct: pct,
      scope: poll.title,
      idempotencyPrefix: `poll:${poll.id}`,
      participants,
    });
  }

  // -------------------------------------------------------------------
  // Weekly-recurring offers — Phase 5
  // -------------------------------------------------------------------

  /**
   * "Rolls" a WEEKLY-recurring Offer whose deadline has passed into a fresh
   * OPEN offer cloned from it (same vendor/category/title/description/
   * unitPrice/discountLadder/tier/milestoneTemplate/retentionPct/
   * retentionDays/recurring), deadline = the just-expired offer's deadline
   * + 7 days (anchored to the original schedule rather than to Clock.now(),
   * so a late roll call doesn't drift the weekly cadence), and empty
   * commitments. The rolled-from offer is left as-is if it's already
   * FIRED/CANCELLED; if still OPEN (deadline passed but nobody ever called
   * this), it's flipped to EXPIRED so it stops accepting commits. v1 has no
   * scheduler (@nestjs/schedule wasn't added — same stance as
   * PollsService.processExpired) — a periodic job would call this
   * automatically; for now it's a committee-triggered endpoint.
   */
  async rollOffer(societyId: string, offerId: string): Promise<OfferDetail> {
    const offer = await this.getOfferInternal(societyId, offerId);
    if (offer.recurring !== OfferRecurrence.WEEKLY) {
      throw new BadRequestException('Only a WEEKLY-recurring offer can be rolled');
    }
    if (offer.deadline.getTime() > this.clock.now().getTime()) {
      throw new BadRequestException("This offer's deadline has not passed yet");
    }

    const rolled = await this.prisma.$transaction(async (tx) => {
      if (offer.status === OfferStatus.OPEN) {
        await tx.offer.update({ where: { id: offer.id }, data: { status: OfferStatus.EXPIRED } });
      }

      return tx.offer.create({
        data: {
          societyId: offer.societyId,
          vendorId: offer.vendorId,
          category: offer.category,
          title: offer.title,
          description: offer.description,
          unitPrice: offer.unitPrice,
          discountLadder: offer.discountLadder as unknown as Prisma.InputJsonValue,
          minCommitments: offer.minCommitments,
          deadline: new Date(offer.deadline.getTime() + 7 * 24 * 60 * 60 * 1000),
          tier: offer.tier,
          retentionPct: offer.retentionPct,
          retentionDays: offer.retentionDays,
          recurring: offer.recurring,
          ...(offer.milestoneTemplate !== null ? { milestoneTemplate: offer.milestoneTemplate as unknown as Prisma.InputJsonValue } : {}),
        },
      });
    });

    return this.toOfferDetail(rolled, null);
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Phase 6.4 rung-3 input: the count of DISTINCT users holding at least one
   * of COMMITTEE/TREASURER/DEPUTY_TREASURER in this society right now — "the
   * committee roster" the ladder's majorityFraction is a fraction of. Reads
   * through `tx` so it's evaluated inside the same advisory-locked
   * transaction as the authorisation call it's feeding, never off a stale
   * snapshot.
   */
  private async committeeRosterSize(tx: Prisma.TransactionClient, societyId: string): Promise<number> {
    const officers = await tx.role.findMany({
      where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return officers.length;
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

  private async getResidentPollInternal(societyId: string, id: string): Promise<PollModel> {
    const poll = await this.prisma.poll.findUnique({ where: { id } });
    if (!poll || poll.societyId !== societyId || poll.pollType !== PollType.BULK_BUY_RESIDENT) {
      throw new NotFoundException('Poll not found');
    }
    return poll;
  }

  private async toResidentPollDetail(poll: PollModel, callerId: string | null): Promise<ResidentPollDetail> {
    return this.loadResidentPollDetail(this.prisma, poll, callerId);
  }

  /** Shared by every Flow B read path (create/list/get/vendorConfirm/vendorDecline/join), including from inside a transaction client. */
  private async loadResidentPollDetail(client: PrismaService | Prisma.TransactionClient, poll: PollModel, callerId: string | null): Promise<ResidentPollDetail> {
    const [commitmentCount, hasJoined, booking] = await Promise.all([
      client.pollCommitment.count({ where: { pollId: poll.id } }),
      callerId ? client.pollCommitment.findUnique({ where: { pollId_residentId: { pollId: poll.id, residentId: callerId } } }).then(Boolean) : Promise.resolve(undefined),
      poll.status === PollStatus.FIRED ? client.booking.findFirst({ where: { sourceType: 'POLL', sourceId: poll.id } }) : Promise.resolve(null),
    ]);

    return {
      ...poll,
      commitmentCount,
      ...(callerId ? { hasJoined } : {}),
      bookingId: booking?.id ?? null,
    };
  }
}
