/**
 * Pure electricity-tariff computation, independent of Prisma/Nest —
 * unit-tested directly (see tariff.util.spec.ts). Phase 10 (electricity &
 * water billing, schema freeze) stores a society/connection's tariff as a
 * TariffSchedule row; `parseTariffConfig` (./tariff-config.parser.ts) turns
 * its raw JSONB into a trusted TariffConfig, and `computeTariff` below
 * turns a TariffConfig + a billing cycle's `consumptionUnits` into an
 * itemised TariffBreakdown (./tariff-config.types.ts) ready for the caller
 * to persist / render.
 *
 * MONEY DETERMINISM: every money computation here is done in INTEGER PAISE
 * (₹1 = 100 paise), never in floating-point rupees directly. Rupee inputs
 * (rates, flat charges, percentages) are converted to paise with
 * `toPaise` (round-half-up via Math.round, since every amount in this
 * domain is non-negative — Math.round rounds .5 away from zero for
 * positives, i.e. "round half up"), all intermediate arithmetic is done on
 * those integers, and only the final itemised fields are converted back to
 * rupees with `fromPaise`. This guarantees `total` is EXACTLY the sum of
 * `energyCharge + fixedCharge + dutyCess` to the paise, and that repeated
 * calls with the same input always produce bit-identical output — plain
 * floating-point rupee arithmetic (e.g. summing 0.1 + 0.2 style values
 * across many slabs) cannot make that guarantee.
 */

import type { SlabCharge, TariffBreakdown, TariffConfig } from './tariff-config.types.js';

/** ₹1 = 100 paise. */
const PAISE_PER_RUPEE = 100;

/** Converts a ₹ amount to integer paise, rounding half-up (see file header). */
function toPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Converts integer paise back to a ₹ amount (always exactly 2 decimal places' worth of value). */
function fromPaise(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Walks `slabs` against `consumptionUnits`, telescoping the charge: each
 * slab is billed only for the portion of consumption that falls within its
 * own band (from the previous slab's `upTo`, exclusive, to this slab's
 * `upTo`, inclusive — or unbounded for the final `upTo: null` slab). A slab
 * whose band lies entirely above `consumptionUnits` (i.e. consumption never
 * reaches it) contributes 0 units and is OMITTED from `slabBreakdown`
 * entirely, so the returned array only ever lists slabs that were actually
 * charged.
 *
 * Returns the itemised per-slab charges (each already paise-rounded) and
 * their sum in integer paise.
 */
function computeSlabCharges(slabs: TariffConfig['slabs'], consumptionUnits: number): { slabBreakdown: SlabCharge[]; energyChargePaise: number } {
  const slabBreakdown: SlabCharge[] = [];
  let energyChargePaise = 0;
  let previousUpTo = 0;

  for (const slab of slabs) {
    const bandCeiling = slab.upTo === null ? Infinity : slab.upTo;
    const unitsInSlab = Math.max(0, Math.min(consumptionUnits, bandCeiling) - previousUpTo);

    if (unitsInSlab > 0) {
      const chargePaise = toPaise(unitsInSlab * slab.rate);
      slabBreakdown.push({
        fromUnit: previousUpTo + 1,
        toUnit: previousUpTo + unitsInSlab,
        units: unitsInSlab,
        rate: slab.rate,
        charge: fromPaise(chargePaise),
      });
      energyChargePaise += chargePaise;
    }

    previousUpTo = bandCeiling;
    if (consumptionUnits <= bandCeiling) break; // nothing left to attribute to later slabs
  }

  return { slabBreakdown, energyChargePaise };
}

/**
 * Computes the full itemised tariff for `consumptionUnits` (kWh) under
 * `config`. `config` is assumed already validated (via parseTariffConfig) —
 * this function does no defensive re-validation of the config shape, only
 * of `consumptionUnits` itself.
 *
 * Behaviour at the edges:
 *  - `consumptionUnits <= 0`: no slab is charged (energyCharge 0, empty
 *    slabBreakdown), but fixedCharges and any `dutyCess.fixedCess` still
 *    apply — a connection is billed its fixed components even with zero
 *    consumption. (`energyDutyPct` naturally contributes 0 since it is a
 *    percentage of a 0 energyCharge.)
 *  - Exact slab-boundary consumption (`consumptionUnits === someSlab.upTo`):
 *    that slab is fully billed and no unit spills into the next slab
 *    (`Math.min(consumptionUnits, bandCeiling) - previousUpTo` is exact).
 *  - An open final slab (`upTo: null`): billed for every unit above the
 *    previous slab's `upTo`, uncapped.
 *
 * Throws if `consumptionUnits` is not a finite number.
 */
export function computeTariff(config: TariffConfig, consumptionUnits: number): TariffBreakdown {
  if (typeof consumptionUnits !== 'number' || !Number.isFinite(consumptionUnits)) {
    throw new Error('consumptionUnits must be a finite number');
  }
  const effectiveUnits = Math.max(0, consumptionUnits);

  const { slabBreakdown, energyChargePaise } = computeSlabCharges(config.slabs, effectiveUnits);

  const fixedChargePaise = toPaise(config.fixedCharges.perConnection ?? 0) + toPaise(config.fixedCharges.perSanctionedLoadKw ?? 0);

  const energyDutyPaise = Math.round((energyChargePaise * (config.dutyCess.energyDutyPct ?? 0)) / 100);
  const fixedCessPaise = toPaise(config.dutyCess.fixedCess ?? 0);
  const dutyCessPaise = energyDutyPaise + fixedCessPaise;

  const totalPaise = energyChargePaise + fixedChargePaise + dutyCessPaise;

  return {
    consumptionUnits,
    energyCharge: fromPaise(energyChargePaise),
    slabBreakdown,
    fixedCharge: fromPaise(fixedChargePaise),
    dutyCess: fromPaise(dutyCessPaise),
    total: fromPaise(totalPaise),
  };
}
