import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
import { applyPosting, recomputeBalanceFromEntries, sumBalances, validatePosting } from './ledger-posting.util.js';

describe('validatePosting', () => {
  const base = { debitAccountId: 'acc-debit', creditAccountId: 'acc-credit', debitSocietyId: 'soc-1', creditSocietyId: 'soc-1' };

  it('accepts a well-formed posting', () => {
    expect(validatePosting({ ...base, amount: new Decimal(100) })).toBeNull();
  });

  it('rejects a zero amount', () => {
    expect(validatePosting({ ...base, amount: new Decimal(0) })).toMatch(/positive/);
  });

  it('rejects a negative amount', () => {
    expect(validatePosting({ ...base, amount: new Decimal(-5) })).toMatch(/positive/);
  });

  it('rejects debit and credit accounts being the same', () => {
    expect(validatePosting({ ...base, creditAccountId: base.debitAccountId, amount: new Decimal(10) })).toMatch(/differ/);
  });

  it('rejects debit and credit accounts from different societies', () => {
    expect(validatePosting({ ...base, creditSocietyId: 'soc-2', amount: new Decimal(10) })).toMatch(/same society/);
  });
});

describe('applyPosting / sumBalances — conservation invariant', () => {
  it('a single posting moves value from debit to credit without changing the total', () => {
    const before: Record<string, Decimal> = { A: new Decimal(100), B: new Decimal(0) };
    const totalBefore = sumBalances(before);

    const after = applyPosting(before, 'A', 'B', new Decimal(40));

    expect(after.A.toString()).toBe('60');
    expect(after.B.toString()).toBe('40');
    expect(sumBalances(after).toString()).toBe(totalBefore.toString());
  });

  it('conserves the total across a chain of postings touching many accounts, including a new one appearing mid-chain', () => {
    let balances: Record<string, Decimal> = { SOCIETY_MASTER: new Decimal(1000) };
    const totalBefore = sumBalances(balances);

    balances = applyPosting(balances, 'SOCIETY_MASTER', 'COMMISSION_SINK', new Decimal(150));
    balances = applyPosting(balances, 'SOCIETY_MASTER', 'BULK_BUY', new Decimal(200));
    balances = applyPosting(balances, 'BULK_BUY', 'COMMISSION_SINK', new Decimal(50));
    balances = applyPosting(balances, 'COMMISSION_SINK', 'SOCIETY_MASTER', new Decimal(30));

    expect(sumBalances(balances).toString()).toBe(totalBefore.toString());
    expect(balances.SOCIETY_MASTER.toString()).toBe('680'); // 1000 - 150 - 200 + 30
    expect(balances.COMMISSION_SINK.toString()).toBe('170'); // 150 + 50 - 30
    expect(balances.BULK_BUY.toString()).toBe('150'); // 200 - 50
  });

  it('money entering the closed set via EXTERNAL makes EXTERNAL negative while the rest of the set gains it', () => {
    // Debiting EXTERNAL models money entering the system (e.g. a future PSP
    // settlement crediting SOCIETY_MASTER) — see schema.prisma's doc comment.
    let balances: Record<string, Decimal> = { EXTERNAL: new Decimal(0), SOCIETY_MASTER: new Decimal(0) };
    balances = applyPosting(balances, 'EXTERNAL', 'SOCIETY_MASTER', new Decimal(500));

    expect(balances.EXTERNAL.toString()).toBe('-500');
    expect(balances.SOCIETY_MASTER.toString()).toBe('500');
    expect(sumBalances(balances).toString()).toBe('0');
  });
});

describe('recomputeBalanceFromEntries', () => {
  it('matches the cumulative result of applying the same postings via applyPosting', () => {
    let balances: Record<string, Decimal> = {};
    const entries = [
      { debitAccountId: 'SOCIETY_MASTER', creditAccountId: 'COMMISSION_SINK', amount: new Decimal(150) },
      { debitAccountId: 'SOCIETY_MASTER', creditAccountId: 'BULK_BUY', amount: new Decimal(200) },
      { debitAccountId: 'BULK_BUY', creditAccountId: 'COMMISSION_SINK', amount: new Decimal(50) },
    ];
    for (const entry of entries) {
      balances = applyPosting(balances, entry.debitAccountId, entry.creditAccountId, entry.amount);
    }

    expect(recomputeBalanceFromEntries('SOCIETY_MASTER', entries).toString()).toBe(balances.SOCIETY_MASTER.toString());
    expect(recomputeBalanceFromEntries('COMMISSION_SINK', entries).toString()).toBe(balances.COMMISSION_SINK.toString());
    expect(recomputeBalanceFromEntries('BULK_BUY', entries).toString()).toBe(balances.BULK_BUY.toString());
  });

  it('an account with no entries recomputes to zero', () => {
    expect(recomputeBalanceFromEntries('UNTOUCHED', []).toString()).toBe('0');
  });

  it('verifyBalances-style check: a tampered cached balance is caught by comparing against the recompute', () => {
    const entries = [{ debitAccountId: 'SOCIETY_MASTER', creditAccountId: 'COMMISSION_SINK', amount: new Decimal(150) }];
    const recomputed = recomputeBalanceFromEntries('COMMISSION_SINK', entries);
    const cachedCorrect = new Decimal(150);
    const cachedTampered = new Decimal(999);

    expect(recomputed.equals(cachedCorrect)).toBe(true);
    expect(recomputed.equals(cachedTampered)).toBe(false);
  });
});
