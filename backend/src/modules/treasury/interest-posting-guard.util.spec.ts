import { describe, expect, it } from 'vitest';
import { AccountKind } from '../../generated/prisma/enums.js';
import { assertInterestPosting, InterestPostingViolationError } from './interest-posting-guard.util.js';

describe('assertInterestPosting (I4 guard)', () => {
  it('allows crediting INTEREST_INCOME with linkedEntityType FixedDeposit', () => {
    expect(() => assertInterestPosting(AccountKind.INTEREST_INCOME, 'FixedDeposit')).not.toThrow();
  });

  it('throws when the credit target is not INTEREST_INCOME', () => {
    expect(() => assertInterestPosting(AccountKind.CORPUS, 'FixedDeposit')).toThrow(InterestPostingViolationError);
  });

  it('throws when the linked entity type is not FixedDeposit (e.g. a flat-linked entity)', () => {
    expect(() => assertInterestPosting(AccountKind.INTEREST_INCOME, 'MaintenanceCharge')).toThrow(InterestPostingViolationError);
  });

  it('throws when both are wrong', () => {
    expect(() => assertInterestPosting(AccountKind.MAINTENANCE, 'Flat')).toThrow(InterestPostingViolationError);
  });
});
