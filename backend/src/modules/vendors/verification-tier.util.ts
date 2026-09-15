import { VerificationTier } from '../../generated/prisma/enums.js';

/** Forward-only ladder — a vendor can only ever move one step to the right. */
const TIER_ORDER: VerificationTier[] = [VerificationTier.UNVERIFIED, VerificationTier.SOCIETY_ATTESTED, VerificationTier.PLATFORM_AUDITED];

/**
 * True iff `to` is exactly the next tier after `from` in TIER_ORDER. Rejects
 * both backward moves and jumps that skip a tier (e.g. UNVERIFIED straight
 * to PLATFORM_AUDITED) — every promotion must pass through SOCIETY_ATTESTED.
 */
export function canTransitionTier(from: VerificationTier, to: VerificationTier): boolean {
  const fromIndex = TIER_ORDER.indexOf(from);
  const toIndex = TIER_ORDER.indexOf(to);
  return fromIndex !== -1 && toIndex === fromIndex + 1;
}
