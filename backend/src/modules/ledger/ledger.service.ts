import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, SocietyStatus } from '../../generated/prisma/enums.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import type { AccountModel, LedgerEntryModel } from '../../generated/prisma/models.js';
import { validatePosting } from './ledger-posting.util.js';
import { IdempotencyService } from './idempotency.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { PostAdjustmentDto } from './dto/post-adjustment.dto.js';

interface PostByIds {
  societyId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number | string | Decimal;
  reasonCode: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
}

interface PostByKinds {
  societyId: string;
  debitKind: AccountKind;
  creditKind: AccountKind;
  amount: number | string | Decimal;
  reasonCode: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
}

/** Callers pass either resolved account ids or the convenience {debitKind, creditKind} — most in-app callers only ever deal in kinds. */
export type PostLedgerEntryInput = PostByIds | PostByKinds;

function isByKinds(input: PostLedgerEntryInput): input is PostByKinds {
  return 'debitKind' in input;
}

export interface AccountBalance {
  kind: AccountKind;
  accountId: string;
  balance: string;
}

export interface BalanceVerificationRow {
  kind: AccountKind;
  accountId: string;
  cached: string;
  recomputed: string;
  intact: boolean;
}

export interface BalanceVerificationReport {
  ok: boolean;
  accounts: BalanceVerificationRow[];
}

/** Result of assertAllBalances() — the I6 assertion worker's cross-society sweep. */
export interface BalanceAssertionSummary {
  societiesChecked: number;
  accountsChecked: number;
  divergentAccounts: number;
}

/** Result of rebuildBalances() — the I6 rebuild, plus a fresh verify report proving it worked. */
export interface RebuildResult {
  societyId: string;
  accounts: AccountBalance[];
  report: BalanceVerificationReport;
}

