/**
 * Pure approval-ladder math, independent of Prisma/Nest — unit-tested
 * directly (see approval-ladder.util.spec.ts). Phase 6.4 (BACKEND_PLAN.md
 * Phase 6.4, M14) generalises BulkBuyService.authorisePayout /
 * authoriseMilestone from an implied "2 approvers" (SYSTEM auto-row +
 * 1 TREASURER) to N DISTINCT human officers across three rungs, driven by
 * per-society config stored in `Society.config.approval`.
 *
 * Amount basis (documented design choice): the amount evaluated against the
 * thresholds is always the amount THIS authorisation call is about to move —
 * the Payout's full amount for a SMALL booking, or a single Milestone's own
 * release amount for a LARGE booking — never the booking's overall escrowed
 * total. A LARGE booking's milestones are staged, separately-authorised
 * disbursements; gating each one by its own size (rather than the whole
 * booking's) keeps a small final "mop-up" milestone from requiring the same
 * committee-majority a huge first milestone would, and vice versa.
 *
 * Rungs, for a disbursement of amount A (config's thresholds are inclusive
 * lower bounds of the NEXT rung, i.e. `A <= lowerThreshold` is rung 1):
 *   A <= lowerThreshold                      -> 1 officer  (rung 1, routine)
 *   lowerThreshold < A <= upperThreshold      -> 2 distinct officers (rung 2)
 *   A > upperThreshold                        -> ceil(majorityFraction *
 *                                                 committeeRosterSize),
 *                                                 never fewer than 2 (rung 3,
 *                                                 committee majority)
 * Roster = distinct users holding COMMITTEE/TREASURER/DEPUTY_TREASURER in
 * that society, counted at authorisation time (see
 * BulkBuyService.committeeRosterSize) — so a roster change between two
 * authorisation calls on the same booking can shift the requirement; that's
 * intentional (the ladder reflects governance capacity *right now*, not a
 * snapshot from whenever the booking fired).
 */

export interface ApprovalConfig {
  /** Amounts at or below this need only 1 officer (rung 1). */
  lowerThreshold: number;
  /** Amounts at or below this (and above lowerThreshold) need 2 distinct officers (rung 2). */
  upperThreshold: number;
  /** Fraction (0, 1] of the committee roster required for rung 3 (amounts above upperThreshold), rounded UP, floored at 2. */
  majorityFraction: number;
}

/**
 * Documented defaults, used whenever a society's `config.approval` is
 * absent or malformed (see parseApprovalConfig) — deliberately conservative
 * (safest-for-money): a low lower-bound and a 50% committee majority above
 * the upper bound, rather than defaulting to "1 officer always suffices".
 * Chosen, not derived from any spec value, so every existing SMALL/LARGE
 * e2e fixture's amounts (<= INR 1900 for a SMALL payout, <= INR 1026 per
 * LARGE milestone) fall under `lowerThreshold` and keep behaving as a
 * single-officer authorisation — see bulk-buy.e2e-spec.ts / flow-b.e2e-spec.ts
 * and this phase's report for the exact ripple.
 */
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  lowerThreshold: 5_000,
  upperThreshold: 50_000,
  majorityFraction: 0.5,
};

/** Returns null if valid, else a human-readable validation error. */
export function validateApprovalConfig(config: { lowerThreshold: number; upperThreshold: number; majorityFraction: number }): string | null {
  if (typeof config.lowerThreshold !== 'number' || !Number.isFinite(config.lowerThreshold) || config.lowerThreshold <= 0) {
    return 'lowerThreshold must be a positive number';
  }
  if (typeof config.upperThreshold !== 'number' || !Number.isFinite(config.upperThreshold) || config.upperThreshold <= 0) {
    return 'upperThreshold must be a positive number';
  }
  if (config.lowerThreshold >= config.upperThreshold) {
    return 'lowerThreshold must be less than upperThreshold';
  }
  if (typeof config.majorityFraction !== 'number' || !Number.isFinite(config.majorityFraction) || config.majorityFraction <= 0 || config.majorityFraction > 1) {
    return 'majorityFraction must be a number in (0, 1]';
  }
  return null;
}

/**
 * Reads `config.approval` off a Society's raw (Json) `config` column.
 * Conservative on anything unexpected: a missing `approval` key, or one that
 * fails validateApprovalConfig, falls back to the FULL documented default
 * (never a partial merge of "whatever fields happened to look valid") — a
 * half-trusted threshold is a money-safety risk, an all-or-nothing default
 * is not.
 */
export function parseApprovalConfig(rawConfig: unknown): ApprovalConfig {
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    return DEFAULT_APPROVAL_CONFIG;
  }
  const approval = (rawConfig as Record<string, unknown>).approval;
  if (typeof approval !== 'object' || approval === null) {
    return DEFAULT_APPROVAL_CONFIG;
  }
  const candidate = approval as Record<string, unknown>;
  const lowerThreshold = candidate.lowerThreshold;
  const upperThreshold = candidate.upperThreshold;
  const majorityFraction = candidate.majorityFraction;
  if (typeof lowerThreshold !== 'number' || typeof upperThreshold !== 'number' || typeof majorityFraction !== 'number') {
    return DEFAULT_APPROVAL_CONFIG;
  }
  const parsed = { lowerThreshold, upperThreshold, majorityFraction };
  return validateApprovalConfig(parsed) === null ? parsed : DEFAULT_APPROVAL_CONFIG;
}

/**
 * The number of DISTINCT human officers required to authorise a
 * disbursement of `amount`, given this society's ApprovalConfig and its
 * current committee roster size (distinct COMMITTEE/TREASURER/
 * DEPUTY_TREASURER holders). Rung 3 is never fewer than 2, even if the
 * roster is tiny (a 1-person "committee" still needs a second, independent
 * officer for a large disbursement — majority-of-one is not a control).
 */
export function requiredApprovers(amount: number, config: ApprovalConfig, committeeRosterSize: number): number {
  if (amount <= config.lowerThreshold) return 1;
  if (amount <= config.upperThreshold) return 2;
  const majority = Math.ceil(config.majorityFraction * committeeRosterSize);
  return Math.max(2, majority);
}
