import { Prisma } from '../../generated/prisma/client.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export interface MilestoneAmountInput {
  /** Sum of every JobCard.unitPrice on the booking (the escrowed total). */
  jobCardsTotal: Decimal | number | string;
  /** Booking.retentionSetAside — true once the FIRST milestone has ever been authorised. */
  retentionSetAside: boolean;
  /** Booking.retentionAmount — meaningful once retentionSetAside is true. */
  retentionAmount: Decimal | number | string;
  /** Offer.retentionPct — only read when retentionSetAside is still false (first milestone). */
  offerRetentionPct: Decimal | number | string;
  /** This milestone's own pct share of vendorPayable. */
  milestonePct: Decimal | number | string;
  /** True when this is the highest-sequence milestone on the booking. */
  isLastMilestone: boolean;
  /** Sum of Milestone.amount for every already-PAID milestone on the booking (only used for the last milestone's remainder calc). */
  alreadyPaidTotal: Decimal | number | string;
}

/**
 * DUPLICATED business rule — re-derive at integration. Read-only replica of
 * the amount math inside `BulkBuyService.authoriseMilestone` (bulk-buy is a
 * write-side module out of scope for this lane; the write path there is the
 * source of truth — see this file's module doc comment). Computes what a
 * given milestone would release RIGHT NOW without writing anything,
 * exactly mirroring authoriseMilestone's retention/vendorPayable/pct
 * arithmetic: retention is either the already-set-aside amount, or (for the
 * still-open first milestone) `total * offerRetentionPct / 100`; the last
 * milestone by sequence always releases whatever remains of vendorPayable
 * rather than `vendorPayable * pct / 100`, to avoid rounding dust.
 */
export function computeMilestoneAmount(input: MilestoneAmountInput): Decimal {
  const total = new Decimal(input.jobCardsTotal);
  const retention = input.retentionSetAside ? new Decimal(input.retentionAmount) : total.mul(new Decimal(input.offerRetentionPct)).div(100).toDecimalPlaces(2);
  const vendorPayable = total.minus(retention);

  if (input.isLastMilestone) {
    return vendorPayable.minus(new Decimal(input.alreadyPaidTotal)).toDecimalPlaces(2);
  }
  return vendorPayable.mul(new Decimal(input.milestonePct)).div(100).toDecimalPlaces(2);
}
