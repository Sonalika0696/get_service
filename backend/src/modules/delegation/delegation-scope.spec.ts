import { describe, expect, it } from 'vitest';
import { DelegationScope } from '../../generated/prisma/enums.js';

/**
 * The real guarantee that Delegation cannot express a financial or
 * governance capability is a TYPE-LEVEL one: DelegationScope (schema.prisma)
 * has no MONEY/PAYOUT/LEDGER/VOTE/APPROVAL member, so no TypeScript value
 * of type DelegationScope can ever be one of those strings — a caller
 * cannot "smuggle" one through the type system the way they could with a
 * free-form string/bitmask scope. This spec can't exercise the type system
 * (that's compile-time, not runtime), but it locks the enum's *value set*
 * against silently growing a money/governance member later without a
 * reviewer noticing — the runtime companion to the compile-time guarantee.
 */
describe('DelegationScope — financial/governance capability excluded at the type level', () => {
  it('contains exactly the four operational scopes and nothing else', () => {
    expect(Object.values(DelegationScope).sort()).toEqual(['EVENT_OPT_IN', 'JOB_BLOG_POSTING', 'SERVICE_REQUESTS', 'VENDOR_DIRECTORY_ACCESS'].sort());
  });

  it('contains no member naming a money/governance action', () => {
    const forbidden = ['MONEY', 'PAYOUT', 'PAYMENT', 'LEDGER', 'VOTE', 'VOTING', 'APPROV', 'TREASUR', 'FUND', 'DISBURS', 'REFUND', 'ESCROW'];
    for (const value of Object.values(DelegationScope)) {
      for (const term of forbidden) {
        expect(value.includes(term)).toBe(false);
      }
    }
  });
});
