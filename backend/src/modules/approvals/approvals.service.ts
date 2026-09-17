import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  BookingStatus,
  CommitmentStatus,
  DisputeStatus,
  DisputeTriagePriority,
  EventSettlementStatus,
  FixedDepositAction,
  FixedDepositStatus,
  JobCardTier,
  PayoutStatus,
  PocketTransferStatus,
  RatificationStatus,
  RoleKind,
  WelfareDisbursementStatus,
} from '../../generated/prisma/enums.js';
import { parseApprovalConfig, requiredApprovers } from '../bulk-buy/approval-ladder.util.js';
import { requiredTransferApprovers } from '../pocket-transfers/transfer-approval.util.js';
import { committeeRosterSize } from './committee-roster.util.js';
import { computeMilestoneAmount } from './milestone-amount.util.js';
import type { ApprovalItem, ApprovalItemKind, ApprovalsInboxResponse } from './approval-item.types.js';

const Decimal = Prisma.Decimal;

const TRIAGE_RANK: Record<DisputeTriagePriority, number> = {
  [DisputeTriagePriority.HIGH]: 0,
  [DisputeTriagePriority.MEDIUM]: 1,
  [DisputeTriagePriority.LOW]: 2,
};

const ALL_KINDS: ApprovalItemKind[] = [
  'POCKET_TRANSFER',
  'PAYOUT',
  'MILESTONE',
  'FIXED_DEPOSIT_PLACEMENT',
  'FIXED_DEPOSIT_WITHDRAWAL',
  'EVENT_SETTLEMENT',
  'WELFARE_DISBURSEMENT',
  'RATIFICATION',
  'DISPUTE',
];

