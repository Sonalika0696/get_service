import { createHash, randomBytes } from 'node:crypto';

/**
 * Phase 9.1 VirtualAccount.code generation — pure, unit-tested independent
 * of Prisma (mirrors flat-csv.util.ts / discount-ladder.util.ts's stance on
 * keeping deterministic logic out of the service layer).
 *
 * SCHEME: `VA-<8 hex chars of sha256(societyId)>-<sanitised unitNo, upper,
 * max 16 chars>`. Deterministic on (societyId, unitNo) so the SAME flat
 * always gets the SAME code on a re-run (useful for debugging/reconciling,
 * though idempotency itself is enforced by `flatId @unique` in the DB, not
 * by this determinism). Two different flats collide only if their society
 * tags AND sanitised unit tags both coincide — practically impossible at
 * this codebase's scale (32 bits of hash entropy per society), but
 * `code @unique` is still a real DB constraint, so
 * VirtualAccountsService retries with a random salt appended (see
 * `withSalt`) on the rare unique-constraint violation rather than assuming
 * this function is collision-proof.
 *
 * This code is designed to be SUBSTRING-MATCHED against free-text bank
 * transfer narration by a later phase (9.5) — kept short, all-uppercase,
 * hyphen-delimited, and free of characters a bank narration field might
 * mangle (no spaces, no punctuation beyond '-').
 */

const SOCIETY_TAG_LENGTH = 8;
const MAX_UNIT_TAG_LENGTH = 16;

function societyTag(societyId: string): string {
  return createHash('sha256').update(societyId).digest('hex').slice(0, SOCIETY_TAG_LENGTH).toUpperCase();
}

function unitTag(unitNo: string): string {
  const cleaned = unitNo.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned || 'UNIT').slice(0, MAX_UNIT_TAG_LENGTH);
}

/**
 * The deterministic base code for a (societyId, unitNo) pair. Pass `salt` to
 * derive a fallback code after a unique-constraint collision on the
 * deterministic base — see VirtualAccountsService.provisionForFlat.
 */
export function buildVirtualAccountCode(societyId: string, unitNo: string, salt?: string): string {
  const base = `VA-${societyTag(societyId)}-${unitTag(unitNo)}`;
  return salt ? `${base}-${salt}` : base;
}

/** A short, high-entropy salt for the collision-retry path — never used on the first attempt. */
export function randomCodeSalt(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}
