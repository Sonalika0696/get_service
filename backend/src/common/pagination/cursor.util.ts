import { BadRequestException } from '@nestjs/common';

/**
 * Reusable keyset-pagination cursor — Phase 9.3 (`GET /me/bills`) introduces
 * this so every later Phase 9 list endpoint (utilities, events, ...) can
 * share the same opaque-cursor contract instead of each re-inventing offset
 * pagination.
 *
 * The cursor is intentionally generic: it encodes exactly the two columns a
 * caller's query sorts by — `sortValue` (the primary sort column, already
 * stringified by the caller: an ISO timestamp string, or `null` when the
 * row's own sort column is NULL) and `id` (the tiebreaker, assumed unique
 * and itself part of the sort — e.g. `ORDER BY dueDate DESC NULLS LAST, id
 * DESC`). This module only knows about that pair; callers choose the actual
 * columns and comparison direction.
 */
export interface KeysetCursor {
  sortValue: string | null;
  id: string;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Opaque, URL-safe cursor — base64url of the cursor's JSON. Callers must treat the result as opaque; only `decodeCursor` should ever parse it back. */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isKeysetCursor(value: unknown): value is KeysetCursor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const sortValueOk = candidate.sortValue === null || typeof candidate.sortValue === 'string';
  const idOk = typeof candidate.id === 'string' && candidate.id.length > 0;
  return sortValueOk && idOk;
}

/** Decodes a cursor produced by `encodeCursor`. Throws `BadRequestException` on anything malformed — a client-supplied cursor is untrusted input that ultimately flows into a SQL parameter, so it is validated, never trusted structurally. */
export function decodeCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (!isKeysetCursor(parsed)) {
    throw new BadRequestException('Invalid cursor');
  }
  return parsed;
}

/** Parses and clamps a `?limit=` query value. Missing → `fallback`; non-positive or non-integer → rejected (a silently-clamped-to-1 typo is more confusing than a 400); over `max` → clamped down. */
export function parsePageLimit(raw: string | undefined, fallback: number = DEFAULT_PAGE_LIMIT, max: number = MAX_PAGE_LIMIT): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException('limit must be a positive integer');
  }
  return Math.min(n, max);
}

/**
 * Given `limit + 1` rows already fetched in sort order (the standard
 * over-fetch-by-one trick to detect a next page without a separate COUNT),
 * slices to the page the caller asked for and derives `nextCursor` from the
 * last row actually returned.
 */
export function buildPage<T>(rows: T[], limit: number, cursorOf: (row: T) => KeysetCursor): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(cursorOf(items[items.length - 1])) : null;
  return { items, nextCursor };
}
