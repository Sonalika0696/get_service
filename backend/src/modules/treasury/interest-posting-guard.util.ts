import { AccountKind } from '../../generated/prisma/enums.js';

/**
 * Invariant I4 — "the corpus belongs to the society as a legal person; no
 * resident is ever promised, credited or assigned any return on corpus
 * funds." Thrown by assertInterestPosting whenever a caller attempts to
 * credit treasury interest anywhere other than the one account the money is
 * allowed to land in.
 */
export class InterestPostingViolationError extends Error {
  constructor(creditKind: AccountKind, linkedEntityType: string) {
    super(`I4 violation: treasury interest may only be credited to INTEREST_INCOME with linkedEntityType 'FixedDeposit' (attempted creditKind=${creditKind}, linkedEntityType=${linkedEntityType})`);
    this.name = 'InterestPostingViolationError';
  }
}

/**
 * The ONE assertion every treasury interest-crediting ledger post must pass
 * through (brief step 9) — called by TreasuryService.postInterest
 * immediately before every `LedgerService.post` call that books interest
 * (deposit maturity, premature withdrawal). Never bypassed by a shortcut
 * call to `ledger.post` directly for an interest leg elsewhere in this
 * module — every such call site is required to go through
 * TreasuryService.postInterest instead, which always calls this first.
 *
 * Deliberately narrow: it does not gate ordinary principal moves
 * (CORPUS <-> FIXED_DEPOSIT) or the renewal reinvestment step
 * (INTEREST_INCOME -> CORPUS, the society redeploying its own already-
 * booked income into its own corpus — not a fresh interest credit, and
 * never a flat/resident credit either way) — only the moment interest is
 * first recognised into the books.
 */
export function assertInterestPosting(creditKind: AccountKind, linkedEntityType: string): void {
  if (creditKind !== AccountKind.INTEREST_INCOME || linkedEntityType !== 'FixedDeposit') {
    throw new InterestPostingViolationError(creditKind, linkedEntityType);
  }
}
