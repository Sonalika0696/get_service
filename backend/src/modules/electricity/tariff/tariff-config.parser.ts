/**
 * Parses/validates a TariffSchedule row's raw JSONB columns (`slabs`,
 * `fixedCharges`, `dutyCess`) into a trusted TariffConfig
 * (./tariff-config.types.ts) — mirrors bulk-buy/approval-ladder.util.ts's
 * parseApprovalConfig / validateApprovalConfig shape (Phase 6.4) and
 * maintenance/late-fee.util.ts's parseLateFeeConfig (Phase 9.2): a
 * validate-with-readable-errors function plus a parse function, with
 * documented zero-defaults for the optional flat-money groups.
 *
 * Unlike ApprovalConfig/LateFeeConfig, a malformed `slabs` array is NOT
 * defaulted away — a wrong energy-charge rate table is a direct billing
 * error (silently substituting some "safe default" tariff could over- or
 * under-charge every resident on the schedule), so `parseTariffConfig`
 * THROWS on a malformed `slabs` input rather than falling back. The two
 * flat-money groups (`fixedCharges`, `dutyCess`) DO get documented
 * all-zero defaults when absent or malformed, same reasoning as
 * parseApprovalConfig's full-fallback-not-partial-merge rule: a charge
 * group that isn't configured contributes nothing, rather than the caller
 * guessing at a substitute value.
 */

import type { DutyCess, FixedCharges, Slab, TariffConfig } from './tariff-config.types.js';

/** Documented default: no fixed charges configured. */
export const DEFAULT_FIXED_CHARGES: FixedCharges = {
  perConnection: 0,
  perSanctionedLoadKw: 0,
};

/** Documented default: no duty/cess configured. */
export const DEFAULT_DUTY_CESS: DutyCess = {
  energyDutyPct: 0,
  fixedCess: 0,
};

/**
 * Returns null if `slabs` is a well-formed telescoping slab array, else a
 * human-readable validation error. Rules:
 *  - Must be a non-empty array.
 *  - Every entry must have a numeric, finite, non-negative `rate`.
 *  - Every entry's `upTo` must be either `null` or a finite, positive
 *    number.
 *  - `upTo` values (ignoring a trailing null) must be STRICTLY ascending —
 *    each slab must cover a non-empty band above the previous one.
 *  - Only the LAST slab may have `upTo: null` (the open-ended final band);
 *    a `null` anywhere else would leave later slabs unreachable.
 */
export function validateSlabs(slabs: unknown): string | null {
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return 'slabs must be a non-empty array';
  }
  let previousUpTo = 0;
  for (let i = 0; i < slabs.length; i++) {
    const slab = slabs[i] as Record<string, unknown> | null | undefined;
    if (typeof slab !== 'object' || slab === null) {
      return `slabs[${i}] must be an object`;
    }
    const rate = slab.rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
      return `slabs[${i}].rate must be a non-negative number`;
    }
    const upTo = slab.upTo;
    if (upTo === null) {
      if (i !== slabs.length - 1) {
        return `slabs[${i}].upTo may only be null on the last slab (the open-ended final band)`;
      }
      continue;
    }
    if (typeof upTo !== 'number' || !Number.isFinite(upTo) || upTo <= 0) {
      return `slabs[${i}].upTo must be a positive number or null`;
    }
    if (upTo <= previousUpTo) {
      return `slabs[${i}].upTo (${upTo}) must be strictly greater than the previous slab's upTo (${previousUpTo}) — slabs must be ascending`;
    }
    previousUpTo = upTo;
  }
  return null;
}

/** Returns null if valid, else a human-readable validation error. */
export function validateFixedCharges(fixedCharges: Record<string, unknown>): string | null {
  const { perConnection, perSanctionedLoadKw } = fixedCharges;
  if (perConnection !== undefined && (typeof perConnection !== 'number' || !Number.isFinite(perConnection) || perConnection < 0)) {
    return 'fixedCharges.perConnection must be a non-negative number';
  }
  if (perSanctionedLoadKw !== undefined && (typeof perSanctionedLoadKw !== 'number' || !Number.isFinite(perSanctionedLoadKw) || perSanctionedLoadKw < 0)) {
    return 'fixedCharges.perSanctionedLoadKw must be a non-negative number';
  }
  return null;
}

