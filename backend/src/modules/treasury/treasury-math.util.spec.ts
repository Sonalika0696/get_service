import { describe, expect, it } from 'vitest';
import { addDays, availableToSweep, chooseSweepTenor, maturityAmount, monthKey, prematureWithdrawalRatePct, round2, simpleInterest } from './treasury-math.util.js';

describe('round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(10)).toBe(10);
  });
});

describe('simpleInterest', () => {
  it('computes principal * rate/100 * days/365, rounded to 2dp', () => {
    // 100000 * 7% * (365/365) = 7000
    expect(simpleInterest(100_000, 7, 365)).toBe(7000);
  });

  it('uses the leap-agnostic 365 basis regardless of the calendar year', () => {
    // A 366-day span (leap year) still uses /365, so it earns MORE than
    // exactly one nominal year's interest — documented, not a bug.
    const oneYear = simpleInterest(100_000, 7, 365);
    const leapYear = simpleInterest(100_000, 7, 366);
    expect(leapYear).toBeGreaterThan(oneYear);
  });

  it('handles a partial-year tenor', () => {
    // 50000 * 6% * (90/365) = 739.7260... -> 739.73
    expect(simpleInterest(50_000, 6, 90)).toBe(739.73);
  });

  it('is 0 for a 0% rate', () => {
    expect(simpleInterest(100_000, 0, 180)).toBe(0);
  });
});

describe('maturityAmount', () => {
  it('is principal plus simple interest', () => {
    expect(maturityAmount(100_000, 7, 365)).toBe(107_000);
  });
});

describe('prematureWithdrawalRatePct', () => {
  it('subtracts the default 1.00pp penalty', () => {
    expect(prematureWithdrawalRatePct(7)).toBe(6);
  });

  it('accepts a custom penalty', () => {
    expect(prematureWithdrawalRatePct(7, 2.5)).toBe(4.5);
  });

  it('floors at 0 rather than going negative', () => {
    expect(prematureWithdrawalRatePct(0.5, 1)).toBe(0);
    expect(prematureWithdrawalRatePct(0, 1)).toBe(0);
  });
});

describe('availableToSweep', () => {
  it('is balance minus floor minus already-proposed principal', () => {
    expect(availableToSweep(500_000, 100_000, 50_000)).toBe(350_000);
  });

  it('can go negative when the floor + proposals exceed the balance', () => {
    expect(availableToSweep(100_000, 100_000, 50_000)).toBe(-50_000);
  });

  it('is exactly 0 at the floor with nothing proposed', () => {
    expect(availableToSweep(100_000, 100_000, 0)).toBe(0);
  });
});

describe('monthKey / addDays', () => {
  it('gives distinct keys for the same calendar month a year apart', () => {
    const a = monthKey(new Date(Date.UTC(2026, 8, 15)));
    const b = monthKey(new Date(Date.UTC(2027, 8, 15)));
    expect(a).not.toBe(b);
  });

  it('gives the same key for any day within one calendar month', () => {
    const a = monthKey(new Date(Date.UTC(2026, 8, 1)));
    const b = monthKey(new Date(Date.UTC(2026, 8, 30)));
    expect(a).toBe(b);
  });

  it('addDays advances by whole days', () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    expect(addDays(start, 30).toISOString()).toBe(new Date(Date.UTC(2026, 0, 31)).toISOString());
  });
});

describe('chooseSweepTenor', () => {
  const now = new Date(Date.UTC(2026, 0, 1)); // Jan 1 2026

  it('returns minTenorDays when there is no existing ladder (empty)', () => {
    expect(chooseSweepTenor(now, [], 30)).toBe(30);
  });

  it('picks the shortest tenor on a tie (all candidate months equally empty)', () => {
    expect(chooseSweepTenor(now, [], 30, 120, 30)).toBe(30);
  });

  it('avoids a month already crowded with maturities', () => {
    // minTenorDays=30 -> candidate maturity Jan 31 2026 (still January).
    // Load January up with maturities so a later candidate (a different
    // month) should win instead.
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    const activeMaturities = [jan31, jan31, jan31];
    const chosen = chooseSweepTenor(now, activeMaturities, 30, 120, 30);
    const resultMonth = monthKey(addDays(now, chosen)).toString();
    const januaryKey = monthKey(jan31).toString();
    expect(resultMonth).not.toBe(januaryKey);
    expect(chosen).toBeGreaterThan(30);
  });

  it('is deterministic and stays within [minTenorDays, maxTenorDays]', () => {
    const chosen = chooseSweepTenor(now, [new Date(Date.UTC(2026, 1, 1))], 30, 365, 30);
    expect(chosen).toBeGreaterThanOrEqual(30);
    expect(chosen).toBeLessThanOrEqual(365);
  });

  it('falls back to minTenorDays unchanged when minTenorDays > maxTenorDays (malformed config)', () => {
    expect(chooseSweepTenor(now, [], 400, 365, 30)).toBe(400);
  });
});
