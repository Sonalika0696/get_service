import { describe, expect, it } from 'vitest';
import { computeLateFee, DEFAULT_LATE_FEE_CONFIG, parseLateFeeConfig, validateLateFeeConfig, type LateFeeConfig } from './late-fee.util.js';

const CONFIG: LateFeeConfig = { graceDays: 5, flatFee: 100, dailyFee: 10, capFraction: 0.2 };
const DUE = new Date('2026-01-10T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('validateLateFeeConfig', () => {
  it('accepts a well-formed config', () => {
    expect(validateLateFeeConfig(CONFIG)).toBeNull();
  });

  it('rejects a negative or non-integer graceDays', () => {
    expect(validateLateFeeConfig({ ...CONFIG, graceDays: -1 })).toMatch(/graceDays/);
    expect(validateLateFeeConfig({ ...CONFIG, graceDays: 1.5 })).toMatch(/graceDays/);
  });

  it('accepts graceDays of 0', () => {
    expect(validateLateFeeConfig({ ...CONFIG, graceDays: 0 })).toBeNull();
  });

  it('rejects a negative flatFee', () => {
    expect(validateLateFeeConfig({ ...CONFIG, flatFee: -1 })).toMatch(/flatFee/);
  });

  it('accepts flatFee of 0', () => {
    expect(validateLateFeeConfig({ ...CONFIG, flatFee: 0 })).toBeNull();
  });

  it('rejects a negative dailyFee', () => {
    expect(validateLateFeeConfig({ ...CONFIG, dailyFee: -1 })).toMatch(/dailyFee/);
  });

  it('accepts dailyFee of 0', () => {
    expect(validateLateFeeConfig({ ...CONFIG, dailyFee: 0 })).toBeNull();
  });

  it('rejects capFraction outside (0, 1]', () => {
    expect(validateLateFeeConfig({ ...CONFIG, capFraction: 0 })).toMatch(/capFraction/);
    expect(validateLateFeeConfig({ ...CONFIG, capFraction: -0.1 })).toMatch(/capFraction/);
    expect(validateLateFeeConfig({ ...CONFIG, capFraction: 1.1 })).toMatch(/capFraction/);
  });

  it('accepts capFraction exactly 1', () => {
    expect(validateLateFeeConfig({ ...CONFIG, capFraction: 1 })).toBeNull();
  });
});

describe('parseLateFeeConfig', () => {
  it('falls back to the documented default when config is missing/empty', () => {
    expect(parseLateFeeConfig(undefined)).toEqual(DEFAULT_LATE_FEE_CONFIG);
    expect(parseLateFeeConfig(null)).toEqual(DEFAULT_LATE_FEE_CONFIG);
    expect(parseLateFeeConfig({})).toEqual(DEFAULT_LATE_FEE_CONFIG);
  });

  it('falls back to the default when lateFee is present but malformed', () => {
    expect(parseLateFeeConfig({ lateFee: null })).toEqual(DEFAULT_LATE_FEE_CONFIG);
    expect(parseLateFeeConfig({ lateFee: { graceDays: 'nope', flatFee: 50, dailyFee: 2, capFraction: 0.1 } })).toEqual(DEFAULT_LATE_FEE_CONFIG);
    expect(parseLateFeeConfig({ lateFee: { graceDays: -1, flatFee: 50, dailyFee: 2, capFraction: 0.1 } })).toEqual(DEFAULT_LATE_FEE_CONFIG);
  });

  it('reads a well-formed lateFee config', () => {
    expect(parseLateFeeConfig({ lateFee: CONFIG })).toEqual(CONFIG);
  });

  it('does not partially merge — an otherwise-valid config with one bad field falls back entirely, not field-by-field', () => {
    const result = parseLateFeeConfig({ lateFee: { graceDays: 5, flatFee: 100, dailyFee: 10, capFraction: 5 } });
    expect(result).toEqual(DEFAULT_LATE_FEE_CONFIG);
    expect(result.graceDays).not.toBe(5);
  });
});

describe('computeLateFee', () => {
  it('accrues nothing strictly within the grace period', () => {
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, new Date(DUE.getTime() + 3 * DAY), CONFIG)).toBe(0);
  });

  it('accrues nothing exactly at the grace boundary', () => {
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, new Date(DUE.getTime() + CONFIG.graceDays * DAY), CONFIG)).toBe(0);
  });

  it('accrues flatFee + one day of dailyFee the instant grace ends', () => {
    const asOf = new Date(DUE.getTime() + CONFIG.graceDays * DAY + 1); // 1ms past grace
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, asOf, CONFIG)).toBe(110); // 100 + 10*1
  });

  it('accrues flatFee + dailyFee * N for N whole days past grace', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 4) * DAY); // 4 full days past grace
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, asOf, CONFIG)).toBe(140); // 100 + 10*4
  });

  it('never returns negative even if alreadyAccrued already exceeds the raw formula', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 1) * DAY);
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 500 }, asOf, CONFIG)).toBe(0);
  });

  it('returns only the incremental delta on top of alreadyAccrued', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 4) * DAY);
    // Raw total owed at 4 days past grace = 140; 110 already accrued (from the 1-day pass) -> 30 more.
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 110 }, asOf, CONFIG)).toBe(30);
  });

  it('caps the total accrued at capFraction * amount, regardless of how many days late', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 1000) * DAY); // wildly overdue
    const cap = 1000 * CONFIG.capFraction; // 200
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, asOf, CONFIG)).toBe(cap);
  });

  it('returns 0 once alreadyAccrued has already reached the cap', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 1000) * DAY);
    const cap = 1000 * CONFIG.capFraction;
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: cap }, asOf, CONFIG)).toBe(0);
  });

  it('returns 0 for a non-positive amount regardless of how overdue', () => {
    const asOf = new Date(DUE.getTime() + (CONFIG.graceDays + 30) * DAY);
    expect(computeLateFee({ amount: 0, dueDate: DUE, alreadyAccrued: 0 }, asOf, CONFIG)).toBe(0);
    expect(computeLateFee({ amount: -100, dueDate: DUE, alreadyAccrued: 0 }, asOf, CONFIG)).toBe(0);
  });

  it('respects graceDays of 0 — a fee can accrue the day after dueDate itself', () => {
    const zeroGrace: LateFeeConfig = { ...CONFIG, graceDays: 0 };
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, DUE, zeroGrace)).toBe(0); // exactly on due date
    const asOf = new Date(DUE.getTime() + DAY);
    expect(computeLateFee({ amount: 1000, dueDate: DUE, alreadyAccrued: 0 }, asOf, zeroGrace)).toBe(110);
  });
});
