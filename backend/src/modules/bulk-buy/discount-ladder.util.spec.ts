import { describe, expect, it } from 'vitest';
import { appliedTier, minCommitmentsOf, nextTierThreshold, validateLadder } from './discount-ladder.util.js';

const LADDER = [
  { minN: 2, pct: 5 },
  { minN: 4, pct: 10 },
  { minN: 6, pct: 15 },
];

describe('validateLadder', () => {
  it('accepts a well-formed, strictly-increasing/non-decreasing ladder', () => {
    expect(validateLadder(LADDER)).toBeNull();
  });

  it('accepts a single-rung ladder', () => {
    expect(validateLadder([{ minN: 1, pct: 5 }])).toBeNull();
  });

  it('rejects an empty array', () => {
    expect(validateLadder([])).toMatch(/non-empty/);
  });

  it('rejects a non-array', () => {
    expect(validateLadder({ minN: 2, pct: 5 })).toMatch(/non-empty/);
    expect(validateLadder(null)).toMatch(/non-empty/);
    expect(validateLadder(undefined)).toMatch(/non-empty/);
  });

  it('rejects a non-increasing minN', () => {
    expect(validateLadder([{ minN: 4, pct: 5 }, { minN: 4, pct: 10 }])).toMatch(/strictly increasing/);
    expect(validateLadder([{ minN: 4, pct: 5 }, { minN: 3, pct: 10 }])).toMatch(/strictly increasing/);
  });

  it('rejects a duplicate minN (caught by the strictly-increasing check)', () => {
    expect(validateLadder([{ minN: 2, pct: 5 }, { minN: 2, pct: 8 }])).toMatch(/strictly increasing/);
  });

  it('rejects a decreasing pct', () => {
    expect(validateLadder([{ minN: 2, pct: 10 }, { minN: 4, pct: 5 }])).toMatch(/non-decreasing/);
  });

  it('rejects minN that is not a positive integer', () => {
    expect(validateLadder([{ minN: 0, pct: 5 }])).toMatch(/minN/);
    expect(validateLadder([{ minN: 1.5, pct: 5 }])).toMatch(/minN/);
    expect(validateLadder([{ minN: -1, pct: 5 }])).toMatch(/minN/);
  });

  it('rejects pct outside [0, 100]', () => {
    expect(validateLadder([{ minN: 1, pct: -1 }])).toMatch(/pct/);
    expect(validateLadder([{ minN: 1, pct: 101 }])).toMatch(/pct/);
    expect(validateLadder([{ minN: 1, pct: Number.NaN }])).toMatch(/pct/);
  });

  it('rejects a malformed rung shape', () => {
    expect(validateLadder([null])).toMatch(/object/);
    expect(validateLadder(['not-an-object'])).toMatch(/object/);
  });
});

describe('minCommitmentsOf', () => {
  it("is the lowest rung's minN", () => {
    expect(minCommitmentsOf(LADDER)).toBe(2);
  });
});

describe('appliedTier', () => {
  it('returns null below the lowest rung', () => {
    expect(appliedTier(LADDER, 0)).toBeNull();
    expect(appliedTier(LADDER, 1)).toBeNull();
  });

  it('returns the exact rung pct at each boundary', () => {
    expect(appliedTier(LADDER, 2)).toBe(5);
    expect(appliedTier(LADDER, 4)).toBe(10);
    expect(appliedTier(LADDER, 6)).toBe(15);
  });

  it('returns the highest qualifying rung between boundaries', () => {
    expect(appliedTier(LADDER, 3)).toBe(5);
    expect(appliedTier(LADDER, 5)).toBe(10);
  });

  it('returns the top rung pct above the top boundary', () => {
    expect(appliedTier(LADDER, 100)).toBe(15);
  });
});

describe('nextTierThreshold', () => {
  it('returns the next rung minN below and between boundaries', () => {
    expect(nextTierThreshold(LADDER, 0)).toBe(2);
    expect(nextTierThreshold(LADDER, 2)).toBe(4);
    expect(nextTierThreshold(LADDER, 3)).toBe(4);
    expect(nextTierThreshold(LADDER, 4)).toBe(6);
  });

  it('returns null once the top rung is reached or exceeded', () => {
    expect(nextTierThreshold(LADDER, 6)).toBeNull();
    expect(nextTierThreshold(LADDER, 100)).toBeNull();
  });
});