/** Returns null if valid, else a human-readable validation error. */
export function validateDutyCess(dutyCess: Record<string, unknown>): string | null {
  const { energyDutyPct, fixedCess } = dutyCess;
  if (energyDutyPct !== undefined && (typeof energyDutyPct !== 'number' || !Number.isFinite(energyDutyPct) || energyDutyPct < 0)) {
    return 'dutyCess.energyDutyPct must be a non-negative number';
  }
  if (fixedCess !== undefined && (typeof fixedCess !== 'number' || !Number.isFinite(fixedCess) || fixedCess < 0)) {
    return 'dutyCess.fixedCess must be a non-negative number';
  }
  return null;
}

/**
 * Parses `slabs` alone (the required, non-defaultable piece) into a typed,
 * validated `Slab[]`. Throws with validateSlabs's message on anything
 * malformed.
 */
function parseSlabs(rawSlabs: unknown): Slab[] {
  const error = validateSlabs(rawSlabs);
  if (error !== null) {
    throw new Error(`Invalid TariffSchedule slabs: ${error}`);
  }
  return (rawSlabs as Record<string, unknown>[]).map((slab) => ({
    upTo: slab.upTo === null ? null : (slab.upTo as number),
    rate: slab.rate as number,
  }));
}

/**
 * Parses `fixedCharges` (optional on the raw JSONB). Missing, non-object,
 * or field-level-malformed input falls back to the FULL documented default
 * (DEFAULT_FIXED_CHARGES) — never a partial merge, same all-or-nothing rule
 * as parseApprovalConfig, so a corrupted `perConnection` can't silently
 * leave a stale/unexpected `perSanctionedLoadKw` in play.
 */
function parseFixedCharges(rawFixedCharges: unknown): FixedCharges {
  if (typeof rawFixedCharges !== 'object' || rawFixedCharges === null) {
    return DEFAULT_FIXED_CHARGES;
  }
  const candidate = rawFixedCharges as Record<string, unknown>;
  if (validateFixedCharges(candidate) !== null) {
    return DEFAULT_FIXED_CHARGES;
  }
  return {
    perConnection: (candidate.perConnection as number | undefined) ?? 0,
    perSanctionedLoadKw: (candidate.perSanctionedLoadKw as number | undefined) ?? 0,
  };
}

/**
 * Parses `dutyCess` (optional on the raw JSONB) — same missing/malformed ->
 * full-default-fallback rule as parseFixedCharges.
 */
function parseDutyCess(rawDutyCess: unknown): DutyCess {
  if (typeof rawDutyCess !== 'object' || rawDutyCess === null) {
    return DEFAULT_DUTY_CESS;
  }
  const candidate = rawDutyCess as Record<string, unknown>;
  if (validateDutyCess(candidate) !== null) {
    return DEFAULT_DUTY_CESS;
  }
  return {
    energyDutyPct: (candidate.energyDutyPct as number | undefined) ?? 0,
    fixedCess: (candidate.fixedCess as number | undefined) ?? 0,
  };
}

/**
 * Parses a TariffSchedule row's raw JSONB value into a trusted
 * TariffConfig. `raw` is expected to be an object carrying `slabs` (required
 * — see the class-level doc comment on why this one throws instead of
 * defaulting), and optional `fixedCharges` / `dutyCess` (each independently
 * defaulted to all-zero when absent or malformed).
 *
 * Throws an `Error` when `raw` itself isn't an object, or when `slabs` is
 * missing or fails validateSlabs.
 */
export function parseTariffConfig(raw: unknown): TariffConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid TariffSchedule config: expected an object with a slabs array');
  }
  const candidate = raw as Record<string, unknown>;
  return {
    slabs: parseSlabs(candidate.slabs),
    fixedCharges: parseFixedCharges(candidate.fixedCharges),
    dutyCess: parseDutyCess(candidate.dutyCess),
  };
}
