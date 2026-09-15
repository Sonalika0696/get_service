import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, BookingStatus, CommitmentStatus, JobCardStatus, JobCardTier, OfferStatus, PayoutAuthKind, PayoutStatus } from '../../generated/prisma/enums.js';
import type { BookingModel, JobCardModel, OfferModel, PayoutModel } from '../../generated/prisma/models.js';
import { appliedTier, minCommitmentsOf, nextTierThreshold, validateLadder, type LadderRung } from './discount-ladder.util.js';
import type { CreateOfferDto } from './dto/create-offer.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

const DEFAULT_COMMISSION_PCT = 10;

/** API-facing shape: the offer row plus a live tier readout. */
export type OfferDetail = OfferModel & {
  commitmentCount: number;
  currentTierPct: number | null;
  nextTierAt: number | null;
  hasCommitted?: boolean;
};

/** API-facing shape: a booking plus its job cards and payout state. */
export type BookingDetail = BookingModel & {
  jobCards: JobCardModel[];
  payout: PayoutModel | null;
};

/**
 * Phase 4C — vendor-initiated bulk-buy (Flow A): offer -> resident commit
 * -> auto-fire -> escrow -> job cards -> sign-off -> dual-authorised payout.
 * Builds directly on the Phase 4A ledger (LedgerService) and Phase 4B
 * payments (PaymentsService, RazorpayService's stub) — see this class's
 * method-level doc comments for the exact money flow.
 *
 * v1 assumption (documented, not hidden): there is no vendor login/session
 * yet, so a vendor never calls these routes itself. A COMMITTEE member
 * creates an Offer "on the vendor's behalf" by naming an existing Vendor id
 * in the request body. A real vendor-authenticated flow is future work.
 *
 * Money flow summary (see authorisePayout for the code):
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

    const booking = await tx.booking.create({
      data: {
        societyId: offer.societyId,
        vendorId: offer.vendorId,
        sourceType: 'OFFER',
        sourceId: offer.id,
        status: BookingStatus.ACTIVE,
        tier: JobCardTier.SMALL,
      },
    });

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
          tier: JobCardTier.SMALL,
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
  // Bookings / payout
  // -------------------------------------------------------------------

  async getBooking(societyId: string, bookingId: string): Promise<BookingDetail> {
    return this.loadBookingDetail(this.prisma, societyId, bookingId);
  }

  /**
   * Dual-authorisation payout. Modeling choice (documented, since the task
   * spec left the SYSTEM-vs-TREASURER sequencing to us): the SYSTEM
   * authorisation is NOT a standing background check — it is the automated
   * rule-check ("every job card signed off, every commitment funded, escrow
   * covers the amount") run and recorded the moment a TREASURER calls this
   * endpoint. Since RolesGuard already blocks any non-TREASURER from
   * reaching this method at all, a SYSTEM row is never persisted by itself
   * without a TREASURER also present in the same call — so "only the SYSTEM
   * rule-check, no treasurer" never pays, and a treasurer's very first
   * (successful) call authorises AND executes in one shot. Re-calling this
   * endpoint after PAID is a verified no-op (idempotent via the Payout.status
   * guard below) — no second ledger postings, no second razorpay.payout call.
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(52, hashtext(${bookingId}))`;

      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true } });
      if (!booking || booking.societyId !== societyId) {
        throw new NotFoundException('Booking not found');
      }

      let payout = booking.payout;
      if (payout?.status === PayoutStatus.PAID) {
        return this.toBookingDetail(booking, payout);
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

      return this.toBookingDetail(booking, payout);
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
    const booking = await client.booking.findUnique({ where: { id: bookingId }, include: { jobCards: true, payout: true } });
    if (!booking || booking.societyId !== societyId) {
      throw new NotFoundException('Booking not found');
    }
    return this.toBookingDetail(booking, booking.payout);
  }

  private toBookingDetail(booking: BookingModel & { jobCards: JobCardModel[] }, payout: PayoutModel | null): BookingDetail {
    const { jobCards, ...rest } = booking as BookingModel & { jobCards: JobCardModel[] };
    return { ...rest, jobCards, payout };
  }
}
