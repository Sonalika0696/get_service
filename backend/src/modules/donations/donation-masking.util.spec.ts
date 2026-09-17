import { describe, expect, it } from 'vitest';
import { maskContributor, type ContributionForMasking } from './donation-masking.util.js';

function contribution(overrides: Partial<ContributionForMasking> = {}): ContributionForMasking {
  return {
    id: 'c1',
    amount: 500,
    anonymous: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    flatUnitNo: 'B-101',
    residentId: 'u1',
    ...overrides,
  };
}

describe('maskContributor', () => {
  it('reveals a non-anonymous contribution to anyone', () => {
    const result = maskContributor(contribution({ anonymous: false }), false);
    expect(result.flatUnitNo).toBe('B-101');
    expect(result.residentId).toBe('u1');
    expect(result.displayName).toBe('B-101');
  });

  it('masks an anonymous contribution to a plain resident viewer', () => {
    const result = maskContributor(contribution({ anonymous: true }), false);
    expect(result.flatUnitNo).toBeNull();
    expect(result.residentId).toBeNull();
    expect(result.displayName).toBe('Anonymous');
    expect(result.anonymous).toBe(true);
  });

  it('reveals an anonymous contribution to an officer viewer', () => {
    const result = maskContributor(contribution({ anonymous: true }), true);
    expect(result.flatUnitNo).toBe('B-101');
    expect(result.residentId).toBe('u1');
    expect(result.displayName).toBe('B-101');
  });

  it('never masks amount or createdAt, regardless of anonymity or viewer', () => {
    const result = maskContributor(contribution({ anonymous: true, amount: 750 }), false);
    expect(result.amount).toBe(750);
    expect(result.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});
