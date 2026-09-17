import { describe, expect, it } from 'vitest';
import { blendedRatePerKl, type WaterSource } from './water-blend.util.js';

describe('blendedRatePerKl', () => {
  it('returns the source rate unchanged for a single source', () => {
    const sources: WaterSource[] = [{ kind: 'municipal', kilolitres: 100, cost: 5000 }];
    const result = blendedRatePerKl(sources);
    expect(result.totalKilolitres).toBe(100);
    expect(result.totalCostPaise).toBe(5000);
    expect(result.ratePaisePerKl).toBe(50); // 5000 / 100
    expect(result.derivation).toEqual([{ kind: 'municipal', kilolitres: 100, costPaise: 5000, sharePct: 100 }]);
  });

  it('computes the volume-and-cost-weighted blended rate across multiple sources', () => {
    // municipal: 80kl @ 4000p, tanker: 20kl @ 3000p -> total 100kl, 7000p
    // -> blended rate = 7000/100 = 70p/kl (not a simple average of the two
    // per-source rates, which would be (50+150)/2 = 100).
    const sources: WaterSource[] = [
      { kind: 'municipal', kilolitres: 80, cost: 4000 },
      { kind: 'tanker', kilolitres: 20, cost: 3000 },
    ];
    const result = blendedRatePerKl(sources);
    expect(result.totalKilolitres).toBe(100);
    expect(result.totalCostPaise).toBe(7000);
    expect(result.ratePaisePerKl).toBe(70);
  });

  it('rounds the blended rate to the nearest whole paise (round-half-up)', () => {
    // 100 / 3 = 33.333... -> rounds down to 33
    expect(blendedRatePerKl([{ kind: 'borewell', kilolitres: 3, cost: 100 }]).ratePaisePerKl).toBe(33);
    // 100 / 8 = 12.5 -> rounds up (round-half-up) to 13
    expect(blendedRatePerKl([{ kind: 'borewell', kilolitres: 8, cost: 100 }]).ratePaisePerKl).toBe(13);
  });

  it('guards Σkilolitres === 0: returns rate 0 and an empty derivation, but still sums cost', () => {
    const sources: WaterSource[] = [
      { kind: 'municipal', kilolitres: 0, cost: 500 },
      { kind: 'tanker', kilolitres: 0, cost: 0 },
    ];
    const result = blendedRatePerKl(sources);
    expect(result.totalKilolitres).toBe(0);
    expect(result.totalCostPaise).toBe(500);
    expect(result.ratePaisePerKl).toBe(0);
    expect(result.derivation).toEqual([]);
  });

  it('guards Σkilolitres === 0 for an empty sources list', () => {
    const result = blendedRatePerKl([]);
    expect(result).toEqual({ totalKilolitres: 0, totalCostPaise: 0, ratePaisePerKl: 0, derivation: [] });
  });

  it('gives every source sharePct 0 when total cost is 0 but volume is positive', () => {
    const sources: WaterSource[] = [
      { kind: 'borewell', kilolitres: 50, cost: 0 },
      { kind: 'rainwater', kilolitres: 50, cost: 0 },
    ];
    const result = blendedRatePerKl(sources);
    expect(result.ratePaisePerKl).toBe(0);
    expect(result.derivation.map((d) => d.sharePct)).toEqual([0, 0]);
  });

  it('derivation sums to 100% of the total cost across sources', () => {
    const sources: WaterSource[] = [
      { kind: 'municipal', kilolitres: 50, cost: 2500 },
      { kind: 'tanker', kilolitres: 30, cost: 4500 },
      { kind: 'borewell', kilolitres: 20, cost: 1000 },
    ];
    const result = blendedRatePerKl(sources);
    const sumSharePct = result.derivation.reduce((sum, d) => sum + d.sharePct, 0);
    expect(sumSharePct).toBeCloseTo(100, 9);
    // Each source's own share matches cost/totalCost.
    expect(result.derivation[0].sharePct).toBeCloseTo((2500 / 8000) * 100, 9);
    expect(result.derivation[1].sharePct).toBeCloseTo((4500 / 8000) * 100, 9);
    expect(result.derivation[2].sharePct).toBeCloseTo((1000 / 8000) * 100, 9);
  });

  it('preserves per-source kind, kilolitres, and costPaise in derivation', () => {
    const sources: WaterSource[] = [{ kind: 'tanker', kilolitres: 15, cost: 900 }];
    const result = blendedRatePerKl(sources);
    expect(result.derivation[0]).toMatchObject({ kind: 'tanker', kilolitres: 15, costPaise: 900 });
  });
});
