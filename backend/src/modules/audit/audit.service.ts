import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { canonicalJsonStringify } from '../../common/util/canonical-json.js';
import { GENESIS_HASH, sha256, toPrismaBytes } from '../../common/util/hash.js';
import type { AuditLogModel } from '../../generated/prisma/models.js';

export interface AppendAuditLogInput {
  societyId: string;
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload: object;
}

export interface ChainVerificationResult {
  ok: boolean;
  verifiedThrough: number;
  tailHash: Buffer;
  /** Set only when ok is false. */
  firstDivergence: { id: string; sequence: number } | null;
}

/**
 * Hash-chained append-only audit log (DESIGN.md §1a.4 — one of the
 * dissertation's four novelty claims). Every row's entryHash commits to the
 * previous row's hash and this row's content, so any edit to any past row
 * is detectable by recomputing forward from genesis.
 *
 * The chain is scoped per society. Writes take a Postgres advisory lock
 * keyed on the society so concurrent appends can't race to read the same
 * "previous" tail hash.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendAuditLogInput): Promise<AuditLogModel> {
    return this.prisma.$transaction(async (tx) => {
      // Advisory lock namespace 42 = "audit chain"; released automatically at
      // transaction end. hashtext() folds the society id to an int4 key.
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

      const row = await tx.auditLog.create({
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

      return row;
    });
  }

  /**
   * Recomputes the chain forward from genesis and reports the first row
   * whose stored hash doesn't match what's recomputed (or null if intact).
   * Independent of the cached Society.auditTailHash — also cross-checks it.
   */
  async verifyChain(societyId: string): Promise<ChainVerificationResult> {
    const rows = await this.prisma.auditLog.findMany({
      where: { societyId },
      orderBy: { sequence: 'asc' },
    });

    let expectedPrevious = GENESIS_HASH;
    for (const row of rows) {
      const storedPrevious = Buffer.from(row.previousHash);
      if (!storedPrevious.equals(expectedPrevious)) {
        return { ok: false, verifiedThrough: row.sequence - 1, tailHash: expectedPrevious, firstDivergence: { id: row.id, sequence: row.sequence } };
      }

      const canonicalPayload = canonicalJsonStringify({
        ts: row.ts.toISOString(),
        societyId: row.societyId,
        actorId: row.actorId,
        action: row.action,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        payload: row.payload,
      });
      const recomputed = sha256(storedPrevious, Buffer.from(canonicalPayload, 'utf8'));
      const storedEntry = Buffer.from(row.entryHash);
      if (!recomputed.equals(storedEntry)) {
        return { ok: false, verifiedThrough: row.sequence - 1, tailHash: expectedPrevious, firstDivergence: { id: row.id, sequence: row.sequence } };
      }

      expectedPrevious = storedEntry;
    }

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { auditTailHash: true } });
    const cachedTail = society.auditTailHash ? Buffer.from(society.auditTailHash) : GENESIS_HASH;
    if (!cachedTail.equals(expectedPrevious)) {
      this.logger.warn(`Society ${societyId}: cached auditTailHash diverges from recomputed chain tail`);
      return { ok: false, verifiedThrough: rows.length, tailHash: expectedPrevious, firstDivergence: null };
    }

    return { ok: true, verifiedThrough: rows.length, tailHash: expectedPrevious, firstDivergence: null };
  }
}
