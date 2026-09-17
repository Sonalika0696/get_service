import { describe, expect, it } from 'vitest';
import { deriveConsumption, detectAnomalies } from './reading-validation.util.js';

describe('deriveConsumption', () => {
  it('computes (curr - prev) * multiplier for a normal forward reading', () => {
    expect(deriveConsumption(100, 150, 1)).toBe(50);
    expect(deriveConsumption(100, 150, 2)).toBe(100);
  });

  it('returns 0 for no movement', () => {
    expect(deriveConsumption(100, 100, 1)).toBe(0);
  });

  it('computes a wrapped rollover consumption when meterMaxValue is given and curr < prev', () => {
    // dial maxes at 999, prev=980, wraps to curr=20 -> (999-980)+20 = 39
    expect(deriveConsumption(980, 20, 1, 999)).toBe(39);
    expect(deriveConsumption(980, 20, 2, 999)).toBe(78);
  });

  it('clamps a negative result to 0 when curr < prev and no meterMaxValue is given', () => {
    expect(deriveConsumption(100, 60, 1)).toBe(0);
  });

  it('clamps to 0 even with a multiplier applied to a negative raw delta', () => {
    expect(deriveConsumption(100, 60, 3)).toBe(0);
  });
});

describe('detectAnomalies', () => {
  it('flags nothing for a normal, in-line-with-history reading', () => {
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 150,
      multiplier: 1,
      historicalConsumptions: [45, 50, 55, 48],
    });
    expect(flags).toEqual([]);
  });

  it('flags nothing for a normal reading with no history at all', () => {
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 150,
      multiplier: 1,
      historicalConsumptions: [],
    });
    expect(flags).toEqual([]);
  });

  it('flags NEGATIVE_CONSUMPTION when curr < prev and no meterMaxValue is given', () => {
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 60,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
    });
    expect(flags).toEqual(['NEGATIVE_CONSUMPTION']);
  });

  it('flags NEGATIVE_CONSUMPTION (and OUT_OF_BOUNDS) when meterMaxValue is given but the wrapped reading is implausible vs history', () => {
    // wraps to (999-100)+60 = 959, wildly above the ~40 historical mean -> not a plausible
    // rollover (so NEGATIVE_CONSUMPTION), and that same 959 is independently a huge spike
    // relative to history -> also OUT_OF_BOUNDS.
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 60,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
      meterMaxValue: 999,
    });
    expect(flags).toEqual(['NEGATIVE_CONSUMPTION', 'OUT_OF_BOUNDS']);
  });

  it('flags ROLLOVER when curr < prev and meterMaxValue makes the wrapped reading plausible', () => {
    // wraps to (999-980)+20 = 39, close to the ~40 historical mean -> plausible rollover
    const flags = detectAnomalies({
      prevValue: 980,
      currValue: 20,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
      meterMaxValue: 999,
    });
    expect(flags).toEqual(['ROLLOVER']);
  });

  it('accepts a plausible rollover with empty history (nothing to compare against yet)', () => {
    const flags = detectAnomalies({
      prevValue: 980,
      currValue: 20,
      multiplier: 1,
      historicalConsumptions: [],
      meterMaxValue: 999,
    });
    expect(flags).toEqual(['ROLLOVER']);
  });

  it('flags STALLED when consumption is 0 but history shows typical nonzero usage', () => {
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 100,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
    });
    expect(flags).toEqual(['STALLED']);
  });

  it('does not flag STALLED when consumption is 0 and history is also all-zero/empty', () => {
    const flagsEmptyHistory = detectAnomalies({
      prevValue: 100,
      currValue: 100,
      multiplier: 1,
      historicalConsumptions: [],
    });
    expect(flagsEmptyHistory).toEqual([]);

    const flagsZeroHistory = detectAnomalies({
      prevValue: 100,
      currValue: 100,
      multiplier: 1,
      historicalConsumptions: [0, 0, 0],
    });
    expect(flagsZeroHistory).toEqual([]);
  });

  it('flags OUT_OF_BOUNDS when consumption exceeds the default 3x trailing mean', () => {
    // mean of history = 40, consumption = 200 -> 200 > 3*40=120
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 300,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
    });
    expect(flags).toEqual(['OUT_OF_BOUNDS']);
  });

  it('does not flag OUT_OF_BOUNDS when consumption is within the default 3x trailing mean', () => {
    // mean of history = 40, consumption = 100 -> 100 < 3*40=120
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 200,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
    });
    expect(flags).toEqual([]);
  });

  it('respects a custom outOfBoundsFactor', () => {
    // mean of history = 40, consumption = 100 -> 100 > 2*40=80 with a tighter factor
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 200,
      multiplier: 1,
      historicalConsumptions: [40, 42, 38],
      outOfBoundsFactor: 2,
    });
    expect(flags).toEqual(['OUT_OF_BOUNDS']);
  });

  it('does not flag OUT_OF_BOUNDS when historicalConsumptions is empty (no baseline)', () => {
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 100000,
      multiplier: 1,
      historicalConsumptions: [],
    });
    expect(flags).toEqual([]);
  });

  it('can raise multiple flags at once (an implausible wrapped reading is both NEGATIVE_CONSUMPTION and OUT_OF_BOUNDS)', () => {
    // wrapped = (999-980)+900 = 919 against a mean history of 1 -> fails the rollover
    // plausibility check (919 > 3*1), so it's a genuine NEGATIVE_CONSUMPTION; the same
    // 919 consumption is also, independently, a huge spike vs. that history -> OUT_OF_BOUNDS.
    const flags = detectAnomalies({
      prevValue: 980,
      currValue: 900,
      multiplier: 1,
      historicalConsumptions: [1, 1, 1],
      meterMaxValue: 999,
      outOfBoundsFactor: 3,
    });
    expect(flags).toEqual(['NEGATIVE_CONSUMPTION', 'OUT_OF_BOUNDS']);
  });

  it('applies multiplier consistently when judging STALLED and OUT_OF_BOUNDS against raw-unit history', () => {
    // multiplier=2, curr-prev=50*2=100 consumption, mean history 40 -> 100 < 3*40, no OUT_OF_BOUNDS
    const flags = detectAnomalies({
      prevValue: 100,
      currValue: 150,
      multiplier: 2,
      historicalConsumptions: [40, 42, 38],
    });
    expect(flags).toEqual([]);
  });
});
