import { describe, expect, it } from 'vitest';
import { apportionByArea, deriveCommonConsumption, type AreaFlat } from './apportionment.util.js';

describe('deriveCommonConsumption', () => {
  it('returns bulk minus the sum of sub-meters when non-negative', () => {
    expect(deriveCommonConsumption(1000, 800)).toBe(200);
    expect(deriveCommonConsumption(500, 500)).toBe(0);
  });

  it('floors a negative raw result at 0 rather than returning a negative number', () => {
    expect(deriveCommonConsumption(500, 600)).toBe(0);
  });

  it('handles zero bulk and zero sub-meters', () => {
    expect(deriveCommonConsumption(0, 0)).toBe(0);
  });
});

function sumShares(shares: { sharePaise: number }[]): number {
  return shares.reduce((sum, s) => sum + s.sharePaise, 0);
}

describe('apportionByArea', () => {
  it('splits an exactly-even amount across equal area weights with no residue', () => {
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 100 },
      { flatId: 'B', areaWeight: 100 },
      { flatId: 'C', areaWeight: 100 },
      { flatId: 'D', areaWeight: 100 },
    ];
    const shares = apportionByArea(400, flats);
    expect(shares).toEqual([
      { flatId: 'A', sharePaise: 100 },
      { flatId: 'B', sharePaise: 100 },
      { flatId: 'C', sharePaise: 100 },
      { flatId: 'D', sharePaise: 100 },
    ]);
    expect(sumShares(shares)).toBe(400);
  });

  it('hands out a residue from uneven area weights deterministically by largest remainder', () => {
    // 100 paise split 1:1:1 -> ideal 33.33 each, base 33 each, 1 paise left
    // over. Remainders are tied (all 0.333...), so the tie-break (flatId
    // ascending) decides: 'A' gets the extra paise.
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 1 },
      { flatId: 'B', areaWeight: 1 },
      { flatId: 'C', areaWeight: 1 },
    ];
    const shares = apportionByArea(100, flats);
    expect(sumShares(shares)).toBe(100);
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(34);
    expect(shares.find((s) => s.flatId === 'B')!.sharePaise).toBe(33);
    expect(shares.find((s) => s.flatId === 'C')!.sharePaise).toBe(33);
  });

  it('gives more residue paise to flats with larger area weight when remainders differ', () => {
    // weights 3:2:1 (total 6) of 100 paise -> ideal 50, 33.33, 16.67 ->
    // base 50, 33, 16 (sum 99), 1 leftover paise. Remainders: 0, 0.333, 0.667
    // -> the 1:6 flat (largest remainder) gets it.
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 3 },
      { flatId: 'B', areaWeight: 2 },
      { flatId: 'C', areaWeight: 1 },
    ];
    const shares = apportionByArea(100, flats);
    expect(sumShares(shares)).toBe(100);
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(50);
    expect(shares.find((s) => s.flatId === 'B')!.sharePaise).toBe(33);
    expect(shares.find((s) => s.flatId === 'C')!.sharePaise).toBe(17);
  });

  it('splits equally when every flat has a null area weight', () => {
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: null },
      { flatId: 'B', areaWeight: null },
    ];
    const shares = apportionByArea(101, flats);
    expect(sumShares(shares)).toBe(101);
    // Equal effective weights -> ideal 50.5 each -> base 50 each, 1 leftover
    // -> tie-break gives it to 'A'.
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(51);
    expect(shares.find((s) => s.flatId === 'B')!.sharePaise).toBe(50);
  });

  it('gives a null-weight flat the mean of the known weights when some (not all) are null', () => {
    // Known weights: 10 and 30 -> mean 20 for the null flat. Effective
    // weights: 10, 30, 20 (total 60) of 600 paise -> ideal 100, 300, 200
    // exactly, no residue.
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 10 },
      { flatId: 'B', areaWeight: 30 },
      { flatId: 'C', areaWeight: null },
    ];
    const shares = apportionByArea(600, flats);
    expect(sumShares(shares)).toBe(600);
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(100);
    expect(shares.find((s) => s.flatId === 'B')!.sharePaise).toBe(300);
    expect(shares.find((s) => s.flatId === 'C')!.sharePaise).toBe(200);
  });

  it('gives the whole amount to a single flat', () => {
    const shares = apportionByArea(12345, [{ flatId: 'ONLY', areaWeight: 42 }]);
    expect(shares).toEqual([{ flatId: 'ONLY', sharePaise: 12345 }]);
  });

  it('returns an empty array for no flats', () => {
    expect(apportionByArea(1000, [])).toEqual([]);
  });

  it('splits zero amount into zero shares for every flat', () => {
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 10 },
      { flatId: 'B', areaWeight: 20 },
    ];
    const shares = apportionByArea(0, flats);
    expect(shares).toEqual([
      { flatId: 'A', sharePaise: 0 },
      { flatId: 'B', sharePaise: 0 },
    ]);
  });

  it('falls back to an equal split when every effective weight is zero', () => {
    const flats: AreaFlat[] = [
      { flatId: 'A', areaWeight: 0 },
      { flatId: 'B', areaWeight: 0 },
    ];
    const shares = apportionByArea(10, flats);
    expect(sumShares(shares)).toBe(10);
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(5);
    expect(shares.find((s) => s.flatId === 'B')!.sharePaise).toBe(5);
  });

  it('breaks ties by flatId ascending regardless of input array order', () => {
    const flats: AreaFlat[] = [
      { flatId: 'Z', areaWeight: 1 },
      { flatId: 'A', areaWeight: 1 },
      { flatId: 'M', areaWeight: 1 },
    ];
    const shares = apportionByArea(100, flats);
    expect(sumShares(shares)).toBe(100);
    // All remainders tied -> 'A' (lexicographically smallest) gets the extra paise.
    expect(shares.find((s) => s.flatId === 'A')!.sharePaise).toBe(34);
    expect(shares.find((s) => s.flatId === 'M')!.sharePaise).toBe(33);
    expect(shares.find((s) => s.flatId === 'Z')!.sharePaise).toBe(33);
  });

  describe('property: residue conservation and determinism', () => {
    // A spread of amounts and weightings (including irrational-looking
    // decimal weights that stress floating-point division) — for every
    // combination, Σ(sharePaise) must equal amountPaise exactly, and running
    // the same input twice must yield byte-identical output.
    const amounts = [0, 1, 7, 100, 101, 999, 12345, 1_000_000, 7, 3];
    const weightings: (number | null)[][] = [
      [1, 1, 1],
      [1, 2, 3],
      [10, 20, 30, 40],
      [2.5, 1.3, 4.7, 0.9],
      [null, 5, null, 10, 3],
      [null, null, null],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [0, 5, 10],
      [33.33, 33.33, 33.34],
    ];

    for (const amountPaise of amounts) {
      for (const weights of weightings) {
        it(`conserves and is deterministic for amount=${amountPaise}, weights=${JSON.stringify(weights)}`, () => {
          const flats: AreaFlat[] = weights.map((w, i) => ({ flatId: `F${String(i).padStart(2, '0')}`, areaWeight: w }));

          const run1 = apportionByArea(amountPaise, flats);
          const run2 = apportionByArea(amountPaise, flats);

          expect(sumShares(run1)).toBe(amountPaise);
          expect(run1).toEqual(run2);
          for (const share of run1) {
            expect(Number.isInteger(share.sharePaise)).toBe(true);
            expect(share.sharePaise).toBeGreaterThanOrEqual(0);
          }
        });
      }
    }
  });
});