/**
 * Committee approvals inbox — `GET /me/approvals` (Phase 11/12, lane
 * b1read). A lightweight, mobile-scoped aggregate of every time-sensitive
 * action the CALLING officer can still act on, across nine different
 * approval-ladder / adjudication surfaces spread over modules this lane
 * does not own (bulk-buy, pocket-transfers, and three sibling write-side
 * lanes — events settlement, fixed deposits, welfare disbursement, and
 * disputes — that are being built in parallel and do not exist as services
 * in this worktree yet, only as frozen Prisma models. See this lane's
 * brief §"IMPORTANT context").
 *
 * Every per-kind business rule this service depends on but does not own
 * (required-approver ladders, "what counts as pending", roster size) is
 * DUPLICATED here, deliberately, in ONE place — this file — with a doc
 * comment on each duplication site pointing at the module that owns the
 * real rule, so the orchestrator can swap each one for the owning
 * service's own helper at integration without hunting through the
 * codebase. Genuine reuse (not duplication) happens wherever an existing
 * pure, exported util already exists: `approval-ladder.util.ts`'s
 * `requiredApprovers`/`parseApprovalConfig` and
 * `transfer-approval.util.ts`'s `requiredTransferApprovers` are imported
 * directly, never re-implemented.
 *
 * Performance: every per-kind query below is independent of every other —
 * they all run inside a single `Promise.all`, never sequentially, and each
 * one is itself a single round trip (a `findMany` with the includes it
 * needs, no per-row follow-up query) — see ApprovalsController for the
 * `Server-Timing` header this is measured against.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInbox(societyId: string, callerId: string, callerRoleKinds: RoleKind[]): Promise<ApprovalsInboxResponse> {
    const isCommittee = callerRoleKinds.includes(RoleKind.COMMITTEE);
    const canRatify = callerRoleKinds.includes(RoleKind.COMMITTEE) || callerRoleKinds.includes(RoleKind.TREASURER);

    const [society, rosterSize, pocketTransfers, payoutBookings, milestoneBookings, fixedDeposits, eventSettlements, welfareDisbursements, ratifications, disputes] = await Promise.all([
      this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } }),
      committeeRosterSize(this.prisma, societyId),
      this.loadPocketTransfers(societyId),
      this.loadPayoutCandidates(societyId),
      this.loadMilestoneCandidates(societyId),
      this.loadFixedDeposits(societyId),
      this.loadEventSettlements(societyId),
      this.loadWelfareDisbursements(societyId),
      canRatify ? this.loadRatifications(societyId) : Promise.resolve([]),
      isCommittee ? this.loadDisputes(societyId) : Promise.resolve([]),
    ]);

    const approvalConfig = parseApprovalConfig(society.config);

    const items: ApprovalItem[] = [
      ...this.buildPocketTransferItems(pocketTransfers, callerId, approvalConfig, rosterSize),
      ...this.buildPayoutItems(payoutBookings, callerId, approvalConfig, rosterSize),
      ...this.buildMilestoneItems(milestoneBookings, callerId, approvalConfig, rosterSize),
      ...this.buildFixedDepositItems(fixedDeposits, callerId),
      ...this.buildEventSettlementItems(eventSettlements, callerId, approvalConfig, rosterSize),
      ...this.buildWelfareDisbursementItems(welfareDisbursements, callerId, approvalConfig, rosterSize),
      ...this.buildRatificationItems(ratifications, societyId),
      ...this.buildDisputeItems(disputes, callerId),
    ];

    items.sort((a, b) => this.compareItems(a, b));

    const byKind = Object.fromEntries(ALL_KINDS.map((kind) => [kind, 0])) as Record<ApprovalItemKind, number>;
    for (const item of items) byKind[item.kind]++;

    return { items, counts: { total: items.length, byKind } };
  }

  // -------------------------------------------------------------------
  // Sorting — "oldest first within kind, money items before non-money".
  // DISPUTE additionally orders HIGH -> LOW triagePriority (brief §DISPUTE),
  // which takes precedence over its own createdAt within that one kind.
  // -------------------------------------------------------------------
  private compareItems(a: ApprovalItem, b: ApprovalItem): number {
    const aMoney = a.amount !== null;
    const bMoney = b.amount !== null;
    if (aMoney !== bMoney) return aMoney ? -1 : 1;

    if (a.kind === 'DISPUTE' && b.kind === 'DISPUTE') {
      const rankDiff = (a as unknown as { triageRank: number }).triageRank - (b as unknown as { triageRank: number }).triageRank;
      if (rankDiff !== 0) return rankDiff;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  // -------------------------------------------------------------------
  // POCKET_TRANSFER
  // -------------------------------------------------------------------
  private loadPocketTransfers(societyId: string) {
    return this.prisma.pocketTransfer.findMany({
      where: { societyId, status: PocketTransferStatus.PENDING },
      include: { authorisations: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildPocketTransferItems(
    rows: Awaited<ReturnType<ApprovalsService['loadPocketTransfers']>>,
    callerId: string,
    config: ReturnType<typeof parseApprovalConfig>,
    rosterSize: number,
  ): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const transfer of rows) {
      const alreadySigned = transfer.authorisations.some((a) => a.authoriserId === callerId);
      if (alreadySigned) continue;

      const required = requiredTransferApprovers(Number(transfer.amount), config, rosterSize);
      items.push({
        kind: 'POCKET_TRANSFER',
        id: transfer.id,
        title: `Pocket transfer: ${transfer.fromKind} -> ${transfer.toKind}`,
        subtitle: transfer.reasonCode,
        amount: new Decimal(transfer.amount).toString(),
        requiredApprovers: required,
        authorisedCount: transfer.authorisations.length,
        alreadyAuthorisedByMe: false,
        createdAt: transfer.createdAt,
        actionHint: `POST /pocket-transfers/${transfer.id}/authorise`,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------
  // PAYOUT — SMALL bookings, COMPLETED, all commitments FUNDED, no PAID payout.
  // -------------------------------------------------------------------
  private loadPayoutCandidates(societyId: string) {
    return this.prisma.booking.findMany({
      where: {
        societyId,
        tier: JobCardTier.SMALL,
        status: BookingStatus.COMPLETED,
        OR: [{ payout: null }, { payout: { status: { not: PayoutStatus.PAID } } }],
      },
      include: {
        payout: { include: { authorisations: true } },
        jobCards: { include: { commitment: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildPayoutItems(
    rows: Awaited<ReturnType<ApprovalsService['loadPayoutCandidates']>>,
    callerId: string,
    config: ReturnType<typeof parseApprovalConfig>,
    rosterSize: number,
  ): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const booking of rows) {
      if (booking.jobCards.length === 0) continue;
      const allFunded = booking.jobCards.every((jc) => jc.commitment.status === CommitmentStatus.FUNDED);
      if (!allFunded) continue;

      const alreadySigned = booking.payout?.authorisations.some((a) => a.authoriserId === callerId) ?? false;
      if (alreadySigned) continue;

      const amount = booking.jobCards.reduce((sum, jc) => sum.plus(new Decimal(jc.unitPrice)), new Decimal(0));
      const required = requiredApprovers(Number(amount), config, rosterSize);

      items.push({
        kind: 'PAYOUT',
        id: booking.id,
        title: 'Vendor payout',
        subtitle: `Booking ${booking.id}`,
        amount: amount.toString(),
        requiredApprovers: required,
        authorisedCount: booking.payout?.authorisations.length ?? 0,
        alreadyAuthorisedByMe: false,
        createdAt: booking.createdAt,
        actionHint: `POST /bookings/${booking.id}/payout/authorise`,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------
  // MILESTONE — next unpaid milestone (lowest sequence) of COMPLETED LARGE bookings.
  // -------------------------------------------------------------------
  /**
   * Loads LARGE-booking milestone candidates plus the retention percentage of
   * each booking's source Offer, in ONE extra batched query (not one per
   * booking). The retention percentage matters until retention has been set
   * aside at the first milestone authorisation: without it the first
   * milestone's amount would be shown pre-retention, i.e. higher than what
   * authoriseMilestone will actually pay, on the screen an officer reads
   * before approving.
   */
  private async loadMilestoneCandidates(societyId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { societyId, tier: JobCardTier.LARGE, status: BookingStatus.COMPLETED },
      include: {
        jobCards: { include: { commitment: true } },
        milestones: { include: { authorisations: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const offerIds = [...new Set(bookings.filter((b) => b.sourceType === 'OFFER' && !b.retentionSetAside).map((b) => b.sourceId))];
    const offers = offerIds.length > 0 ? await this.prisma.offer.findMany({ where: { id: { in: offerIds } }, select: { id: true, retentionPct: true } }) : [];
    const retentionPctByOfferId = new Map(offers.map((o) => [o.id, o.retentionPct]));

    return bookings.map((booking) => ({ ...booking, offerRetentionPct: retentionPctByOfferId.get(booking.sourceId) ?? new Decimal(0) }));
  }

  private buildMilestoneItems(
    rows: Awaited<ReturnType<ApprovalsService['loadMilestoneCandidates']>>,
    callerId: string,
    config: ReturnType<typeof parseApprovalConfig>,
    rosterSize: number,
  ): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const booking of rows) {
      if (booking.jobCards.length === 0) continue;
      const allFunded = booking.jobCards.every((jc) => jc.commitment.status === CommitmentStatus.FUNDED);
      if (!allFunded) continue;

      const nextUnpaid = booking.milestones.filter((m) => m.status !== PayoutStatus.PAID).sort((a, b) => a.sequence - b.sequence)[0];
      if (!nextUnpaid) continue;

      const alreadySigned = nextUnpaid.authorisations.some((a) => a.authoriserId === callerId);
      if (alreadySigned) continue;

      const maxSequence = Math.max(...booking.milestones.map((m) => m.sequence));
      const isLastMilestone = nextUnpaid.sequence === maxSequence;
      const alreadyPaidTotal = booking.milestones.filter((m) => m.status === PayoutStatus.PAID).reduce((sum, m) => sum.plus(new Decimal(m.amount ?? 0)), new Decimal(0));
      const jobCardsTotal = booking.jobCards.reduce((sum, jc) => sum.plus(new Decimal(jc.unitPrice)), new Decimal(0));

      // offerRetentionPct is only consulted while retention hasn't been set
      // aside yet (matches authoriseMilestone's own short-circuit); it is
      // batch-loaded in loadMilestoneCandidates.
      const amount = computeMilestoneAmount({
        jobCardsTotal,
        retentionSetAside: booking.retentionSetAside,
        retentionAmount: booking.retentionAmount,
        offerRetentionPct: booking.offerRetentionPct,
        milestonePct: nextUnpaid.pct,
        isLastMilestone,
        alreadyPaidTotal,
      });

      const required = requiredApprovers(Number(amount), config, rosterSize);

      items.push({
        kind: 'MILESTONE',
        id: nextUnpaid.id,
        title: `Milestone: ${nextUnpaid.name}`,
        subtitle: `Booking ${booking.id}`,
        amount: amount.toString(),
        requiredApprovers: required,
        authorisedCount: nextUnpaid.authorisations.length,
        alreadyAuthorisedByMe: false,
        createdAt: booking.createdAt,
        actionHint: `POST /bookings/${booking.id}/milestones/${nextUnpaid.id}/authorise`,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------
  // FIXED_DEPOSIT_PLACEMENT / FIXED_DEPOSIT_WITHDRAWAL
  // -------------------------------------------------------------------
  private loadFixedDeposits(societyId: string) {
    return this.prisma.fixedDeposit.findMany({
      where: { societyId, status: { in: [FixedDepositStatus.PROPOSED, FixedDepositStatus.ACTIVE] } },
      include: { authorisations: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Reconciled with TreasuryService at integration: placement and premature
   * withdrawal each need exactly 2 distinct officers (dual authorisation,
   * SDD I7), not the amount-driven ladder. TreasuryService records the
   * initiator as the first PLACE authorisation at propose time, so a
   * PROPOSED deposit shows 1 of 2 and the initiator can never be the second.
   */
  private buildFixedDepositItems(rows: Awaited<ReturnType<ApprovalsService['loadFixedDeposits']>>, callerId: string): ApprovalItem[] {
    const REQUIRED = 2;
    const items: ApprovalItem[] = [];
    for (const fd of rows) {
      if (fd.status === FixedDepositStatus.PROPOSED) {
        if (fd.initiatedById === callerId) continue;
        const placeAuths = fd.authorisations.filter((a) => a.action === FixedDepositAction.PLACE);
        if (placeAuths.some((a) => a.authoriserId === callerId)) continue;

        items.push({
          kind: 'FIXED_DEPOSIT_PLACEMENT',
          id: fd.id,
          title: `Place fixed deposit: ${fd.bankName}`,
          subtitle: `${fd.tenorDays} days @ ${new Decimal(fd.ratePct).toString()}%`,
          amount: new Decimal(fd.principal).toString(),
          requiredApprovers: REQUIRED,
          authorisedCount: placeAuths.length,
          alreadyAuthorisedByMe: false,
          createdAt: fd.createdAt,
          actionHint: `POST /treasury/deposits/${fd.id}/authorise-placement`,
        });
      } else if (fd.status === FixedDepositStatus.ACTIVE) {
        const withdrawAuths = fd.authorisations.filter((a) => a.action === FixedDepositAction.WITHDRAW);
        if (withdrawAuths.length !== 1) continue;
        if (withdrawAuths.some((a) => a.authoriserId === callerId)) continue;

        items.push({
          kind: 'FIXED_DEPOSIT_WITHDRAWAL',
          id: fd.id,
          title: `Withdraw fixed deposit: ${fd.bankName}`,
          subtitle: `${fd.tenorDays} days @ ${new Decimal(fd.ratePct).toString()}%`,
          amount: new Decimal(fd.principal).toString(),
          requiredApprovers: REQUIRED,
          authorisedCount: withdrawAuths.length,
          alreadyAuthorisedByMe: false,
          createdAt: fd.createdAt,
          actionHint: `POST /treasury/deposits/${fd.id}/withdraw`,
        });
      }
    }
    return items;
  }

  // -------------------------------------------------------------------
  // EVENT_SETTLEMENT
  // -------------------------------------------------------------------
  private loadEventSettlements(societyId: string) {
    return this.prisma.eventSettlement.findMany({
      where: { status: EventSettlementStatus.PENDING, event: { societyId } },
      include: { authorisations: true, event: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildEventSettlementItems(
    rows: Awaited<ReturnType<ApprovalsService['loadEventSettlements']>>,
    callerId: string,
    config: ReturnType<typeof parseApprovalConfig>,
    rosterSize: number,
  ): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const settlement of rows) {
      if (settlement.authorisations.some((a) => a.authoriserId === callerId)) continue;

      // Ladder amount basis per brief: totalExpenses + max(surplus, 0), floored at 2 approvers (same floor as pocket transfers — reused directly, not re-implemented).
      const surplus = new Decimal(settlement.surplus);
      const basis = new Decimal(settlement.totalExpenses).plus(Decimal.max(surplus, 0));
      const required = requiredTransferApprovers(Number(basis), config, rosterSize);

      items.push({
        kind: 'EVENT_SETTLEMENT',
        id: settlement.id,
        title: `Event settlement: ${settlement.event.title}`,
        subtitle: `Surplus ${surplus.toString()}`,
        amount: basis.toString(),
        requiredApprovers: required,
        authorisedCount: settlement.authorisations.length,
        alreadyAuthorisedByMe: false,
        createdAt: settlement.createdAt,
        // The events module authorises a settlement by EVENT id (one settlement per event).
        actionHint: `POST /events/${settlement.eventId}/settlement/authorise`,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------
  // WELFARE_DISBURSEMENT
  // -------------------------------------------------------------------
  private loadWelfareDisbursements(societyId: string) {
    return this.prisma.welfareDisbursement.findMany({
      where: { societyId, status: WelfareDisbursementStatus.PENDING },
      include: { authorisations: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildWelfareDisbursementItems(
    rows: Awaited<ReturnType<ApprovalsService['loadWelfareDisbursements']>>,
    callerId: string,
    config: ReturnType<typeof parseApprovalConfig>,
    rosterSize: number,
  ): ApprovalItem[] {
    const items: ApprovalItem[] = [];
    for (const disbursement of rows) {
      if (disbursement.authorisations.some((a) => a.authoriserId === callerId)) continue;

      const required = requiredTransferApprovers(Number(disbursement.amount), config, rosterSize);

      items.push({
        kind: 'WELFARE_DISBURSEMENT',
        id: disbursement.id,
        title: `Welfare disbursement: ${disbursement.payeeName}`,
        subtitle: disbursement.purpose,
        amount: new Decimal(disbursement.amount).toString(),
        requiredApprovers: required,
        authorisedCount: disbursement.authorisations.length,
        alreadyAuthorisedByMe: false,
        createdAt: disbursement.createdAt,
        actionHint: `POST /welfare-disbursements/${disbursement.id}/authorise`,
      });
    }
    return items;
  }

  // -------------------------------------------------------------------
  // RATIFICATION — only surfaced to callers who hold a ratifying role
  // (COMMITTEE/TREASURER — see RatificationController's own @Roles(...),
  // reused verbatim rather than widened to DEPUTY_TREASURER/full committee
  // set this inbox otherwise uses).
  // -------------------------------------------------------------------
  private loadRatifications(societyId: string) {
    return this.prisma.occupancy.findMany({
      where: { flat: { societyId }, ratificationStatus: RatificationStatus.PENDING },
      include: { flat: { select: { unitNo: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildRatificationItems(rows: Awaited<ReturnType<ApprovalsService['loadRatifications']>>, societyId: string): ApprovalItem[] {
    return rows.map((occupancy) => ({
      kind: 'RATIFICATION' as const,
      id: occupancy.id,
      title: `Ratify occupancy: ${occupancy.user.name}`,
      subtitle: `Flat ${occupancy.flat.unitNo}`,
      amount: null,
      requiredApprovers: null,
      authorisedCount: null,
      alreadyAuthorisedByMe: false,
      createdAt: occupancy.createdAt,
      actionHint: `POST /society/${societyId}/ratifications/${occupancy.id}/ratify`,
    }));
  }

  // -------------------------------------------------------------------
  // DISPUTE — COMMITTEE only, excludes disputes the caller themselves raised.
  // -------------------------------------------------------------------
  private loadDisputes(societyId: string) {
    return this.prisma.dispute.findMany({
      where: { societyId, status: DisputeStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });
  }

  private buildDisputeItems(rows: Awaited<ReturnType<ApprovalsService['loadDisputes']>>, callerId: string): ApprovalItem[] {
    const items: (ApprovalItem & { triageRank: number })[] = [];
    for (const dispute of rows) {
      if (dispute.raisedById === callerId) continue;

      items.push({
        kind: 'DISPUTE',
        id: dispute.id,
        title: `Dispute: ${dispute.category}`,
        subtitle: dispute.reason,
        amount: new Decimal(dispute.disputedAmount).toString(),
        requiredApprovers: null,
        authorisedCount: null,
        alreadyAuthorisedByMe: false,
        createdAt: dispute.createdAt,
        actionHint: `POST /disputes/${dispute.id}/adjudicate`,
        triageRank: TRIAGE_RANK[dispute.triagePriority],
      });
    }
    return items;
  }
}
