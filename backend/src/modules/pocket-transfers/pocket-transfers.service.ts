import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AuditService, type AppendAuditLogInput } from '../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, PocketTransferStatus, RoleKind } from '../../generated/prisma/enums.js';
import type { PocketTransferModel } from '../../generated/prisma/models.js';
import { parseApprovalConfig } from '../bulk-buy/approval-ladder.util.js';
import { requiredTransferApprovers } from './transfer-approval.util.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import type { RequestTransferDto } from './dto/request-transfer.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Advisory-lock namespace reserved for pocket-transfer execution (Phase 9.6
 * — see this task's own doc comment / BulkBuyService.PAYOUT_LOCK_NAMESPACE
 * (52) and AuditService.append (42) / IdempotencyService.runOnce (51) for
 * the other namespaces already in use in this codebase). Taken as the
 * FIRST statement inside authoriseTransfer's transaction, keyed on the
 * transfer's own id, mirroring exactly how bulk-buy serializes every
 * money-moving call on a given booking.
 */
const POCKET_TRANSFER_LOCK_NAMESPACE = 56;

/**
 * The seven Phase 9.1 sub-ledger pocket kinds a transfer may move between —
 * deliberately excludes SOCIETY_MASTER/BULK_BUY/DISPUTE/EXTERNAL/VENDOR/
 * RETENTION, which are all special-purpose accounts a committee should
 * never be able to drain via a "pocket transfer" (BULK_BUY escrow has its
 * own dual-authorised payout path; EXTERNAL is the PSP/bank boundary, never
 * a transfer endpoint; RETENTION is defect-liability-only).
 */
const POCKET_KINDS: ReadonlySet<AccountKind> = new Set([
  AccountKind.MAINTENANCE,
  AccountKind.ELECTRICITY,
  AccountKind.WATER,
  AccountKind.EVENTS,
  AccountKind.WELFARE,
  AccountKind.SINKING,
  AccountKind.CORPUS,
]);

/** API-facing shape: the transfer row plus a live authorisation readout. */
export type PocketTransferDetail = PocketTransferModel & {
  /** Count of DISTINCT officers who have authorised this transfer so far. */
  authorisedCount: number;
  /** The number of DISTINCT officers required to execute it, evaluated right now (see requiredTransferApprovers's doc comment — this can shift if the roster or config changes between calls). */
  requiredApprovers: number;
};

export interface PocketTransferPage {
  items: PocketTransferDetail[];
  nextCursor: string | null;
}

export interface ListPocketTransfersParams {
  status?: string;
  cursor?: string;
  limit?: string;
}

/**
 * Phase 9.6 — dual-authorised cross-pocket transfers (e.g. MAINTENANCE ->
 * SINKING). Mirrors BulkBuyService.authorisePayout almost exactly, scoped
 * to a PocketTransfer instead of a Payout, with one deliberate difference
 * (Decision #4): a pocket transfer is NEVER single-officer, even at rung 1
 * — see transfer-approval.util.ts's requiredTransferApprovers, which wraps
 * bulk-buy's approval-ladder.util.ts (read-only reuse; that file is never
 * modified) with a hard floor of 2.
 *
 * `request` never posts to the ledger — money only moves inside
 * `authoriseTransfer`, the instant the distinct-officer threshold is
 * crossed, exactly like a bulk-buy payout. v1 keeps `request` simple: the
 * requester's own call does NOT auto-record an authorisation, even if the
 * requester is themselves an eligible officer — a separate, explicit
 * `authorise` call is always required from every approving officer
 * (including the requester, if they want to also approve), so the
 * approval trail is unambiguous about who actually reviewed the transfer
 * rather than conflating "proposed it" with "approved it".
 */