/**
 * The escrow ledger's append-only double-entry posting primitive (Phase
 * 4A — see schema.prisma's Ledger section doc comment for the balance
 * convention). Every other module that ever moves money (Phase 4B payments,
 * bulk-buy, payouts, ...) is expected to call `post()` from inside its own
 * `$transaction`, passing that transaction's client in as `tx` so the
 * ledger write and the caller's own writes commit or roll back together.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  /** Idempotent per [societyId, kind] — the canonical account for a kind is created lazily on first use. */
  async getOrCreateAccount(societyId: string, kind: AccountKind, tx?: Prisma.TransactionClient): Promise<AccountModel> {
    const client = tx ?? this.prisma;
    return client.account.upsert({
      where: { societyId_kind: { societyId, kind } },
      update: {},
      create: { societyId, kind },
    });
  }

  /**
   * Posts one balanced transfer: `amount` moves from the debit account to
   * the credit account, atomically creating the append-only LedgerEntry row
   * and updating both accounts' cached balances.
   *
   * Unit-of-work contract: pass `tx` (a Prisma.TransactionClient) to enlist
   * this post in a transaction your own service already opened — e.g. a
   * future PaymentsService creating a Payment row and posting its ledger
   * effect in the same commit. Omit `tx` and `post()` opens its own
   * single-statement transaction, which is enough when nothing else needs
   * to be atomic with it (e.g. this module's own postAdjustment).
   */
  async post(input: PostLedgerEntryInput, tx?: Prisma.TransactionClient): Promise<LedgerEntryModel> {
    if (tx) {
      return this.postWithin(tx, input);
    }
    return this.prisma.$transaction((innerTx) => this.postWithin(innerTx, input));
  }

  private async postWithin(tx: Prisma.TransactionClient, input: PostLedgerEntryInput): Promise<LedgerEntryModel> {
    const amount = input.amount instanceof Decimal ? input.amount : new Decimal(input.amount);

    const [debitAccount, creditAccount] = isByKinds(input)
      ? await Promise.all([this.getOrCreateAccount(input.societyId, input.debitKind, tx), this.getOrCreateAccount(input.societyId, input.creditKind, tx)])
      : await Promise.all([this.findAccountOrThrow(tx, input.debitAccountId), this.findAccountOrThrow(tx, input.creditAccountId)]);

    if (debitAccount.societyId !== input.societyId || creditAccount.societyId !== input.societyId) {
      throw new BadRequestException('debit and credit accounts must belong to the caller\'s society');
    }

    const validationError = validatePosting({
      amount,
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      debitSocietyId: debitAccount.societyId,
      creditSocietyId: creditAccount.societyId,
    });
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        societyId: input.societyId,
        debitAccountId: debitAccount.id,
        creditAccountId: creditAccount.id,
        amount,
        reasonCode: input.reasonCode,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
      },
    });

    // Atomic SQL `balance = balance - amount` / `balance = balance + amount`
    // updates — no read-modify-write race, and both happen in this same tx
    // as the LedgerEntry insert, so a crash between them is impossible.
    await tx.account.update({ where: { id: debitAccount.id }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: creditAccount.id }, data: { balance: { increment: amount } } });

    return entry;
  }

  private async findAccountOrThrow(tx: Prisma.TransactionClient, id: string): Promise<AccountModel> {
    const account = await tx.account.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }

  /** Aggregates only — every account kind that exists for the society, with its cached balance. Kinds with no Account row yet simply don't appear (getOrCreateAccount lazily creates them on first post). */
  async balances(societyId: string): Promise<AccountBalance[]> {
    const accounts = await this.prisma.account.findMany({ where: { societyId }, orderBy: { kind: 'asc' } });
    return accounts.map((a) => ({ kind: a.kind, accountId: a.id, balance: a.balance.toString() }));
  }

  /**
   * Recomputes one account's balance purely from its LedgerEntry rows
   * (credits add, debits subtract) — independent of the cached
   * Account.balance column. Mirrors ledger-posting.util.ts's
   * recomputeBalanceFromEntries, which is what the unit tests exercise.
   *
   * Accepts an optional `tx` so rebuildBalances() can recompute every
   * account of a society from a single consistent snapshot inside one
   * transaction, same unit-of-work contract as post()/getOrCreateAccount().
   */
  async recomputeBalance(societyId: string, accountId: string, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const [creditSum, debitSum] = await Promise.all([
      client.ledgerEntry.aggregate({ where: { societyId, creditAccountId: accountId }, _sum: { amount: true } }),
      client.ledgerEntry.aggregate({ where: { societyId, debitAccountId: accountId }, _sum: { amount: true } }),
    ]);
    const credit = creditSum._sum.amount ?? new Decimal(0);
    const debit = debitSum._sum.amount ?? new Decimal(0);
    return credit.minus(debit);
  }

  /** Cheap integrity check, analogous to AuditService.verifyChain: for every account in the society, does the cached balance match a fresh recompute from LedgerEntry rows? */
  async verifyBalances(societyId: string): Promise<BalanceVerificationReport> {
    const accounts = await this.prisma.account.findMany({ where: { societyId } });
    const rows = await Promise.all(
      accounts.map(async (account): Promise<BalanceVerificationRow> => {
        const recomputed = await this.recomputeBalance(societyId, account.id);
        return {
          kind: account.kind,
          accountId: account.id,
          cached: account.balance.toString(),
          recomputed: recomputed.toString(),
          intact: recomputed.equals(account.balance),
        };
      }),
    );
    return { ok: rows.every((r) => r.intact), accounts: rows };
  }

  /**
   * Phase 6.5 Invariant I6 assertion worker: runs verifyBalances() across
   * every ACTIVE society and, for any divergent account, logs a loud
   * Logger.error alert naming the society, account kind, and both the
   * cached and recomputed values — never throws on a divergence, since
   * this is a monitoring pass, not a request that should fail.
   *
   * v1 has no scheduler (`@nestjs/schedule` wasn't added — same stance as
   * PollsService.processExpired / BulkBuyService.rollOffer's "stand-in for
   * a future scheduler" doc comments): a periodic job would call this
   * automatically; for now it's a manually-triggered endpoint. Unlike
   * those two, though, this worker is inherently cross-society (a single
   * balance-cache bug could affect every society at once), so it can't be
   * exposed as a `@ResidentOnly()` route the way theirs are — a resident
   * only ever has one societyId to trigger a check for. It's exposed as
   * `POST /ledger/assert-balances`, `@OperatorOnly()`, because the OPERATOR
   * principal is the only one in this system with no society scope to
   * begin with (see OperatorPrincipal's doc comment).
   */
  async assertAllBalances(): Promise<BalanceAssertionSummary> {
    const societies = await this.prisma.society.findMany({ where: { status: SocietyStatus.ACTIVE }, select: { id: true } });

    let accountsChecked = 0;
    let divergentAccounts = 0;
    for (const society of societies) {
      const report = await this.verifyBalances(society.id);
      accountsChecked += report.accounts.length;
      for (const row of report.accounts) {
        if (!row.intact) {
          divergentAccounts += 1;
          this.logger.error(
            `BALANCE CACHE DIVERGENCE: society=${society.id} account=${row.accountId} kind=${row.kind} cached=${row.cached} recomputed=${row.recomputed}`,
          );
        }
      }
    }

    return { societiesChecked: societies.length, accountsChecked, divergentAccounts };
  }

  /**
   * Phase 6.5 Invariant I6 "rebuildable cache" guarantee: rewrites every
   * Account.balance in the society from LedgerEntry truth
   * (recomputeBalance), inside one transaction, then writes a best-effort
   * AuditService entry recording the resulting per-account balances.
   *
   * Never invents a balance — every value comes from summing the society's
   * existing, immutable LedgerEntry rows, so double-entry conservation (the
   * sum of every account's balance, and total debits == total credits) is
   * unaffected by a rebuild: it can only move the cache back to what the
   * ledger already implies, never introduce new value.
   */
  async rebuildBalances(societyId: string, actorId: string): Promise<RebuildResult> {
    const rebuilt = await this.prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({ where: { societyId } });
      const updated: AccountModel[] = [];
      for (const account of accounts) {
        const recomputed = await this.recomputeBalance(societyId, account.id, tx);
        updated.push(await tx.account.update({ where: { id: account.id }, data: { balance: recomputed } }));
      }
      return updated;
    });

    const report = await this.verifyBalances(societyId);

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'LEDGER_BALANCE_REBUILD',
      subjectType: 'Account',
      subjectId: societyId,
      payload: { accounts: rebuilt.map((a) => ({ accountId: a.id, kind: a.kind, balance: a.balance.toString() })) },
    });

    return {
      societyId,
      accounts: rebuilt.map((a): AccountBalance => ({ kind: a.kind, accountId: a.id, balance: a.balance.toString() })),
      report,
    };
  }

  /**
   * The manual treasury adjustment used by POST /ledger/adjustments. Wrapped
   * in IdempotencyService.runOnce so a replayed request (same
   * Idempotency-Key) returns the exact prior response instead of posting a
   * second transfer — this is the mechanism Phase 4B's payment/webhook
   * routes are expected to reuse (see IdempotencyService's doc comment).
   */
  async postAdjustment(societyId: string, idempotencyKey: string, dto: PostAdjustmentDto): Promise<{ entry: LedgerEntryModel; replayed: boolean }> {
    const { body, replayed } = await this.idempotency.runOnce<LedgerEntryModel>('LEDGER_ADJUSTMENT', idempotencyKey, societyId, async (tx) => {
      const entry = await this.post(
        {
          societyId,
          debitKind: dto.debitKind,
          creditKind: dto.creditKind,
          amount: dto.amount,
          reasonCode: dto.reasonCode,
          linkedEntityType: 'ManualAdjustment',
        },
        tx,
      );
      return { status: 201, body: entry };
    });
    return { entry: body, replayed };
  }
}
