import { Prisma } from '../../generated/prisma/client.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Pure ledger math, independent of Prisma's DB client / a transaction —
 * unit-tested directly (see ledger-posting.util.spec.ts). LedgerService uses
 * these to validate a posting and, in verifyBalances(), to prove cached
 * balances haven't drifted from what the LedgerEntry rows actually imply.
 *
 * Balance convention (see schema.prisma's Ledger section doc comment):
 * posting a transfer of `amount` from debitAccountId to creditAccountId
 * moves balance FROM debit TO credit — debit decreases, credit increases.
 * Every posting therefore conserves the sum of all account balances in the
 * closed set (see the conservation test in the spec file).
 */

export interface PostingValidationInput {
  amount: Decimal;
  debitAccountId: string;
  creditAccountId: string;
  debitSocietyId: string;
  creditSocietyId: string;
}

/** Returns a human-readable validation error, or null if the posting is well-formed. Never mutates or looks anything up — LedgerService.post is the only place that turns this into a thrown exception. */
export function validatePosting(input: PostingValidationInput): string | null {
  if (!(input.amount instanceof Decimal) || input.amount.isNaN() || input.amount.lessThanOrEqualTo(0)) {
    return 'amount must be a positive number';
  }
  if (input.debitAccountId === input.creditAccountId) {
    return 'debit and credit accounts must differ';
  }
  if (input.debitSocietyId !== input.creditSocietyId) {
    return 'debit and credit accounts must belong to the same society';
  }
  return null;
}

export type AccountBalanceMap = Record<string, Decimal>;

/**
 * Pure application of one transfer-style posting onto a balance map. Returns
 * a NEW map (never mutates `balances`) so the conservation invariant — the
 * sum of every balance is unchanged by a posting — is trivial to assert in
 * tests: it only ever moves value between two keys of the same map.
 */
export function applyPosting(balances: AccountBalanceMap, debitAccountId: string, creditAccountId: string, amount: Decimal): AccountBalanceMap {
  const next = { ...balances };
  next[debitAccountId] = (next[debitAccountId] ?? new Decimal(0)).minus(amount);
  next[creditAccountId] = (next[creditAccountId] ?? new Decimal(0)).plus(amount);
  return next;
}

export function sumBalances(balances: AccountBalanceMap): Decimal {
  return Object.values(balances).reduce((total, b) => total.plus(b), new Decimal(0));
}

export interface LedgerEntryLike {
  debitAccountId: string;
  creditAccountId: string;
  amount: Decimal;
}

/**
 * Recomputes a single account's balance purely from its ledger entries:
 * every entry crediting the account adds, every entry debiting it
 * subtracts. Mirrors the two `aggregate({_sum: {amount}})` queries
 * LedgerService.recomputeBalance runs against Postgres — this pure version
 * is what the unit tests check the invariant against, and what
 * verifyBalances' "cached == recomputed" comparison is really asserting.
 */
export function recomputeBalanceFromEntries(accountId: string, entries: LedgerEntryLike[]): Decimal {
  let balance = new Decimal(0);
  for (const entry of entries) {
    if (entry.creditAccountId === accountId) balance = balance.plus(entry.amount);
    if (entry.debitAccountId === accountId) balance = balance.minus(entry.amount);
  }
  return balance;
}