@Injectable()
export class PocketTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  async request(societyId: string, requesterId: string, dto: RequestTransferDto): Promise<PocketTransferDetail> {
    if (dto.fromKind === dto.toKind) {
      throw new BadRequestException('fromKind and toKind must be different pockets');
    }
    if (!POCKET_KINDS.has(dto.fromKind)) {
      throw new BadRequestException(`fromKind must be one of ${[...POCKET_KINDS].join(', ')}`);
    }
    if (!POCKET_KINDS.has(dto.toKind)) {
      throw new BadRequestException(`toKind must be one of ${[...POCKET_KINDS].join(', ')}`);
    }
    if (!(dto.amount > 0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const transfer = await this.prisma.pocketTransfer.create({
      data: {
        societyId,
        fromKind: dto.fromKind,
        toKind: dto.toKind,
        amount: new Decimal(dto.amount),
        reasonCode: dto.reasonCode,
        note: dto.note,
        status: PocketTransferStatus.PENDING,
        requestedById: requesterId,
      },
    });

    return this.toDetail(this.prisma, transfer);
  }

  /**
   * Mirrors BulkBuyService.authorisePayout's shape exactly (see that
   * method's doc comment for the full concurrency argument — the advisory
   * lock, the upsert's idempotency, and why a race between two distinct
   * officers still executes exactly once): the SAME advisory lock (this
   * module's own namespace, 56) as every call on a given transfer, an
   * idempotent per-officer upsert (`@@unique([transferId, authoriserId])`
   * is the belt-and-suspenders backstop), and a re-check of `status` under
   * the lock immediately before executing so a replayed call after
   * EXECUTED is a verified no-op.
   */
  async authoriseTransfer(societyId: string, transferId: string, officerId: string): Promise<PocketTransferDetail> {
    let executedAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${POCKET_TRANSFER_LOCK_NAMESPACE}, hashtext(${transferId}))`;

      const transfer = await tx.pocketTransfer.findUnique({ where: { id: transferId } });
      if (!transfer || transfer.societyId !== societyId) {
        throw new NotFoundException('Pocket transfer not found');
      }

      if (transfer.status === PocketTransferStatus.EXECUTED) {
        return this.toDetail(tx, transfer);
      }
      if (transfer.status === PocketTransferStatus.CANCELLED) {
        throw new BadRequestException('This transfer has been cancelled');
      }

      // Upsert: replaying this call (before EXECUTED), whether by the same
      // officer or a genuinely new one, is a safe no-op / single-insert —
      // same pattern as PayoutAuthorisation/MilestoneAuthorisation.
      await tx.pocketTransferAuthorisation.upsert({
        where: { transferId_authoriserId: { transferId: transfer.id, authoriserId: officerId } },
        update: {},
        create: { transferId: transfer.id, authoriserId: officerId },
      });

      const distinctApprovers = await tx.pocketTransferAuthorisation.count({ where: { transferId: transfer.id } });
      const [society, rosterSize] = await Promise.all([
        tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } }),
        this.committeeRosterSize(tx, societyId),
      ]);
      const approvalConfig = parseApprovalConfig(society.config);
      const required = requiredTransferApprovers(Number(transfer.amount), approvalConfig, rosterSize);

      // transfer.status is narrowed to PENDING here (EXECUTED returned
      // above, CANCELLED threw above) — no need to re-check it.
      let updated = transfer;
      if (distinctApprovers >= required) {
        // Money-safety guard, same shape as BulkBuyService.authorisePayout's
        // escrow check: never let a transfer drive its source pocket
        // negative. LedgerService.post itself has no such restriction (it's
        // a generic double-entry poster — see ledger-posting.util.ts's
        // validatePosting), so this is this module's own responsibility.
        const fromAccount = await this.ledger.getOrCreateAccount(societyId, transfer.fromKind, tx);
        if (new Decimal(fromAccount.balance).lessThan(transfer.amount)) {
          throw new BadRequestException(`Insufficient balance in ${transfer.fromKind} for this transfer`);
        }

        await this.ledger.post(
          {
            societyId,
            debitKind: transfer.fromKind,
            creditKind: transfer.toKind,
            amount: transfer.amount,
            reasonCode: 'POCKET_TRANSFER_EXECUTE',
            linkedEntityType: 'PocketTransfer',
            linkedEntityId: transfer.id,
          },
          tx,
        );

        updated = await tx.pocketTransfer.update({
          where: { id: transfer.id },
          data: { status: PocketTransferStatus.EXECUTED, executedAt: this.clock.now() },
        });

        // Stashed, not written yet — see below the transaction for why
        // (mirrors BulkBuyService.authorisePayout's identical pattern).
        executedAudit = {
          societyId,
          actorId: officerId,
          action: 'POCKET_TRANSFER_EXECUTED',
          subjectType: 'PocketTransfer',
          subjectId: transfer.id,
          payload: { fromKind: transfer.fromKind, toKind: transfer.toKind, amount: transfer.amount.toString(), distinctApprovers, required },
        };
      }

      return this.toDetail(tx, updated, distinctApprovers, required);
    });

    // Written AFTER the transaction commits, never from inside it — see
    // BulkBuyService.authorisePayout's identical comment.
    if (executedAudit) {
      await this.auditService.appendBestEffort(executedAudit);
    }

    return detail;
  }

  async cancel(societyId: string, transferId: string, _officerId: string): Promise<PocketTransferDetail> {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.pocketTransfer.findUnique({ where: { id: transferId } });
      if (!transfer || transfer.societyId !== societyId) {
        throw new NotFoundException('Pocket transfer not found');
      }
      if (transfer.status === PocketTransferStatus.CANCELLED) {
        return this.toDetail(tx, transfer);
      }
      if (transfer.status !== PocketTransferStatus.PENDING) {
        throw new BadRequestException(`Only a PENDING transfer can be cancelled (status=${transfer.status})`);
      }

      const cancelled = await tx.pocketTransfer.update({ where: { id: transfer.id }, data: { status: PocketTransferStatus.CANCELLED } });
      return this.toDetail(tx, cancelled);
    });
  }

  async get(societyId: string, transferId: string): Promise<PocketTransferDetail> {
    const transfer = await this.prisma.pocketTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.societyId !== societyId) {
      throw new NotFoundException('Pocket transfer not found');
    }
    return this.toDetail(this.prisma, transfer);
  }

  /**
   * Cursor-paginated + ETag-friendly listing — reuses the Phase 9.3 helpers
   * at `src/common/pagination/` untouched (see this module's task brief).
   * Ordered `createdAt DESC, id DESC` (newest first, tiebroken by id — both
   * always non-null, so unlike BillsService's dueDate-based ordering there
   * is no NULLS-LAST case to handle).
   */
  async list(societyId: string, params: ListPocketTransfersParams): Promise<PocketTransferPage> {
    const limit = parsePageLimit(params.limit);
    const status = this.parseStatus(params.status);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const cursorFilter: Prisma.PocketTransferWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.sortValue!) } },
            { createdAt: new Date(cursor.sortValue!), id: { lt: cursor.id } },
          ],
        }
      : undefined;

    const rows = await this.prisma.pocketTransfer.findMany({
      where: {
        societyId,
        ...(status ? { status } : {}),
        ...(cursorFilter ?? {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { items: pageRows, nextCursor } = buildPage(rows, limit, (row) => ({ sortValue: row.createdAt.toISOString(), id: row.id }));
    const items = await Promise.all(pageRows.map((row) => this.toDetail(this.prisma, row)));

    return { items, nextCursor };
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Mirrors BulkBuyService.committeeRosterSize exactly (that method is
   * private and not exported — see this module's task brief; this is a
   * deliberate, documented duplication, not a divergent reimplementation).
   * The count of DISTINCT users holding at least one of COMMITTEE/
   * TREASURER/DEPUTY_TREASURER in this society right now. Accepts either an
   * open `tx` (authoriseTransfer, always evaluated inside its own
   * advisory-locked transaction) or the plain PrismaService (every GET
   * route, which has no transaction open) — both expose the same `.role`
   * delegate shape.
   */
  private async committeeRosterSize(client: Prisma.TransactionClient | PrismaService, societyId: string): Promise<number> {
    const officers = await client.role.findMany({
      where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return officers.length;
  }

  private parseStatus(raw: string | undefined): PocketTransferStatus | null {
    if (raw === undefined) return null;
    if (!Object.values(PocketTransferStatus).includes(raw as PocketTransferStatus)) {
      throw new BadRequestException(`status must be one of ${Object.values(PocketTransferStatus).join(', ')}`);
    }
    return raw as PocketTransferStatus;
  }

  private async toDetail(
    client: Prisma.TransactionClient | PrismaService,
    transfer: PocketTransferModel,
    knownAuthorisedCount?: number,
    knownRequired?: number,
  ): Promise<PocketTransferDetail> {
    if (knownAuthorisedCount !== undefined && knownRequired !== undefined) {
      return { ...transfer, authorisedCount: knownAuthorisedCount, requiredApprovers: knownRequired };
    }

    const [authorisedCount, society, rosterSize] = await Promise.all([
      client.pocketTransferAuthorisation.count({ where: { transferId: transfer.id } }),
      client.society.findUniqueOrThrow({ where: { id: transfer.societyId }, select: { config: true } }),
      this.committeeRosterSize(client, transfer.societyId),
    ]);
    const approvalConfig = parseApprovalConfig(society.config);
    const requiredApproversCount = requiredTransferApprovers(Number(transfer.amount), approvalConfig, rosterSize);

    return { ...transfer, authorisedCount, requiredApprovers: requiredApproversCount };
  }
}
