/**
 * Pure meter-reading validation for Phase 10 (electricity/water billing),
 * independent of Prisma/Nest — unit-tested directly (see
 * reading-validation.util.spec.ts). Mirrors bank-statement-csv.util.ts's
 * approach of staying a plain, side-effect-free module so it can be called
 * from the billing-cycle validate stage without any I/O.
 *
 * Domain: a Reading carries an immutable raw dial `value`. Consumption for a
 * period is (current value − previous value) × the meter's multiplier (CT
 * ratio). A meter can wrap around past its maximum dial value (ROLLOVER) —
 * distinguishing a genuine rollover from a bad/negative reading requires
 * `meterMaxValue`. Any anomaly flags the meter (see MeterReadingAnomaly in
 * schema.prisma) and halts the billing cycle until a treasurer resolves it.
 *
 * AnomalyKind mirrors the Prisma `MeterAnomalyKind` enum names exactly
 * (NEGATIVE_CONSUMPTION, STALLED, ROLLOVER, OUT_OF_BOUNDS) but is declared
 * locally as a string union — this module must NOT import from the Prisma
 * client so it stays pure and independently testable.
 */

export type AnomalyKind = 'NEGATIVE_CONSUMPTION' | 'STALLED' | 'ROLLOVER' | 'OUT_OF_BOUNDS';

export interface DetectAnomaliesInput {
  /** Prior reading's raw dial value. */
  prevValue: number;
  /** Current reading's raw dial value. */
  currValue: number;
  /** CT/multiplier applied to raw reading deltas. */
  multiplier: number;
  /** Trailing consumption history (same units as the derived consumption) used to judge plausibility. */
  historicalConsumptions: number[];
  /** The meter's maximum dial value before it wraps back to 0, if known. */
  meterMaxValue?: number;
  /** Spike threshold as a multiple of the trailing mean. Defaults to 3. */
  outOfBoundsFactor?: number;
}

const DEFAULT_OUT_OF_BOUNDS_FACTOR = 3;

/** Arithmetic mean of a (possibly empty) numeric array; 0 for an empty array. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * True when a wrapped-dial reading is plausible given the meter's history:
 * the wrapped consumption must be non-negative and, when history exists,
 * must not itself be an implausible spike (> outOfBoundsFactor × mean).
 * With no history, any non-negative wrapped value is accepted as plausible
 * (there's nothing to compare against yet).
 */
function isPlausibleRollover(wrappedConsumption: number, historicalConsumptions: number[], outOfBoundsFactor: number): boolean {
  if (wrappedConsumption < 0) return false;
  if (historicalConsumptions.length === 0) return true;
  const avg = mean(historicalConsumptions);
  if (avg <= 0) return true; // no typical usage to compare against — don't reject on that basis alone
  return wrappedConsumption <= outOfBoundsFactor * avg;
}

/**
 * Derives billed consumption from two raw dial readings.
 *
 * Normal case: (currValue − prevValue) × multiplier.
 *
 * Rollover case: when currValue < prevValue and meterMaxValue is given, the
 * dial is assumed to have wrapped past its maximum and back around to
 * currValue: ((meterMaxValue − prevValue) + currValue) × multiplier.
 *
 * Without a meterMaxValue, a currValue < prevValue simply yields a negative
 * raw delta (still scaled by multiplier) — callers use detectAnomalies to
 * flag that condition; this function itself always returns a non-negative
 * number, clamping any residual negative result to 0.
 */
export function deriveConsumption(prevValue: number, currValue: number, multiplier: number, meterMaxValue?: number): number {
  let rawDelta: number;
  if (currValue < prevValue && meterMaxValue !== undefined) {
    rawDelta = meterMaxValue - prevValue + currValue;
  } else {
    rawDelta = currValue - prevValue;
  }
  const consumption = rawDelta * multiplier;
  return consumption < 0 ? 0 : consumption;
}

/**
 * Flags anomalies for a candidate reading pair. Returns an empty array when
 * the reading is clean. Multiple flags may apply simultaneously (e.g. a
 * rollover reading can also be an out-of-bounds spike).
 */
export function detectAnomalies(input: DetectAnomaliesInput): AnomalyKind[] {
  const { prevValue, currValue, multiplier, historicalConsumptions, meterMaxValue } = input;
  const outOfBoundsFactor = input.outOfBoundsFactor ?? DEFAULT_OUT_OF_BOUNDS_FACTOR;
  const flags: AnomalyKind[] = [];

  const dialWentBackwards = currValue < prevValue;
  let rolledOver = false;

  if (dialWentBackwards) {
    // A backwards dial is only a plausible ROLLOVER when meterMaxValue is
    // known AND the wrapped consumption it implies is itself plausible
    // (non-negative and not a wild spike vs. history). Otherwise it's a
    // genuine NEGATIVE_CONSUMPTION — e.g. a misread, a swapped meter, or a
    // meter running backwards.
    if (meterMaxValue !== undefined) {
      const wrapped = (meterMaxValue - prevValue + currValue) * multiplier;
      if (isPlausibleRollover(wrapped, historicalConsumptions, outOfBoundsFactor)) {
        rolledOver = true;
        flags.push('ROLLOVER');
      } else {
        flags.push('NEGATIVE_CONSUMPTION');
      }
    } else {
      flags.push('NEGATIVE_CONSUMPTION');
    }
  }

  const consumption = deriveConsumption(prevValue, currValue, multiplier, meterMaxValue);
  const avgHistorical = mean(historicalConsumptions);

  // STALLED: zero consumption while history shows the meter typically
  // registers usage (mean of history > 0). Never raised alongside a
  // detected NEGATIVE_CONSUMPTION/ROLLOVER backwards dial, since those
  // already explain a non-zero raw delta; only applies to a flat/zero delta.
  if (!dialWentBackwards && consumption === 0 && avgHistorical > 0) {
    flags.push('STALLED');
  }

  // OUT_OF_BOUNDS: consumption exceeds outOfBoundsFactor × the trailing mean
  // of historicalConsumptions — an implausible spike. Only evaluated when
  // history is non-empty and has a positive mean (otherwise there's no
  // baseline to compare against). Skipped for a rollover reading whose
  // wrapped value was already vetted for plausibility by isPlausibleRollover
  // above, to avoid double-flagging the same spike condition twice.
  if (!rolledOver && historicalConsumptions.length > 0 && avgHistorical > 0 && consumption > outOfBoundsFactor * avgHistorical) {
    flags.push('OUT_OF_BOUNDS');
  }

  return flags;
}
