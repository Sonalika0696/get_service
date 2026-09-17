import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, BankStatementLineStatus } from '../../generated/prisma/enums.js';
import type { BankStatementLineModel } from '../../generated/prisma/models.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import { parseBankStatementCsv } from './bank-statement-csv.util.js';
import { POCKET_KINDS, type PocketKind } from './pocket-kinds.js';
import type { AllocateBankStatementLineDto } from './dto/allocate-bank-statement-line.dto.js';

export interface BankStatementIngestResult {
  ingested: number;
  matched: number;
  unmatched: number;
  /** Per-row parse errors — rows that failed CSV validation and were NEVER written (see ingestCsv's doc comment: this is a partial-success import, unlike operator/flats.service.ts's all-or-nothing one). */
  errors: string[];
}

export interface BankStatementLineDetail {
  id: string;
  societyId: string;
  valueDate: string;
  amount: string;
  narration: string;
  reference: string | null;
  matchedFlatId: string | null;
  status: BankStatementLineStatus;
  allocatedById: string | null;
  allocatedAt: string | null;
  createdAt: string;
}

export interface BankStatementLinesPage {
  items: BankStatementLineDetail[];
  nextCursor: string | null;
}

export interface ListBankStatementLinesParams {
  status?: string;
  cursor?: string;
  limit?: string;
}

export interface ExportBankStatementParams {
  from?: string;
  to?: string;
}

