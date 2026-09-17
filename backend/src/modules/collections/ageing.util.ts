/**
 * Pure ageing/bucketing math for the collections & arrears read-model
 * (Phase 11/12, lane b1read). Independent of Prisma/Nest — unit-tested
 * directly (see ageing.util.spec.ts). Mirrors late-fee.util.ts's shape:
 * plain functions over plain numbers/dates, no Decimal/Prisma types
 * leaking in, so the arithmetic can be exhaustively tested at every
 * boundary without a database.
 *
 * A charge is "in arrears" analysis only while its status is PENDING or
 * PARTIAL — PAID and WAIVED charges are excluded upstream, before these
 * functions ever see them (see CollectionsService).
 */

export type ArrearsBucket = 'NOT_YET_DUE' | '0_30' | '31_60' | '61_90' | '90_PLUS';

export const ARREARS_BUCKETS: readonly ArrearsBucket[] = ['NOT_YET_DUE', '0_30', '31_60', '61_90', '90_PLUS'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Outstanding balance on one open MaintenanceCharge: `amount +
 * lateFeeAccrued - paidAmount`. Never negative (a charge cannot be
 * over-paid in this model; if it somehow were, treat it as fully settled
 * rather than showing a negative arrears figure). Callers pass plain
 * numbers (already `Number(decimal)`-converted) so this stays Decimal-free;
 * see CollectionsService for where the 2dp rounding happens (`Number` on a
 * Prisma Decimal preserves its exact decimal value up to float precision,
 * which is safe here because these are already 2dp-quantised currency
 * values coming straight out of Postgres `numeric` columns).
 */
export function outstandingOf(amount: number, lateFeeAccrued: number, paidAmount: number): number {
  const raw = amount + lateFeeAccrued - paidAmount;
  return raw > 0 ? Math.round(raw * 100) / 100 : 0;
}

/**
 * Whole days between `dueDate` and `now`. Negative when not yet due
 * (dueDate in the future). Uses calendar-time subtraction (ms diff / day),
 * matching late-fee.util.ts's own day-counting convention — no timezone
 * normalisation, since `dueDate` and `now` are both stored/compared as UTC
 * instants throughout this codebase (Clock.now()).
 */
export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.floor((now.getTime() - dueDate.getTime()) / MS_PER_DAY);
}

/**
 * Buckets by whole days overdue. Boundaries are inclusive lower bounds of
 * each named bucket:
 *   days < 0                -> NOT_YET_DUE
 *   0  <= days <= 30        -> 0_30
 *   31 <= days <= 60        -> 31_60
 *   61 <= days <= 90        -> 61_90
 *   days >= 91              -> 90_PLUS
 * (i.e. a charge exactly 30 days overdue is still "0_30"; exactly 31 days
 * overdue is the first day of "31_60"; exactly 90 is the last day of
 * "61_90"; 91 is the first day of "90_PLUS".)
 */
export function bucketOf(daysOverdueValue: number): ArrearsBucket {
  if (daysOverdueValue < 0) return 'NOT_YET_DUE';
  if (daysOverdueValue <= 30) return '0_30';
  if (daysOverdueValue <= 60) return '31_60';
  if (daysOverdueValue <= 90) return '61_90';
  return '90_PLUS';
}
