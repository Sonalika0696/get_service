import { createHash } from 'node:crypto';

/**
 * Strong-hash ETag over a serialized page payload. Deterministic for
 * identical input (same items in the same order) so `If-None-Match` on an
 * unchanged page short-circuits to 304 — paired with `etagMatches` below.
 * Companion to `cursor.util.ts` (see its doc comment) as the other half of
 * the reusable Phase 9 list-endpoint contract.
 */
export function computeEtag(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `"${hash}"`;
}

function stripWeakPrefix(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

/**
 * True when the raw `If-None-Match` request header already covers `etag`.
 * Per RFC 7232 §2.3.2, `If-None-Match` uses weak comparison (the `W/`
 * prefix is stripped before comparing) and may be a comma-separated list or
 * `*`.
 */
export function etagMatches(etag: string, ifNoneMatch: string | undefined | null): boolean {
  if (!ifNoneMatch) return false;
  const target = stripWeakPrefix(etag);
  return ifNoneMatch.split(',').some((candidate) => {
    const normalized = stripWeakPrefix(candidate);
    return normalized === '*' || normalized === target;
  });
}
