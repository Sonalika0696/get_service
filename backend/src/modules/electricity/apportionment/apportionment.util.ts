/**
 * Pure electricity-apportionment math, independent of Prisma/Nest — unit-tested
 * directly (see apportionment.util.spec.ts). Phase 10 (electricity & water
 * billing) needs two building blocks that have nothing to do with I/O:
 *
 *  1. `deriveCommonConsumption` — the society's bulk (DISCOM) meter reads the
 *     TOTAL units drawn; each flat's sub-meter reads that flat's own units.
 *     The difference is common-area consumption (lifts, pumps, corridor
 *     lighting, transformer/line losses, ...) that has no sub-meter of its
 *     own and must be apportioned across flats by some other basis (area).
 *
 *  2. `apportionByArea` — splits a money amount (common-area electricity
 *     cost, in this phase; reusable for any other area-weighted charge)
 *     across flats in proportion to each flat's area, with EXACT paise
 *     conservation (no rounding leak to or from the society).
 *
 * Both functions work entirely in INTEGER PAISE (1 rupee = 100 paise) — the
 * ₹↔paise conversion is the caller's job (typically at the Prisma boundary,
 * where money columns are stored as integer paise). Keeping this module
 * unaware of ₹ avoids floating-point money bugs creeping into the ladder.
 */

/**
 * Bulk (DISCOM) meter units minus the sum of all sub-meter units, floored at
 * zero. This is the common-area consumption that gets apportioned by area
 * (see `apportionByArea`).
 *
 * A negative raw result (sub-meter sum exceeds the bulk read) means the
 * meters are inconsistent — a mis-recorded reading, a missed sub-meter, or a
 * genuine DISCOM anomaly — and is never returned as-is: this function floors
 * it to 0 so a downstream apportionment never has to handle a negative
 * common-consumption figure. Detecting and flagging that anomaly (e.g. for
 * an operator to investigate) is the CALLER's responsibility, done upstream
 * of this pure function by comparing `bulkUnits` against `subMeterSumUnits`
 * directly before calling in.
 */
export function deriveCommonConsumption(bulkUnits: number, subMeterSumUnits: number): number {
  return Math.max(0, bulkUnits - subMeterSumUnits);
}

export interface AreaFlat {
  flatId: string;
  /** Null when the flat's area weight is not on file (see fallback rule below). */
  areaWeight: number | null;
}

export interface AreaShare {
  flatId: string;
  sharePaise: number;
}

/**
 * Distributes an integer-paise amount across flats proportional to
 * `areaWeight`, using the LARGEST-REMAINDER method so the residue left by
 * flooring each flat's ideal share is handed out deterministically rather
 * than leaking or being dropped on one flat arbitrarily:
 *
 *   1. Compute each flat's EFFECTIVE weight (see the null-fallback rule
 *      below), then its ideal share = amountPaise * weight / totalWeight.
 *   2. Floor every ideal share to whole paise — this is each flat's base
 *      share. The sum of the floors is <= amountPaise (never more).
 *   3. The leftover paise (amountPaise - sum of base shares) is handed out
 *      ONE PAISE AT A TIME to the flats with the largest fractional
 *      remainders (ideal share - base share), highest remainder first.
 *      Ties are broken by flatId ascending (lexicographic), which makes the
 *      output fully deterministic for a given input — no dependency on
 *      array order or floating-point iteration order.
 *
 * Fallback rule for missing area weights (documented, not incidental): a
 * flat with `areaWeight === null` is treated as carrying the MEAN of the
 * other flats' non-null weights (so a flat missing its area record still
 * gets a "typical" share rather than zero). If EVERY flat's weight is null,
 * all flats are weighted equally (split as evenly as the largest-remainder
 * method allows).
 *
 * CRITICAL INVARIANT: Σ(sharePaise) across the returned array EXACTLY
 * equals `amountPaise` for every input — including amountPaise = 0 (all
 * shares 0), a single flat (gets the whole amount), and an empty flats list
 * (empty array back). This is guaranteed by construction (floor + handing
 * out the exact leftover), not by rounding luck, and is covered by a
 * property test in apportionment.util.spec.ts.
 */
export function apportionByArea(amountPaise: number, flats: AreaFlat[]): AreaShare[] {
  if (flats.length === 0) return [];

  if (flats.length === 1) {
    return [{ flatId: flats[0].flatId, sharePaise: amountPaise }];
  }

  const nonNullWeights = flats.map((f) => f.areaWeight).filter((w): w is number => w !== null);
  const meanWeight = nonNullWeights.length > 0 ? nonNullWeights.reduce((sum, w) => sum + w, 0) / nonNullWeights.length : 1;

  const effectiveWeights = flats.map((f) => (f.areaWeight === null ? meanWeight : f.areaWeight));
  let totalWeight = effectiveWeights.reduce((sum, w) => sum + w, 0);

  // Degenerate case: every effective weight is 0 (e.g. every flat's areaWeight
  // is 0, or the mean fallback itself resolved to 0). Fall back to an equal
  // split rather than dividing by zero.
  if (totalWeight <= 0) {
    totalWeight = flats.length;
    for (let i = 0; i < effectiveWeights.length; i++) effectiveWeights[i] = 1;
  }

  const ideal = flats.map((f, i) => (amountPaise * effectiveWeights[i]) / totalWeight);
  const base = ideal.map((x) => Math.floor(x));
  const remainder = ideal.map((x, i) => x - base[i]);

  const baseSum = base.reduce((sum, x) => sum + x, 0);
  let leftover = amountPaise - baseSum;

  // Order candidates for the leftover paise by largest fractional remainder
  // first, tie-broken by flatId ascending for full determinism.
  const order = flats
    .map((f, i) => ({ index: i, flatId: f.flatId, remainder: remainder[i] }))
    .sort((a, b) => b.remainder - a.remainder || (a.flatId < b.flatId ? -1 : a.flatId > b.flatId ? 1 : 0));

  const shares = [...base];
  if (leftover > 0) {
    for (let k = 0; k < order.length && leftover > 0; k++) {
      shares[order[k].index] += 1;
      leftover -= 1;
    }
  } else if (leftover < 0) {
    // Defensive only: floating-point division can, in rare cases, make the
    // floored shares sum to slightly MORE than amountPaise. Claw the excess
    // back from the flats with the SMALLEST fractional remainders first
    // (the ones least entitled to their floored paise), walking `order`
    // from its tail, so the invariant Σ(sharePaise) === amountPaise still
    // holds exactly.
    for (let k = order.length - 1; k >= 0 && leftover < 0; k--) {
      shares[order[k].index] -= 1;
      leftover += 1;
    }
  }

  return flats.map((f, i) => ({ flatId: f.flatId, sharePaise: shares[i] }));
}
