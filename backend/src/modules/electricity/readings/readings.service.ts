import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { Clock } from '../../../infra/clock/clock.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { MeterStatus, ReadingSource } from '../../../generated/prisma/enums.js';
import type { ReadingModel } from '../../../generated/prisma/models.js';
import { canonicalJsonStringify } from '../../../common/util/canonical-json.js';
import { GENESIS_HASH, sha256, toPrismaBytes } from '../../../common/util/hash.js';
import { MetersService } from '../meters/meters.service.js';
import { parseReadingCsv } from './reading-csv.util.js';
import type { CaptureReadingDto } from './dto/capture-reading.dto.js';

export interface IngestReadingsResult {
  created: number;
  errors: { line: number; message: string }[];
  unmatchedSerials: string[];
}

interface AuditAppendInput {
  societyId: string;
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  payload: object;
}

/**
 * Phase 10 (BACKEND_HANDOFF.md / SOFTWARE_DESIGN.md §"electricity/water") —
 * meter-reading capture. Readings are append-only: `capture` creates a row,
 * `reverse` posts a NEW row correcting an earlier one (never mutates/
 * deletes), and `ingestCsv` bulk-creates from a `serial,value[,capturedAt]`
 * file (reading-csv.util.ts — pure, unit-tested separately).
 *
 * AUDIT-AT-CAPTURE (schema.prisma's `ReadingSource` doc comment: "Both are
 * audit-chained at capture"): every Reading this service creates gets an
 * AuditLog row chained atomically in the SAME database transaction as the
 * Reading itself — never a Reading without a matching audit entry, or vice
 * versa. AuditService.append (see modules/audit/audit.service.ts) can't be
 * reused directly for this: it always opens its OWN `$transaction` via the
 * top-level PrismaService, so calling it from inside an already-open
 * transaction would run on a second, independent connection — exactly the
 * non-atomicity this design forbids. Every other caller in this codebase
 * sidesteps that by using `appendBestEffort` AFTER the commit (best-effort,
 * never blocking or reversing an already-committed mutation) — deliberately
 * not "at capture" semantics. Rather than modify the shared AuditService
 * (out of this lane's scope: HARD CONSTRAINTS permit editing app.module.ts
 * only), `appendAuditInTx` below replicates AuditService.append's exact
 * hash-chain algorithm — same advisory-lock namespace (42, "audit chain"),
 * same canonical payload shape, same Society.auditTailHash cache — but
 * against the CALLER's own `Prisma.TransactionClient`, so the audit row and
 * the Reading row commit or roll back together. `GET /audit/verify`
 * (AuditService.verifyChain) can't tell these entries apart from ones
 * AuditService.append wrote itself — same table, same chain, same hash
 * function.
 */
