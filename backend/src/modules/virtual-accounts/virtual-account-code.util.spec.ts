import { describe, expect, it } from 'vitest';
import { buildVirtualAccountCode, randomCodeSalt } from './virtual-account-code.util.js';

describe('buildVirtualAccountCode', () => {
  it('is deterministic for the same (societyId, unitNo) pair', () => {
    const a = buildVirtualAccountCode('society-1', 'A-101');
    const b = buildVirtualAccountCode('society-1', 'A-101');
    expect(a).toBe(b);
  });

  it('differs across societies for the same unitNo', () => {
    const a = buildVirtualAccountCode('society-1', 'A-101');
    const b = buildVirtualAccountCode('society-2', 'A-101');
    expect(a).not.toBe(b);
  });

  it('differs across unitNos in the same society', () => {
    const a = buildVirtualAccountCode('society-1', 'A-101');
    const b = buildVirtualAccountCode('society-1', 'A-102');
    expect(a).not.toBe(b);
  });

  it('is all-uppercase, hyphen-delimited, with no spaces or punctuation beyond "-" (bank-narration-safe)', () => {
    const code = buildVirtualAccountCode('society-1', 'A-101 / B');
    expect(code).toMatch(/^[A-Z0-9-]+$/);
    expect(code).toBe(code.toUpperCase());
  });

  it('sanitises a unitNo with special characters rather than throwing', () => {
    const code = buildVirtualAccountCode('society-1', 'Wing-B/Flat#12');
    expect(code).toMatch(/^VA-[A-F0-9]{8}-WINGBFLAT12$/);
  });

  it('falls back to a stable placeholder tag for a unitNo with no alphanumeric characters', () => {
    const code = buildVirtualAccountCode('society-1', '///');
    expect(code).toMatch(/^VA-[A-F0-9]{8}-UNIT$/);
  });

  it('appends a salt to the base code when provided, producing a different code than the unsalted base', () => {
    const base = buildVirtualAccountCode('society-1', 'A-101');
    const salted = buildVirtualAccountCode('society-1', 'A-101', 'ABC123');
    expect(salted).toBe(`${base}-ABC123`);
    expect(salted).not.toBe(base);
  });

  it('caps the unit tag length so a pathologically long unitNo does not produce an unbounded code', () => {
    const longUnitNo = 'A'.repeat(200);
    const code = buildVirtualAccountCode('society-1', longUnitNo);
    // VA- (3) + 8 hex chars + - (1) + at most 16 unit-tag chars
    expect(code.length).toBeLessThanOrEqual(3 + 8 + 1 + 16);
  });
});

describe('randomCodeSalt', () => {
  it('returns an uppercase hex string, and different calls return different values', () => {
    const a = randomCodeSalt();
    const b = randomCodeSalt();
    expect(a).toMatch(/^[A-F0-9]+$/);
    expect(a).not.toBe(b);
  });
});
