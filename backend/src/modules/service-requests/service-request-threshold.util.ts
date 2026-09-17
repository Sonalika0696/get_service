/**
 * Pure per-category join-threshold resolution, independent of Prisma/Nest —
 * mirrors approval-ladder.util.ts's "parse-with-conservative-default"
 * pattern (BulkBuyService.authorisePayout/authoriseMilestone's
 * parseApprovalConfig): a society's `Society.config.serviceRequestThresholds`
 * is an OPTIONAL `{ [category: string]: number }` map naming, for any
 * category it cares to override, how many DISTINCT participating flats a
 * Phase 8.2 ServiceRequest needs before it pools (OPEN -> POOLED).
 *
 * The resolved threshold is FROZEN onto ServiceRequest.threshold the moment
 * the request is created (see ServiceRequestsService.createResident /
 * createCommittee) — a later config edit never moves an in-flight request's
 * own threshold, exactly like Offer.minCommitments is a one-time snapshot
 * of the discount ladder's lowest rung, not a live re-read.
 *
 * Conservative documented default, used whenever `serviceRequestThresholds`
 * is absent/malformed, or the specific category is missing, or its value
 * fails validation: DEFAULT_SERVICE_REQUEST_THRESHOLD = 3 distinct flats.
 * Chosen (not derived from any spec value) as a middle ground — low enough
 * that a genuinely useful bulk-buy category pools in practice, high enough
 * that a single resident (or two colluding ones) can't force a committee
 * vendor-assignment step on their own say-so. Every value is validated
 * independently (an all-or-nothing fallback to the default, never a partial
 * "whatever looked like a number"), matching parseApprovalConfig's own
 * money-safety stance on a half-trusted config blob.
 */

export const DEFAULT_SERVICE_REQUEST_THRESHOLD = 3;

export type ServiceRequestThresholdConfig = Record<string, number>;

/** Returns null if valid, else a human-readable validation error — same shape as approval-ladder.util.ts's validateApprovalConfig. */
export function validateServiceRequestThreshold(threshold: number): string | null {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || !Number.isInteger(threshold) || threshold < 2) {
    return 'threshold must be an integer >= 2 (a "pool" of one participant is not a pool)';
  }
  return null;
}

/**
 * Resolves the join threshold for `category` from a Society's raw (Json)
 * `config` column. Conservative on anything unexpected: a missing/malformed
 * `serviceRequestThresholds` key, a missing entry for this category, or an
 * entry that fails validateServiceRequestThreshold, all fall back to
 * DEFAULT_SERVICE_REQUEST_THRESHOLD — never a guess, never a crash.
 */
export function resolveServiceRequestThreshold(category: string, rawConfig: unknown): number {
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    return DEFAULT_SERVICE_REQUEST_THRESHOLD;
  }
  const thresholds = (rawConfig as Record<string, unknown>).serviceRequestThresholds;
  if (typeof thresholds !== 'object' || thresholds === null) {
    return DEFAULT_SERVICE_REQUEST_THRESHOLD;
  }
  const candidate = (thresholds as Record<string, unknown>)[category];
  if (typeof candidate !== 'number' || validateServiceRequestThreshold(candidate) !== null) {
    return DEFAULT_SERVICE_REQUEST_THRESHOLD;
  }
  return candidate;
}
