/**
 * Pure late-fee math, independent of Prisma/Nest — unit-tested directly
 * (see late-fee.util.spec.ts). Phase 9.2 (BACKEND_HANDOFF.md §6 / 9.2)
 * mirrors bulk-buy/approval-ladder.util.ts's shape exactly: a config
 * interface, a documented conservative default, a config-parsing function
 * that falls back FULLY to the default on anything malformed (never a
 * partial merge), and a pure computation function the service layer calls
 * from inside its own transaction.
 *
 * Model: a MaintenanceCharge accrues a late fee once `asOf` is more than
 * `graceDays` past `dueDate` — a flat fee plus a per-day fee for every day
 * beyond the grace period, capped so the TOTAL accrued late fee (across
 * every accrual pass, not just this one) never exceeds
 * `capFraction * amount`. `computeLateFee` is called on each
 * MaintenanceBillingService.accrueLateFees pass and returns only the
 * ADDITIONAL amount to accrue on top of whatever is already recorded in
 * `alreadyAccrued` — never negative, and never pushing the running total
 * past the cap even if called repeatedly or with a stale `alreadyAccrued`
 * that already exceeds what the formula would produce (e.g. after a
 * config change lowers the cap).
 */

export interface LateFeeConfig {
  /** Days after dueDate before any late fee starts accruing. */
  graceDays: number;
  /** One-time fee added the moment the charge goes past its grace period. */
  flatFee: number;
  /** Additional fee added per whole day past the grace period. */
  dailyFee: number;
  /** Fraction (0, 1] of the charge's `amount` that lateFeeAccrued may never exceed, in total. */
  capFraction: number;
}

/**
 * Documented default, used whenever a society's `config.lateFee` is absent
 * or malformed (see parseLateFeeConfig) — deliberately conservative
 * (safest-for-money): a full week's grace period, a modest flat + daily
 * fee, and a low cap (10% of the charge), rather than defaulting to no
 * grace period or an uncapped/punitive fee. Chosen, not derived from any
 * spec value.
 */
export const DEFAULT_LATE_FEE_CONFIG: LateFeeConfig = {
  graceDays: 7,
  flatFee: 50,
  dailyFee: 2,
  capFraction: 0.1,
};

/** Returns null if valid, else a human-readable validation error. */
export function validateLateFeeConfig(config: { graceDays: number; flatFee: number; dailyFee: number; capFraction: number }): string | null {
  if (typeof config.graceDays !== 'number' || !Number.isFinite(config.graceDays) || !Number.isInteger(config.graceDays) || config.graceDays < 0) {
    return 'graceDays must be a non-negative integer';
  }
  if (typeof config.flatFee !== 'number' || !Number.isFinite(config.flatFee) || config.flatFee < 0) {
    return 'flatFee must be a non-negative number';
  }
  if (typeof config.dailyFee !== 'number' || !Number.isFinite(config.dailyFee) || config.dailyFee < 0) {
    return 'dailyFee must be a non-negative number';
  }
  if (typeof config.capFraction !== 'number' || !Number.isFinite(config.capFraction) || config.capFraction <= 0 || config.capFraction > 1) {
    return 'capFraction must be a number in (0, 1]';
  }
  return null;
}

/**
 * Reads `config.lateFee` off a Society's raw (Json) `config` column.
 * Conservative on anything unexpected: a missing `lateFee` key, or one that
 * fails validateLateFeeConfig, falls back to the FULL documented default
 * (never a partial merge of "whatever fields happened to look valid") —
 * mirrors parseApprovalConfig exactly, for the same money-safety reason.
 */
export function parseLateFeeConfig(rawConfig: unknown): LateFeeConfig {
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    return DEFAULT_LATE_FEE_CONFIG;
  }
  const lateFee = (rawConfig as Record<string, unknown>).lateFee;
  if (typeof lateFee !== 'object' || lateFee === null) {
    return DEFAULT_LATE_FEE_CONFIG;
  }
  const candidate = lateFee as Record<string, unknown>;
  const graceDays = candidate.graceDays;
  const flatFee = candidate.flatFee;
  const dailyFee = candidate.dailyFee;
  const capFraction = candidate.capFraction;
  if (typeof graceDays !== 'number' || typeof flatFee !== 'number' || typeof dailyFee !== 'number' || typeof capFraction !== 'number') {
    return DEFAULT_LATE_FEE_CONFIG;
  }
  const parsed = { graceDays, flatFee, dailyFee, capFraction };
  return validateLateFeeConfig(parsed) === null ? parsed : DEFAULT_LATE_FEE_CONFIG;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ComputeLateFeeInput {
  /** The MaintenanceCharge's base amount (never lateFeeAccrued/paidAmount) — what capFraction is measured against. */
  amount: number;
  dueDate: Date;
  /** MaintenanceCharge.lateFeeAccrued as it stands right now, before this call. */
  alreadyAccrued: number;
}

/**
 * Returns the ADDITIONAL late fee to accrue as of `asOf`, given the charge's
 * `amount`/`dueDate` and what has already accrued — never negative, and the
 * running total (`alreadyAccrued + result`) never exceeds
 * `capFraction * amount`. Still within the grace period (or `amount <= 0`)
 * always returns 0.
 */
export function computeLateFee(input: ComputeLateFeeInput, asOf: Date, config: LateFeeConfig): number {
  if (input.amount <= 0) return 0;

  const graceEndsAt = input.dueDate.getTime() + config.graceDays * MS_PER_DAY;
  if (asOf.getTime() <= graceEndsAt) return 0;

  // Ceil, not floor: any part of a day past the grace boundary counts as
  // one full late day (day 1 covers (graceEndsAt, graceEndsAt+1day], etc.),
  // so a charge is never "0 days late" the moment it crosses the boundary.
  const daysPastGrace = Math.ceil((asOf.getTime() - graceEndsAt) / MS_PER_DAY);
  const rawTotalOwed = config.flatFee + config.dailyFee * daysPastGrace;

  const cap = input.amount * config.capFraction;
  const cappedTotalOwed = Math.min(rawTotalOwed, cap);

  const additional = cappedTotalOwed - input.alreadyAccrued;
  return additional > 0 ? additional : 0;
}
