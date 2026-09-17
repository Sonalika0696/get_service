/**
 * Pure money/scheduling math for Phase 12 (M12) corpus treasury —
 * independent of Prisma/Nest/Decimal, unit-tested directly (see
 * treasury-math.util.spec.ts). Every deposit-facing amount that reaches
 * this module is a plain `number` of rupees; TreasuryService is
 * responsible for converting to/from Prisma.Decimal at its boundary.
 */

import { PREMATURE_WITHDRAWAL_PENALTY_PCT } from './treasury-config.util.js';

/** Rounds to 2 decimal places using standard half-up rounding on cents, avoiding the classic binary-float `1.005 -> 1.00` trap by rounding on a scaled integer. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Simple interest over `days`, on a fixed 365-day year (leap-agnostic: a
 * tenor that spans Feb 29 earns exactly the same interest as an
 * identical-length tenor that doesn't — the bank convention this system
 * assumes throughout, documented once here rather than at every call
 * site). `ratePct` is the ANNUAL percentage rate (e.g. 7.10 for 7.10%).
 */
export function simpleInterest(principal: number, ratePct: number, days: number): number {
  return round2(principal * (ratePct / 100) * (days / 365));
}

/** Principal plus its full-tenor simple interest — what a deposit is projected to be worth at `placedAt + tenorDays` (FixedDeposit.maturityAmount). */
export function maturityAmount(principal: number, ratePct: number, tenorDays: number): number {
  return round2(principal + simpleInterest(principal, ratePct, tenorDays));
}

/**
 * The rate actually paid on a premature withdrawal: the deposit's own
 * `ratePct` minus a penalty (percentage points), floored at 0 — a
 * penalty larger than the deposit's rate never produces a negative rate.
 */
export function prematureWithdrawalRatePct(ratePct: number, penaltyPct: number = PREMATURE_WITHDRAWAL_PENALTY_PCT): number {
  return Math.max(0, ratePct - penaltyPct);
}

/**
 * How much CORPUS is free to place into a new deposit right now: the
 * pocket's current balance, less the sweep rule's operating float floor,
 * less every rupee already earmarked by a still-PROPOSED deposit (so two
 * proposals in flight can't both claim the same money before either is
 * placed). Never negative — callers treat <= 0 as "nothing to sweep".
 */
export function availableToSweep(corpusBalance: number, operatingFloatFloor: number, proposedPrincipalSum: number): number {
  return corpusBalance - operatingFloatFloor - proposedPrincipalSum;
}

/** A month bucket key that is stable across years (`YYYY * 12 + monthIndex`), so `Date`s a year apart never collide. */
export function monthKey(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** Adds `days` whole days to `date`, returning a new Date (UTC-based, no DST ambiguity since this codebase treats all business dates as UTC calendar days). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Phase 12 maturity ladder (brief step 8): picks the sweep tenor, in
 * `stepDays`-day increments starting at `minTenorDays` up to `maxTenorDays`,
 * whose resulting maturity month currently holds the FEWEST existing
 * ACTIVE-deposit maturities — spreading the corpus's maturities across the
 * year instead of letting them all pile into one month. Ties resolve to the
 * SHORTER tenor (the loop only ever adopts a strictly smaller count, so the
 * first — shortest — tenor to reach the eventual minimum wins).
 *
 * An empty `activeMaturities` list (no deposits yet, or none active) means
 * every candidate month has count 0, so the shortest tenor (`minTenorDays`)
 * is returned — the natural "no ladder yet" answer.
 *
 * Defensive: if `minTenorDays > maxTenorDays` (a malformed config), the loop
 * never runs and `minTenorDays` itself is returned unchanged.
 */
export function chooseSweepTenor(
  now: Date,
  activeMaturities: readonly Date[],
  minTenorDays: number,
  maxTenorDays: number = 365,
  stepDays: number = 30,
): number {
  const countsByMonth = new Map<number, number>();
  for (const maturity of activeMaturities) {
    const key = monthKey(maturity);
    countsByMonth.set(key, (countsByMonth.get(key) ?? 0) + 1);
  }

  let bestTenor = minTenorDays;
  let bestCount = Infinity;
  for (let tenor = minTenorDays; tenor <= maxTenorDays; tenor += stepDays) {
    const candidateMonth = monthKey(addDays(now, tenor));
    const count = countsByMonth.get(candidateMonth) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      bestTenor = tenor;
    }
  }
  return bestTenor;
}
