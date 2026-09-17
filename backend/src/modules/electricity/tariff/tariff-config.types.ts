/**
 * Types for the electricity TariffSchedule's JSONB shape — Phase 10
 * (electricity & water billing, schema freeze). A TariffSchedule row stores
 * `slabs` / `fixedCharges` / `dutyCess` as raw Json columns; these types are
 * the parsed, trusted shape that `parseTariffConfig`
 * (./tariff-config.parser.ts) produces and `computeTariff`
 * (./tariff.util.ts) consumes. Nothing here touches Prisma or NestJS — this
 * whole `tariff/` directory is a pure compute engine, unit-tested directly
 * with no DB.
 *
 * Tariff model, mirrored from how Indian electricity DISCOMs typically
 * publish a domestic/commercial tariff order:
 *  - Energy charge: a telescoping (slab/block) rate applied to consumption
 *    in units (kWh) — each slab is billed only for the portion of
 *    consumption that falls within its own band, not the whole amount at
 *    that slab's rate (see computeTariff's slab-walking loop).
 *  - Fixed charges: flat components billed regardless of consumption
 *    (typically a per-connection charge and/or a charge per kW of
 *    sanctioned/contracted load).
 *  - Duty/cess: government levies computed on top of the energy charge —
 *    electricity duty as a percentage of the energy charge, plus a flat
 *    cess amount.
 */

/**
 * One band of a telescoping tariff. `upTo` is the INCLUSIVE upper bound of
 * CUMULATIVE consumption (in units) this slab covers — e.g. `{ upTo: 100,
 * rate: 3.5 }` following a slab with `upTo: 50` means "units 51 through 100
 * are billed at ₹3.50/unit". `upTo: null` marks the final, open-ended slab
 * (every unit above the previous slab's `upTo`, with no ceiling) — at most
 * one slab in a TariffConfig may have `upTo: null`, and if present it must
 * be the LAST slab in the array (see parseTariffConfig for the enforced
 * ordering/ascending invariants).
 */
export interface Slab {
  /** Inclusive cumulative-consumption ceiling for this slab, in units (kWh); null = open-ended final slab. */
  upTo: number | null;
  /** ₹ per unit charged for consumption falling within this slab's band. */
  rate: number;
}

/**
 * Flat (consumption-independent) charges. Both fields are optional on the
 * raw JSONB — `parseTariffConfig` documents-defaults any missing field to 0
 * (see that file), so a TariffConfig produced by the parser always has both
 * keys present with a numeric (possibly 0) value.
 */
export interface FixedCharges {
  /** ₹ flat charge per billing cycle, independent of load or consumption. */
  perConnection?: number;
  /** ₹ flat charge per kW of the connection's sanctioned/contracted load. */
  perSanctionedLoadKw?: number;
}

/**
 * Government levies layered on top of the energy charge. Both fields are
 * optional on the raw JSONB and default to 0 — see FixedCharges.
 */
export interface DutyCess {
  /** Electricity duty, as a percentage (e.g. 5 = 5%) of the energy charge (before fixed charges/cess are added). */
  energyDutyPct?: number;
  /** ₹ flat cess added on top, independent of consumption or energy charge. */
  fixedCess?: number;
}

/**
 * The fully parsed, trusted tariff configuration `computeTariff` operates
 * on. Always produced via `parseTariffConfig` from a TariffSchedule row's
 * raw `slabs` / `fixedCharges` / `dutyCess` JSONB columns — never
 * constructed by hand from untrusted input, so `computeTariff` itself does
 * no further validation.
 */
export interface TariffConfig {
  /** Ascending, non-overlapping telescoping slabs; see parseTariffConfig for the enforced invariants. */
  slabs: Slab[];
  fixedCharges: FixedCharges;
  dutyCess: DutyCess;
}

/**
 * The itemised result of `computeTariff`. Every money field (`energyCharge`,
 * each slab's `charge`, `fixedCharge`, `dutyCess`, `total`) is rounded to 2
 * decimal places (paise) and `total` is EXACTLY the sum of `energyCharge +
 * fixedCharge + dutyCess` to the paise — see tariff.util.ts's
 * integer-paise arithmetic for how that determinism is guaranteed.
 */
export interface TariffBreakdown {
  /** Total consumption this breakdown was computed for, in units (kWh). */
  consumptionUnits: number;
  /** Sum of every slab's `charge` — the energy-only component, before fixed charges and duty/cess. */
  energyCharge: number;
  /** Per-slab itemisation of how `energyCharge` was built up. */
  slabBreakdown: SlabCharge[];
  /** Sum of fixedCharges.perConnection + fixedCharges.perSanctionedLoadKw (the latter still flat here — see computeTariff's documented interpretation). */
  fixedCharge: number;
  /** dutyCess.energyDutyPct% of energyCharge, plus dutyCess.fixedCess. */
  dutyCess: number;
  /** energyCharge + fixedCharge + dutyCess, exactly (paise-for-paise). */
  total: number;
}

/** One slab's contribution to the energy charge, for itemised display/audit. */
export interface SlabCharge {
  /** First unit (1-indexed, inclusive) this slab was charged for. */
  fromUnit: number;
  /** Last unit (1-indexed, inclusive) this slab was charged for. */
  toUnit: number;
  /** Number of units billed within this slab's band (toUnit - fromUnit + 1). */
  units: number;
  /** ₹ per unit for this slab. */
  rate: number;
  /** units * rate, rounded to paise. */
  charge: number;
}
