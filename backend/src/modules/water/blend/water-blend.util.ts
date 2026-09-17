/**
 * Pure water-blend math, independent of Prisma/Nest — unit-tested directly
 * (see water-blend.util.spec.ts). Phase 10 (electricity & water billing)
 * needs a blended per-kilolitre water rate when a society draws water from
 * more than one source in a billing period (e.g. municipal supply + tanker
 * top-ups + borewell), each with its own volume and its own cost. The
 * blended rate is the single ₹/kl figure used to bill flats by their own
 * consumption, so every flat pays the same rate regardless of which literal
 * tanker filled the sump that week.
 *
 * Money stays in INTEGER PAISE throughout (1 rupee = 100 paise) — the
 * ₹↔paise conversion is the caller's job, same convention as the
 * electricity apportionment module (see
 * ../../electricity/apportionment/apportionment.util.ts).
 */

export interface WaterSource {
  /** Free-form source label, e.g. "municipal", "tanker", "borewell". Not validated here — the caller owns the enum. */
  kind: string;
  kilolitres: number;
  /** Cost of this source's supply for the period, in integer paise. */
  cost: number;
}

export interface WaterSourceDerivation {
  kind: string;
  kilolitres: number;
  costPaise: number;
  /** This source's share of the TOTAL cost, as a percentage (0-100). See rounding note on `sharePct` below. */
  sharePct: number;
}

export interface BlendedRate {
  totalKilolitres: number;
  totalCostPaise: number;
  /** Blended rate in PAISE per kilolitre, rounded to the nearest whole paise (round-half-up). */
  ratePaisePerKl: number;
  derivation: WaterSourceDerivation[];
}

/**
 * Blended rate = Σcost / Σkilolitres, rounded to the nearest whole paise
 * using round-half-up (`Math.round`) — a billing rate is quoted to the
 * paise, and round-half-up is the conventional, unsurprising choice for a
 * customer-facing unit price (as opposed to, say, floor/largest-remainder,
 * which this module's sibling `apportionByArea` uses for exact paise
 * conservation across many recipients — a single blended RATE has no
 * "recipients" to conserve paise across, so that concern doesn't apply
 * here).
 *
 * Guards Σkilolitres === 0 (no water drawn from any source, or every
 * source's kilolitres is 0/negative summing to 0): returns rate 0 with
 * totalCostPaise still summed (any cost billed on zero volume is a data
 * anomaly for the caller to flag, not something this pure function
 * resolves) and an EMPTY derivation array, rather than dividing by zero or
 * fabricating a per-source percentage that has no meaningful denominator.
 *
 * `derivation` gives each source's share of the TOTAL COST (not volume) as
 * a percentage; by construction Σ(sharePct) === 100 to within ordinary
 * floating-point display precision (see the spec's derivation-sums-to-100%
 * check) whenever totalCostPaise > 0. When totalCostPaise === 0 (every
 * source free, e.g. entirely gravity-fed/borewell with zero cost) but
 * kilolitres > 0, every source's sharePct is 0 (there is no cost to share).
 */
export function blendedRatePerKl(sources: WaterSource[]): BlendedRate {
  const totalKilolitres = sources.reduce((sum, s) => sum + s.kilolitres, 0);
  const totalCostPaise = sources.reduce((sum, s) => sum + s.cost, 0);

  if (totalKilolitres === 0) {
    return {
      totalKilolitres: 0,
      totalCostPaise,
      ratePaisePerKl: 0,
      derivation: [],
    };
  }

  const ratePaisePerKl = Math.round(totalCostPaise / totalKilolitres);

  const derivation: WaterSourceDerivation[] = sources.map((s) => ({
    kind: s.kind,
    kilolitres: s.kilolitres,
    costPaise: s.cost,
    sharePct: totalCostPaise === 0 ? 0 : (s.cost / totalCostPaise) * 100,
  }));

  return { totalKilolitres, totalCostPaise, ratePaisePerKl, derivation };
}
