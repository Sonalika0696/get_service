import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify } from './canonical-json.js';

describe('canonicalJsonStringify', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = canonicalJsonStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJsonStringify({ a: 2, c: { y: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order (arrays are not sorted)', () => {
    const a = canonicalJsonStringify({ list: [3, 1, 2] });
    const b = canonicalJsonStringify({ list: [1, 2, 3] });
    expect(a).not.toBe(b);
  });

  it('produces different output when a nested value differs', () => {
    const a = canonicalJsonStringify({ x: { y: 1 } });
    const b = canonicalJsonStringify({ x: { y: 2 } });
    expect(a).not.toBe(b);
  });
});
