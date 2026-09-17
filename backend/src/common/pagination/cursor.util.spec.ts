import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, buildPage, decodeCursor, encodeCursor, parsePageLimit } from './cursor.util.js';

describe('cursor pagination helper', () => {
  it('round-trips a cursor with a non-null sortValue', () => {
    const cursor = { sortValue: '2026-01-01T00:00:00.000Z', id: 'abc123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('round-trips a cursor with a null sortValue', () => {
    const cursor = { sortValue: null, id: 'xyz' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('produces an opaque, URL-safe string', () => {
    const encoded = encodeCursor({ sortValue: null, id: 'abc' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('rejects a cursor that is not valid base64url/JSON', () => {
    expect(() => decodeCursor('%%% not a cursor %%%')).toThrow(BadRequestException);
  });

  it('rejects a well-formed but wrong-shaped payload', () => {
    const bogus = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(bogus)).toThrow(BadRequestException);
  });

  it('rejects a payload with an empty id', () => {
    const bogus = Buffer.from(JSON.stringify({ sortValue: null, id: '' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(bogus)).toThrow(BadRequestException);
  });

  it('parses a valid limit', () => {
    expect(parsePageLimit('5')).toBe(5);
  });

  it('falls back to the default when the limit is omitted', () => {
    expect(parsePageLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('clamps an over-large limit to the max', () => {
    expect(parsePageLimit(String(MAX_PAGE_LIMIT + 500))).toBe(MAX_PAGE_LIMIT);
  });

  it.each(['0', '-3', 'abc', '1.5'])('rejects an invalid limit %s', (raw) => {
    expect(() => parsePageLimit(raw)).toThrow(BadRequestException);
  });

  it('buildPage: no nextCursor when every fetched row fits within the limit', () => {
    const rows = [{ id: '1' }, { id: '2' }];
    const page = buildPage(rows, 5, (r) => ({ sortValue: null, id: r.id }));
    expect(page.items).toEqual(rows);
    expect(page.nextCursor).toBeNull();
  });

  it('buildPage: drops the lookahead row and derives nextCursor from the last page row', () => {
    // limit=2, 3 rows fetched (the over-fetch-by-one convention) — row 3 is
    // the lookahead that proves a next page exists but is not itself returned.
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const page = buildPage(rows, 2, (r) => ({ sortValue: null, id: r.id }));
    expect(page.items.map((r) => r.id)).toEqual(['1', '2']);
    expect(page.nextCursor).toBe(encodeCursor({ sortValue: null, id: '2' }));
  });

  it('buildPage: nextCursor uses the caller-supplied sortValue, not just id', () => {
    const rows = [
      { id: '1', due: '2026-03-01T00:00:00.000Z' },
      { id: '2', due: '2026-02-01T00:00:00.000Z' },
    ];
    const page = buildPage(rows, 1, (r) => ({ sortValue: r.due, id: r.id }));
    expect(page.nextCursor).toBe(encodeCursor({ sortValue: '2026-03-01T00:00:00.000Z', id: '1' }));
  });
});
