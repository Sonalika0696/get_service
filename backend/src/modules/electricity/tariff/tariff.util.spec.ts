import { describe, expect, it } from 'vitest';
import { computeTariff } from './tariff.util.js';
import type { TariffConfig } from './tariff-config.types.js';

describe('computeTariff — single slab', () => {
  const config: TariffConfig = { slabs: [{ upTo: null, rate: 5 }], fixedCharges: {}, dutyCess: {} };

  it('bills all consumption at the single slab rate', () => {
    const result = computeTariff(config, 10);
    expect(result.energyCharge).toBe(50);
    expect(result.slabBreakdown).toEqual([{ fromUnit: 1, toUnit: 10, units: 10, rate: 5, charge: 50 }]);
    expect(result.fixedCharge).toBe(0);
    expect(result.dutyCess).toBe(0);
    expect(result.total).toBe(50);
  });
});

describe('computeTariff — multi-slab telescoping', () => {
  const config: TariffConfig = {
    slabs: [
      { upTo: 100, rate: 3 },
      { upTo: 200, rate: 5 },
      { upTo: null, rate: 7 },
    ],
    fixedCharges: {},
    dutyCess: {},
  };

  it('charges each slab only for the portion of consumption within its own band', () => {
    const result = computeTariff(config, 150);
    expect(result.slabBreakdown).toEqual([
      { fromUnit: 1, toUnit: 100, units: 100, rate: 3, charge: 300 },
      { fromUnit: 101, toUnit: 150, units: 50, rate: 5, charge: 250 },
    ]);
    expect(result.energyCharge).toBe(550);
    expect(result.total).toBe(550);
  });

  it('bills exactly up to a slab boundary with no spillover into the next slab', () => {
    const result = computeTariff(config, 100);
    expect(result.slabBreakdown).toEqual([{ fromUnit: 1, toUnit: 100, units: 100, rate: 3, charge: 300 }]);
    expect(result.energyCharge).toBe(300);
  });

  it('bills one unit past a boundary starting the next slab at exactly that unit', () => {
    const result = computeTariff(config, 101);
    expect(result.slabBreakdown).toEqual([
      { fromUnit: 1, toUnit: 100, units: 100, rate: 3, charge: 300 },
      { fromUnit: 101, toUnit: 101, units: 1, rate: 5, charge: 5 },
    ]);
    expect(result.energyCharge).toBe(305);
  });

  it('reaches and bills the open final slab once consumption exceeds every bounded slab', () => {
    const result = computeTariff(config, 500);
    expect(result.slabBreakdown).toEqual([
      { fromUnit: 1, toUnit: 100, units: 100, rate: 3, charge: 300 },
      { fromUnit: 101, toUnit: 200, units: 100, rate: 5, charge: 500 },
      { fromUnit: 201, toUnit: 500, units: 300, rate: 7, charge: 2100 },
    ]);
    expect(result.energyCharge).toBe(2900);
    expect(result.total).toBe(2900);
  });

  it('zero consumption bills no slab at all', () => {
    const result = computeTariff(config, 0);
    expect(result.slabBreakdown).toEqual([]);
    expect(result.energyCharge).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe('computeTariff — fixed charges', () => {
  it('applies fixed charges even at zero consumption', () => {
    const config: TariffConfig = {
      slabs: [{ upTo: null, rate: 5 }],
      fixedCharges: { perConnection: 100, perSanctionedLoadKw: 25 },
      dutyCess: {},
    };
    const result = computeTariff(config, 0);
    expect(result.energyCharge).toBe(0);
    expect(result.fixedCharge).toBe(125);
    expect(result.total).toBe(125);
  });

  it('adds fixed charges on top of energy charge', () => {
    const config: TariffConfig = {
      slabs: [{ upTo: null, rate: 10 }],
      fixedCharges: { perConnection: 50 },
      dutyCess: {},
    };
    const result = computeTariff(config, 20);
    expect(result.energyCharge).toBe(200);
    expect(result.fixedCharge).toBe(50);
    expect(result.total).toBe(250);
  });

  it('treats an empty fixedCharges object as contributing 0', () => {
    const config: TariffConfig = { slabs: [{ upTo: null, rate: 10 }], fixedCharges: {}, dutyCess: {} };
    expect(computeTariff(config, 20).fixedCharge).toBe(0);
  });
});

describe('computeTariff — duty and cess', () => {
  it('computes electricity duty as a percentage of the energy charge', () => {
    const config: TariffConfig = { slabs: [{ upTo: null, rate: 10 }], fixedCharges: {}, dutyCess: { energyDutyPct: 5 } };
    const result = computeTariff(config, 100);
    expect(result.energyCharge).toBe(1000);
    expect(result.dutyCess).toBe(50); // 5% of 1000
    expect(result.total).toBe(1050);
  });

  it('adds a flat fixedCess independent of the energy charge', () => {
    const config: TariffConfig = { slabs: [{ upTo: null, rate: 1 }], fixedCharges: {}, dutyCess: { fixedCess: 15 } };
    const result = computeTariff(config, 0);
    expect(result.energyCharge).toBe(0);
    expect(result.dutyCess).toBe(15);
    expect(result.total).toBe(15);
  });

  it('combines energyDutyPct and fixedCess together', () => {
    const config: TariffConfig = { slabs: [{ upTo: null, rate: 10 }], fixedCharges: {}, dutyCess: { energyDutyPct: 5, fixedCess: 15 } };
    const result = computeTariff(config, 100);
    expect(result.dutyCess).toBe(65); // 50 + 15
    expect(result.total).toBe(1065); // 1000 + 0 + 65
  });

  it('rounds a half-paise duty amount up (round-half-up, matching the file-documented rule)', () => {
    // energyCharge = 1.01 (energyChargePaise = 101); 50% of 101 paise = 50.5 -> rounds up to 51 paise = 0.51.
    const config: TariffConfig = { slabs: [{ upTo: null, rate: 1.01 }], fixedCharges: {}, dutyCess: { energyDutyPct: 50 } };
    const result = computeTariff(config, 1);
    expect(result.energyCharge).toBe(1.01);
    expect(result.dutyCess).toBe(0.51);
    expect(result.total).toBe(1.52);
  });
});

describe('computeTariff — paise-exact total invariant', () => {
  const cases: { config: TariffConfig; units: number }[] = [
    {
      config: { slabs: [{ upTo: 50, rate: 2.75 }, { upTo: null, rate: 4.1 }], fixedCharges: { perConnection: 33.5, perSanctionedLoadKw: 12.25 }, dutyCess: { energyDutyPct: 7.5, fixedCess: 9.99 } },
      units: 137,
    },
    {
      config: { slabs: [{ upTo: null, rate: 6.6 }], fixedCharges: { perConnection: 0.5 }, dutyCess: { energyDutyPct: 12 } },
      units: 33,
    },
    {
      config: { slabs: [{ upTo: 10, rate: 1 }, { upTo: 20, rate: 2 }, { upTo: null, rate: 3 }], fixedCharges: {}, dutyCess: {} },
      units: 0,
    },
  ];

  it.each(cases)('total exactly equals energyCharge + fixedCharge + dutyCess (paise-exact)', ({ config, units }) => {
    const result = computeTariff(config, units);
    expect(result.total).toBeCloseTo(result.energyCharge + result.fixedCharge + result.dutyCess, 9);
    // Also assert both sides, scaled to paise and rounded, are the exact same integer — the real paise-exactness check.
    expect(Math.round(result.total * 100)).toBe(Math.round(result.energyCharge * 100) + Math.round(result.fixedCharge * 100) + Math.round(result.dutyCess * 100));
  });
});

describe('computeTariff — negative/invalid input', () => {
  const config: TariffConfig = { slabs: [{ upTo: null, rate: 5 }], fixedCharges: { perConnection: 10 }, dutyCess: {} };

  it('clamps negative consumption to zero (still applies fixed charges)', () => {
    const result = computeTariff(config, -20);
    expect(result.energyCharge).toBe(0);
    expect(result.slabBreakdown).toEqual([]);
    expect(result.fixedCharge).toBe(10);
    expect(result.total).toBe(10);
  });

  it('throws for a non-finite consumptionUnits', () => {
    expect(() => computeTariff(config, Number.NaN)).toThrow();
    expect(() => computeTariff(config, Number.POSITIVE_INFINITY)).toThrow();
  });
});
