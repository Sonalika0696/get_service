import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { parseFlatCsv } from './flat-csv.util.js';
import type { ImportFlatsDto } from './dto/import-flats.dto.js';

export interface FlatImportResult {
  created: number;
  updated: number;
  total: number;
}

/**
 * Flat register CSV import (BACKEND_PLAN.md Phase 6.3 item 3;
 * DECISIONS_V2_SCOPE.md §1.4 puts flat import in the operator console).
 * Parsing/validation lives in flat-csv.util.ts (pure, unit-tested); this
 * service owns the DB side: existence check, atomic upsert, audit.
 *
 * Imports ONLY Flat's real columns — unitNo, maintenanceAmount. Phase 6.1
 * deliberately dropped `Flat.ownershipShare` ("area factor") from the
 * schema (see that migration's doc comment); this importer does not
 * resurrect it, and its apportionment-sums-to-unity validation stays
 * deferred to Phase 9 billing, per this phase's brief.
 *
 * DESIGN DECISION — upsert-by-unitNo, not reject-on-duplicate: the ordinary
 * reason to import the same society twice is a corrected or refreshed
 * register (a typo fix, an annual maintenance-amount revision), not an
 * accidental re-run. Rejecting the whole file whenever any unitNo already
 * exists would make re-importing useless for that ordinary case, and an
 * operator has no lighter-weight way to fix one flat's amount than
 * re-uploading the file. A duplicate unitNo WITHIN the same file is still
 * rejected outright (that's always a malformed file, never a legitimate
 * re-import). Existing Occupancy rows against a re-imported Flat are
 * untouched — only unitNo/maintenanceAmount change.
 *
 * Atomic: every row is fully validated before any row is written, and the
 * writes themselves run inside one $transaction — a file with row 47 wrong
 * writes nothing, not rows 1-46.
 */
@Injectable()
export class FlatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async importCsv(societyId: string, actorId: string, dto: ImportFlatsDto): Promise<FlatImportResult> {
    const society = await this.prisma.society.findUnique({ where: { id: societyId } });
    if (!society) throw new NotFoundException('Society not found');

    const { rows, errors } = parseFlatCsv(dto.csv);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'CSV import rejected — no rows were written; fix these and re-upload', errors });
    }

    const existing = await this.prisma.flat.findMany({
      where: { societyId, unitNo: { in: rows.map((r) => r.unitNo) } },
      select: { unitNo: true },
    });
    const existingSet = new Set(existing.map((f) => f.unitNo));

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.flat.upsert({
          where: { societyId_unitNo: { societyId, unitNo: row.unitNo } },
          create: { societyId, unitNo: row.unitNo, maintenanceAmount: row.maintenanceAmount },
          update: { maintenanceAmount: row.maintenanceAmount },
        });
      }
    });

    const result: FlatImportResult = {
      created: rows.filter((r) => !existingSet.has(r.unitNo)).length,
      updated: rows.filter((r) => existingSet.has(r.unitNo)).length,
      total: rows.length,
    };

    // Manual (not @AuditLog-decorator) append: the interceptor's default
    // payload is `{params, body}`, and `body` here is the raw CSV blob —
    // not a useful or size-bounded thing to put in the append-only audit
    // chain. A compact summary is far more useful anyway.
    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'FLAT_IMPORT',
      subjectType: 'Society',
      subjectId: societyId,
      payload: result,
    });

    return result;
  }
}