function toDetail(line: BankStatementLineModel): BankStatementLineDetail {
  return {
    id: line.id,
    societyId: line.societyId,
    valueDate: line.valueDate.toISOString(),
    amount: line.amount.toString(),
    narration: line.narration,
    reference: line.reference,
    matchedFlatId: line.matchedFlatId,
    status: line.status,
    allocatedById: line.allocatedById,
    allocatedAt: line.allocatedAt ? line.allocatedAt.toISOString() : null,
    createdAt: line.createdAt.toISOString(),
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Phase 9.5 (BACKEND_HANDOFF.md §6 / 9.5) — bank-statement ingestion and the
 * treasurer allocate queue.
 *
 * MONEY-SAFETY (decision #6, load-bearing): bank-narration matching
 * (ingestCsv) is a SUBSTRING match of a line's `narration` against the
 * society's VirtualAccount `code`s and ONLY EVER narrows `matchedFlatId` —
 * it never posts to the ledger. Every line, matched or not, requires an
 * EXPLICIT treasurer `allocate()` call — the ONE method in this service (in
 * this entire module) that ever calls LedgerService.post. `ignore()` also
 * never posts.
 *
 * AMBIGUITY RULE: a narration matches when the society's VirtualAccount
 * `code` appears as a substring of it. If EXACTLY ONE VirtualAccount code
 * matches, the line is narrowed to that flat and marked MATCHED. If ZERO or
 * MORE THAN ONE code matches, the line is left UNMATCHED — an ambiguous
 * match (e.g. two flats whose codes happen to both appear, or a code that's
 * a prefix of another) is treated exactly like no match at all: a human
 * (the treasurer, via allocate's optional `flatId`) resolves it, this
 * service never guesses.
 */
@Injectable()
export class BankStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Parses `csvBody` (see bank-statement-csv.util.ts) and creates one
   * BankStatementLine per VALID row, inside a single transaction. Unlike
   * operator/flats.service.ts's importCsv (which rejects the WHOLE file on
   * any row error), this is a deliberate partial-success import: a
   * bank-statement file is an external artifact the treasurer can't simply
   * "fix and re-upload" the way an internal flat register can — a bank
   * export with one garbled row shouldn't block ingesting the other 500
   * good ones. Bad rows are reported in `errors` and never written; good
   * rows are written atomically as a batch (a DB-level failure mid-batch
   * rolls back every good row too, so the batch itself is still all-or-
   * nothing at the storage layer — only the CSV-VALIDATION step is
   * per-row-tolerant).
   *
   * NEVER posts to the ledger — see this class's doc comment.
   */
  async ingestCsv(societyId: string, actorId: string, csvBody: string): Promise<BankStatementIngestResult> {
    const society = await this.prisma.society.findUnique({ where: { id: societyId } });
    if (!society) throw new NotFoundException('Society not found');

    const { rows, errors } = parseBankStatementCsv(csvBody);

    let matched = 0;
    let unmatched = 0;

    const created = await this.prisma.$transaction(async (tx) => {
      const virtualAccounts = await tx.virtualAccount.findMany({ where: { societyId }, select: { code: true, flatId: true } });

      const lines: BankStatementLineModel[] = [];
      for (const row of rows) {
        const candidates = virtualAccounts.filter((va) => row.narration.includes(va.code));

        let matchedFlatId: string | null = null;
        let status: BankStatementLineStatus = BankStatementLineStatus.UNMATCHED;
        if (candidates.length === 1) {
          matchedFlatId = candidates[0].flatId;
          status = BankStatementLineStatus.MATCHED;
          matched += 1;
        } else {
          unmatched += 1;
        }

        const line = await tx.bankStatementLine.create({
          data: {
            societyId,
            valueDate: new Date(`${row.valueDate}T00:00:00.000Z`),
            amount: row.amount,
            narration: row.narration,
            reference: row.reference ?? null,
            matchedFlatId,
            status,
          },
        });
        lines.push(line);
      }
      return lines;
    });

    const result: BankStatementIngestResult = { ingested: created.length, matched, unmatched, errors };

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'BANK_STATEMENT_INGEST',
      subjectType: 'Society',
      subjectId: societyId,
      payload: result,
    });

    return result;
  }

  /**
   * The ONLY money-moving action in this module. Credits `dto.pocketKind`
   * (debiting EXTERNAL — the bank/PSP boundary, same direction as an
   * inbound Razorpay capture; see PaymentsService.applyCapture's identical
   * `debitKind: EXTERNAL` for a MaintenanceCharge-linked payment) for the
   * line's `amount`, flips the line to ALLOCATED, and stamps
   * allocatedById/allocatedAt — all inside one transaction, so a crash
   * between the ledger post and the status flip is impossible (the
   * invariant this whole module exists to protect: money never moves
   * without the line's own record agreeing it moved).
   *
   * `dto.flatId`, when supplied, always overrides the line's own
   * `matchedFlatId` and is persisted back onto the line — see
   * AllocateBankStatementLineDto's doc comment for the full flatId/
   * society-level-allocation rule.
   */
  async allocate(societyId: string, lineId: string, actorId: string, dto: AllocateBankStatementLineDto): Promise<BankStatementLineDetail> {
    if (!POCKET_KINDS.includes(dto.pocketKind as PocketKind)) {
      throw new BadRequestException(`pocketKind must be one of ${POCKET_KINDS.join(', ')}`);
    }

    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line || line.societyId !== societyId) {
      throw new NotFoundException('Bank statement line not found');
    }
    if (line.status === BankStatementLineStatus.ALLOCATED) {
      throw new ConflictException('This line has already been allocated');
    }

    const resolvedFlatId = dto.flatId ?? line.matchedFlatId ?? null;
    if (resolvedFlatId) {
      const flat = await this.prisma.flat.findUnique({ where: { id: resolvedFlatId } });
      if (!flat || flat.societyId !== societyId) {
        throw new BadRequestException('flatId does not belong to this society');
      }
    }

    const allocatedAt = this.clock.now();

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(
        {
          societyId,
          debitKind: AccountKind.EXTERNAL,
          creditKind: dto.pocketKind,
          amount: line.amount,
          reasonCode: 'BANK_STATEMENT_ALLOCATION',
          linkedEntityType: 'BankStatementLine',
          linkedEntityId: line.id,
        },
        tx,
      );

      return tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: BankStatementLineStatus.ALLOCATED,
          matchedFlatId: resolvedFlatId,
          allocatedById: actorId,
          allocatedAt,
        },
      });
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'BANK_STATEMENT_ALLOCATE',
      subjectType: 'BankStatementLine',
      subjectId: line.id,
      payload: { pocketKind: dto.pocketKind, flatId: resolvedFlatId, amount: line.amount.toString() },
    });

    return toDetail(updated);
  }

  /** Marks a line IGNORED — no money movement, ever. An already-ALLOCATED line can't be un-allocated this way (money already moved; see allocate's doc comment for why that transition is one-way). */
  async ignore(societyId: string, lineId: string, actorId: string): Promise<BankStatementLineDetail> {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line || line.societyId !== societyId) {
      throw new NotFoundException('Bank statement line not found');
    }
    if (line.status === BankStatementLineStatus.ALLOCATED) {
      throw new ConflictException('An already-allocated line cannot be ignored');
    }

    const updated = await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: { status: BankStatementLineStatus.IGNORED },
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'BANK_STATEMENT_IGNORE',
      subjectType: 'BankStatementLine',
      subjectId: line.id,
      payload: {},
    });

    return toDetail(updated);
  }

  /**
   * The treasurer allocate queue — cursor-paginated over `valueDate DESC,
   * id DESC` (most recent statement activity first), reusing
   * src/common/pagination/* exactly like BillsService.list (see its doc
   * comment for the shared cursor/ETag contract this module doesn't
   * reinvent).
   */
  async list(societyId: string, params: ListBankStatementLinesParams): Promise<BankStatementLinesPage> {
    const limit = parsePageLimit(params.limit);
    const status = this.parseStatus(params.status);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const where: Prisma.BankStatementLineWhereInput = { societyId };
    if (status) where.status = status;
    if (cursor) {
      // valueDate is never null on this model, so sortValue is always a real date string here.
      const cursorDate = new Date(cursor.sortValue as string);
      where.OR = [{ valueDate: { lt: cursorDate } }, { valueDate: cursorDate, id: { lt: cursor.id } }];
    }

    const rows = await this.prisma.bankStatementLine.findMany({
      where,
      orderBy: [{ valueDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const items = rows.map(toDetail);
    return buildPage(items, limit, (row) => ({ sortValue: row.valueDate, id: row.id }));
  }

  /** Statement history export — mirrors the import columns plus the status/allocation columns the treasurer needs to reconcile against what was actually posted. */
  async exportCsv(societyId: string, params: ExportBankStatementParams): Promise<string> {
    const where: Prisma.BankStatementLineWhereInput = { societyId };
    if (params.from || params.to) {
      where.valueDate = {};
      if (params.from) where.valueDate.gte = new Date(`${params.from}T00:00:00.000Z`);
      if (params.to) where.valueDate.lte = new Date(`${params.to}T23:59:59.999Z`);
    }

    const rows = await this.prisma.bankStatementLine.findMany({ where, orderBy: [{ valueDate: 'asc' }, { id: 'asc' }] });

    const header = 'valueDate,amount,narration,reference,status,matchedFlatId,allocatedById,allocatedAt';
    const lines = rows.map((row) =>
      [
        row.valueDate.toISOString().slice(0, 10),
        row.amount.toString(),
        csvEscape(row.narration),
        csvEscape(row.reference ?? ''),
        row.status,
        row.matchedFlatId ?? '',
        row.allocatedById ?? '',
        row.allocatedAt ? row.allocatedAt.toISOString() : '',
      ].join(','),
    );

    return [header, ...lines].join('\n') + '\n';
  }

  private parseStatus(raw: string | undefined): BankStatementLineStatus | null {
    if (raw === undefined) return null;
    if ((Object.values(BankStatementLineStatus) as string[]).includes(raw)) {
      return raw as BankStatementLineStatus;
    }
    throw new BadRequestException(`status must be one of ${Object.values(BankStatementLineStatus).join(', ')}`);
  }
}
