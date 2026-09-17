/**
 * Pure config validation/merge logic for Phase 12 (M12) corpus treasury —
 * independent of Prisma/Nest, unit-tested directly (see
 * treasury-config.util.spec.ts). Mirrors bulk-buy/approval-ladder.util.ts's
 * shape (DEFAULT_*, validate*, parse*) but for the sweep-rule parameters
 * stored at `Society.config.treasury`.
 */

export interface TreasuryConfig {
  /** Rupees, the minimum CORPUS balance the sweep rule must always leave behind. */
  operatingFloatFloor: number;
  /** Minimum tenor (days) any deposit — manual or swept — may be placed for. */
  minTenorDays: number;
  /** Tenor (days) the sweep rule uses when nothing else picks one; must be >= minTenorDays. */
  defaultTenorDays: number;
  /** Annual rate (percentage, e.g. 6.50) the sweep rule assumes when placing a deposit. */
  defaultRatePct: number;
  /** Bank name the sweep rule records on a swept deposit. */
  defaultBankName: string;
}

/**
 * Documented defaults (safest-for-money stance, same as
 * DEFAULT_APPROVAL_CONFIG): a conservative float floor, a 30-day minimum
 * tenor (long enough that a resident emergency withdrawal from the
 * OPERATING pockets isn't blocked by an over-eager sweep), and a modest
 * assumed rate.
 */
export const DEFAULT_TREASURY_CONFIG: TreasuryConfig = {
  operatingFloatFloor: 100_000,
  minTenorDays: 30,
  defaultTenorDays: 365,
  defaultRatePct: 6.5,
  defaultBankName: 'Not configured',
};

/** Premature-withdrawal penalty, percentage points shaved off the deposit's own rate — a fixed platform constant, not per-society config (brief: "a configurable constant, default 1.00 percentage point"). Kept here, not in TreasuryConfig, since no route exposes it for editing in v1. */
export const PREMATURE_WITHDRAWAL_PENALTY_PCT = 1.0;

/** Returns null if valid, else a human-readable validation error. */
export function validateTreasuryConfig(config: {
  operatingFloatFloor: number;
  minTenorDays: number;
  defaultTenorDays: number;
  defaultRatePct: number;
  defaultBankName: string;
}): string | null {
  if (typeof config.operatingFloatFloor !== 'number' || !Number.isFinite(config.operatingFloatFloor) || config.operatingFloatFloor < 0) {
    return 'operatingFloatFloor must be a non-negative number';
  }
  if (typeof config.minTenorDays !== 'number' || !Number.isInteger(config.minTenorDays) || config.minTenorDays < 7) {
    return 'minTenorDays must be an integer >= 7';
  }
  if (typeof config.defaultTenorDays !== 'number' || !Number.isInteger(config.defaultTenorDays) || config.defaultTenorDays < config.minTenorDays) {
    return 'defaultTenorDays must be an integer >= minTenorDays';
  }
  if (typeof config.defaultRatePct !== 'number' || !Number.isFinite(config.defaultRatePct) || config.defaultRatePct < 0 || config.defaultRatePct > 20) {
    return 'defaultRatePct must be a number in [0, 20]';
  }
  if (typeof config.defaultBankName !== 'string' || config.defaultBankName.trim().length === 0) {
    return 'defaultBankName must be a non-empty string';
  }
  return null;
}

export interface TreasuryConfigReadout {
  config: TreasuryConfig;
  /** True when the society has never set `config.treasury` (or the stored value was invalid) — the caller is seeing DEFAULT_TREASURY_CONFIG, not something the society chose. */
  isDefault: boolean;
}

/**
 * Reads `config.treasury` off a Society's raw (Json) `config` column.
 * Conservative on anything unexpected — mirrors parseApprovalConfig's
 * all-or-nothing stance: a missing key or one that fails validation falls
 * back to the full DEFAULT_TREASURY_CONFIG, flagged via `isDefault`.
 */
export function parseTreasuryConfig(rawConfig: unknown): TreasuryConfigReadout {
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    return { config: DEFAULT_TREASURY_CONFIG, isDefault: true };
  }
  const treasury = (rawConfig as Record<string, unknown>).treasury;
  if (typeof treasury !== 'object' || treasury === null) {
    return { config: DEFAULT_TREASURY_CONFIG, isDefault: true };
  }
  const candidate = treasury as Record<string, unknown>;
  const operatingFloatFloor = candidate.operatingFloatFloor;
  const minTenorDays = candidate.minTenorDays;
  const defaultTenorDays = candidate.defaultTenorDays;
  const defaultRatePct = candidate.defaultRatePct;
  const defaultBankName = candidate.defaultBankName;
  if (
    typeof operatingFloatFloor !== 'number' ||
    typeof minTenorDays !== 'number' ||
    typeof defaultTenorDays !== 'number' ||
    typeof defaultRatePct !== 'number' ||
    typeof defaultBankName !== 'string'
  ) {
    return { config: DEFAULT_TREASURY_CONFIG, isDefault: true };
  }
  const parsed: TreasuryConfig = { operatingFloatFloor, minTenorDays, defaultTenorDays, defaultRatePct, defaultBankName };
  return validateTreasuryConfig(parsed) === null ? { config: parsed, isDefault: false } : { config: DEFAULT_TREASURY_CONFIG, isDefault: true };
}

/**
 * Merges `{ treasury: candidate }` onto an existing raw Society.config
 * object WITHOUT clobbering any other key already stored there (the
 * approval ladder, service-request thresholds, ...) — same contract as
 * BulkBuyService.setApprovalConfig's merge (see that method's doc comment).
 */
export function mergeTreasuryConfig(existingRawConfig: unknown, candidate: TreasuryConfig): Record<string, unknown> {
  const existing = typeof existingRawConfig === 'object' && existingRawConfig !== null ? (existingRawConfig as Record<string, unknown>) : {};
  return { ...existing, treasury: candidate };
}
