import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind } from '../../generated/prisma/enums.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import type { AccountModel, LedgerEntryModel } from '../../generated/prisma/models.js';
import { validatePosting } from './ledger-posting.util.js';
import { IdempotencyService } from './idempotency.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
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

  /** Recomputes one account's balance purely from its LedgerEntry rows (credits add, debits subtract) — independent of the cached Account.balance column. Mirrors ledger-posting.util.ts's recomputeBalanceFromEntries, which is what the unit tests exercise. */
  async recomputeBalance(societyId: string, accountId: string): Promise<Decimal> {
    const [creditSum, debitSum] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { societyId, creditAccountId: accountId }, _sum: { amount: true } }),
      this.prisma.ledgerEntry.aggregate({ where: { societyId, debitAccountId: accountId }, _sum: { amount: true } }),
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
