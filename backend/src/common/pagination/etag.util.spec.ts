import { describe, expect, it } from 'vitest';
import { computeEtag, etagMatches } from './etag.util.js';

describe('ETag helper', () => {
  it('is deterministic for an identical payload', () => {
    const a = computeEtag({ items: [{ id: '1' }], nextCursor: null });
    const b = computeEtag({ items: [{ id: '1' }], nextCursor: null });
    expect(a).toBe(b);
  });

  it('differs when the payload changes', () => {
    expect(computeEtag({ a: 1 })).not.toBe(computeEtag({ a: 2 }));
  });

  it('is a validly quoted HTTP entity-tag', () => {
    expect(computeEtag({ a: 1 })).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('304 logic: matches when If-None-Match repeats the exact ETag', () => {
    const etag = computeEtag({ a: 1 });
    expect(etagMatches(etag, etag)).toBe(true);
  });

  it('304 logic: matches inside a comma-separated If-None-Match list', () => {
    const etag = computeEtag({ a: 1 });
    expect(etagMatches(etag, `"stale-tag", ${etag}`)).toBe(true);
  });

  it('304 logic: matches a weakly-tagged candidate (W/ prefix), per weak comparison', () => {
    const etag = computeEtag({ a: 1 });
    expect(etagMatches(etag, `W/${etag}`)).toBe(true);
  });

  it('304 logic: matches the wildcard', () => {
    expect(etagMatches(computeEtag({ a: 1 }), '*')).toBe(true);
  });

  it('304 logic: does not match a different ETag', () => {
    expect(etagMatches(computeEtag({ a: 1 }), computeEtag({ a: 2 }))).toBe(false);
  });

  it('304 logic: does not match when If-None-Match is absent', () => {
    expect(etagMatches(computeEtag({ a: 1 }), undefined)).toBe(false);
    expect(etagMatches(computeEtag({ a: 1 }), null)).toBe(false);
    expect(etagMatches(computeEtag({ a: 1 }), '')).toBe(false);
  });
});