@Injectable()
export class ReadingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly meters: MetersService,
  ) {}

  /**
   * Same chain-hash algorithm as AuditService.append (see this class's doc
   * comment for why it's reimplemented here rather than called): takes the
   * advisory lock, reads+extends Society.auditTailHash, and inserts the
   * AuditLog row — all via the supplied `tx`, so it's part of whatever
   * transaction the caller is already inside.
   */
  private async appendAuditInTx(tx: Prisma.TransactionClient, input: AuditAppendInput): Promise<void> {
    // Advisory lock namespace 42 = "audit chain", same as AuditService.append
    // — pg_advisory_xact_lock is reentrant within one transaction/session, so
    // ingestCsv's loop (multiple readings, one shared tx) is safe to call
    // this more than once. Auto-released at this tx's commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(42, hashtext(${input.societyId}))`;

    const society = await tx.society.findUniqueOrThrow({
      where: { id: input.societyId },
      select: { auditTailHash: true },
    });
    const previousHash = society.auditTailHash ? Buffer.from(society.auditTailHash) : GENESIS_HASH;

    const ts = new Date();
    const canonicalPayload = canonicalJsonStringify({
      ts: ts.toISOString(),
      societyId: input.societyId,
      actorId: input.actorId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload: input.payload,
    });
    const entryHash = sha256(previousHash, Buffer.from(canonicalPayload, 'utf8'));

    await tx.auditLog.create({
      data: {
        ts,
        societyId: input.societyId,
        actorId: input.actorId,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload as never,
        previousHash: toPrismaBytes(previousHash),
        entryHash: toPrismaBytes(entryHash),
      },
    });

    await tx.society.update({
      where: { id: input.societyId },
      data: { auditTailHash: toPrismaBytes(entryHash) },
    });
  }

  /**
   * Captures a manual reading against `meterId`. The meter must belong to
   * `societyId` and not be RETIRED (MetersService.assertActiveMeter). The
   * Reading row and its audit-chain entry are created in one transaction —
   * see this class's doc comment.
   */
  async capture(societyId: string, meterId: string, dto: CaptureReadingDto, userId: string): Promise<ReadingModel> {
    const meter = await this.meters.assertActiveMeter(societyId, meterId);

    return this.prisma.$transaction(async (tx) => {
      const reading = await tx.reading.create({
        data: {
          meterId: meter.id,
          value: dto.value,
          capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : this.clock.now(),
          capturedById: userId,
          source: ReadingSource.MANUAL,
          billingCycleId: dto.billingCycleId ?? null,
        },
      });

      await this.appendAuditInTx(tx, {
        societyId,
        actorId: userId,
        action: 'READING_CAPTURED',
        subjectType: 'Reading',
        subjectId: reading.id,
        payload: {
          meterId: meter.id,
          value: reading.value.toString(),
          source: reading.source,
          capturedAt: reading.capturedAt.toISOString(),
        },
      });

      return reading;
    });
  }

  /**
   * Append-only correction: posts a NEW Reading linked via
   * `reversesReadingId`, mirroring the original's value so downstream
   * consumption nets to zero across the pair. The original row is never
   * mutated or deleted. Audited atomically in the same transaction, same as
   * `capture`.
   */
  async reverse(societyId: string, readingId: string, userId: string): Promise<ReadingModel> {
    const original = await this.prisma.reading.findUnique({
      where: { id: readingId },
      include: { meter: true },
    });
    if (!original || original.meter.societyId !== societyId) {
      throw new NotFoundException('Reading not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const reversing = await tx.reading.create({
        data: {
          meterId: original.meterId,
          value: original.value,
          capturedAt: this.clock.now(),
          capturedById: userId,
          source: original.source,
          billingCycleId: original.billingCycleId,
          reversesReadingId: original.id,
        },
      });

      await this.appendAuditInTx(tx, {
        societyId,
        actorId: userId,
        action: 'READING_REVERSED',
        subjectType: 'Reading',
        subjectId: reversing.id,
        payload: {
          reversesReadingId: original.id,
          meterId: original.meterId,
          value: reversing.value.toString(),
        },
      });

      return reversing;
    });
  }

  /**
   * Bulk-imports readings from a `serial,value[,capturedAt]` CSV
   * (reading-csv.util.ts does the pure parsing/validation). Never throws on
   * a bad row: a syntactically bad row (from `parseReadingCsv`), an unknown
   * serial, or a RETIRED meter is reported in `errors`/`unmatchedSerials`
   * and simply skipped. All successfully-matched rows are written (Reading +
   * audit-chain entry per row) inside ONE transaction — a DB-level failure
   * partway rolls back every row from this call, mirroring
   * BankStatementsService.ingestCsv's "good rows are written atomically as a
   * batch" contract.
   */
  async ingestCsv(societyId: string, csv: string, userId: string): Promise<IngestReadingsResult> {
    const { rows, errors: parseErrors } = parseReadingCsv(csv);
    const errors: { line: number; message: string }[] = [...parseErrors];
    const unmatchedSerials = new Set<string>();

    const meters = await this.prisma.meter.findMany({ where: { societyId } });
    const meterBySerial = new Map(meters.map((m) => [m.serial, m]));

    // parseReadingCsv's ParsedReadingRow doesn't carry the row's original
    // physical line number (only its own syntax-error entries do — see its
    // doc comment). For the semantic errors below (unknown serial, retired
    // meter) we approximate the line as the row's 1-based position among the
    // successfully-parsed rows, offset past the header when present. This is
    // exact when the file has no syntactically-bad rows ahead of it; with
    // such rows present the number may drift from the true file line — an
    // accepted trade-off given the pure CSV util is frozen/out of this
    // lane's scope to change.
    const headerOffset = /^serial\s*,\s*value/i.test(csv.trimStart()) ? 2 : 1;

    const toCreate: { meterId: string; value: number; capturedAt: string | undefined }[] = [];
    rows.forEach((row, idx) => {
      const approxLine = idx + headerOffset;
      const meter = meterBySerial.get(row.serial);
      if (!meter) {
        unmatchedSerials.add(row.serial);
        errors.push({ line: approxLine, message: `no meter with serial "${row.serial}" found in this society` });
        return;
      }
      if (meter.status === MeterStatus.RETIRED) {
        errors.push({ line: approxLine, message: `meter "${row.serial}" is retired and cannot accept new readings` });
        return;
      }
      toCreate.push({ meterId: meter.id, value: row.value, capturedAt: row.capturedAt });
    });

    if (toCreate.length === 0) {
      return { created: 0, errors, unmatchedSerials: [...unmatchedSerials] };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of toCreate) {
        const reading = await tx.reading.create({
          data: {
            meterId: item.meterId,
            value: item.value,
            capturedAt: item.capturedAt ? new Date(item.capturedAt) : this.clock.now(),
            capturedById: userId,
            source: ReadingSource.CSV,
          },
        });

        await this.appendAuditInTx(tx, {
          societyId,
          actorId: userId,
          action: 'READING_CAPTURED',
          subjectType: 'Reading',
          subjectId: reading.id,
          payload: {
            meterId: item.meterId,
            value: reading.value.toString(),
            source: reading.source,
            capturedAt: reading.capturedAt.toISOString(),
          },
        });
      }
    });

    return { created: toCreate.length, errors, unmatchedSerials: [...unmatchedSerials] };
  }

  async listForMeter(societyId: string, meterId: string): Promise<ReadingModel[]> {
    await this.meters.findOwned(societyId, meterId);
    return this.prisma.reading.findMany({
      where: { meterId },
      orderBy: { capturedAt: 'desc' },
    });
  }
}
