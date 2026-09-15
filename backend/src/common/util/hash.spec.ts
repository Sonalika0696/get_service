import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, HASH_LENGTH_BYTES, sha256, toPrismaBytes } from './hash.js';

describe('sha256', () => {
  it('is deterministic', () => {
    const a = sha256(Buffer.from('hello'));
    const b = sha256(Buffer.from('hello'));
    expect(a.equals(b)).toBe(true);
  });

  it('produces a 32-byte digest', () => {
    expect(sha256(Buffer.from('x')).length).toBe(HASH_LENGTH_BYTES);
  });

  it('changes when any input byte changes', () => {
    const a = sha256(Buffer.from('previous'), Buffer.from('payload-a'));
    const b = sha256(Buffer.from('previous'), Buffer.from('payload-b'));
    expect(a.equals(b)).toBe(false);
  });

  it('is order-sensitive across parts (chaining depends on this)', () => {
    const a = sha256(Buffer.from('a'), Buffer.from('b'));
    const b = sha256(Buffer.from('ab'));
    // Concatenation happens at the byte level, so these coincide here — the
    // real guarantee is that swapping part order changes the digest.
    const swapped = sha256(Buffer.from('b'), Buffer.from('a'));
    expect(a.equals(swapped)).toBe(false);
    expect(a.equals(b)).toBe(true);
  });
});

describe('GENESIS_HASH', () => {
  it('is 32 zero bytes', () => {
    expect(GENESIS_HASH.length).toBe(HASH_LENGTH_BYTES);
    expect(GENESIS_HASH.every((byte) => byte === 0)).toBe(true);
  });
});

describe('toPrismaBytes', () => {
  it('round-trips the same bytes as the source Buffer', () => {
    const source = sha256(Buffer.from('round-trip'));
    const bytes = toPrismaBytes(source);
    expect(Buffer.from(bytes).equals(source)).toBe(true);
  });
});
