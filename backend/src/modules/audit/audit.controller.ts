import { BadRequestException, Controller, Get, Headers, HttpStatus, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import { parsePageLimit } from '../../common/pagination/cursor.util.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { AuditLogModel } from '../../generated/prisma/models.js';
import { AuditService } from './audit.service.js';

export interface VerifyChainResponse {
  ok: boolean;
  verifiedThrough: number;
  /** Hex-encoded tail hash — the recomputed chain tail (see AuditService.verifyChain). */
  tailHash: string;
  firstDivergence: { id: string; sequence: number } | null;
}

/** One audit-log entry, hex-encoding the hash-chain fields (see AuditLogsPage's doc comment on `GET /audit/logs`). */
export interface AuditLogEntryResponse {
  sequence: number;
  ts: string;
  action: string;
  subjectType: string;
  subjectId: string;
  actorId: string | null;
  payload: unknown;
  previousHash: string;
  entryHash: string;
}

export interface AuditLogsPageResponse {
  items: AuditLogEntryResponse[];
  nextCursor: string | null;
}

function toEntryResponse(row: AuditLogModel): AuditLogEntryResponse {
  return {
    sequence: row.sequence,
    ts: row.ts.toISOString(),
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    actorId: row.actorId,
    payload: row.payload,
    previousHash: Buffer.from(row.previousHash).toString('hex'),
    entryHash: Buffer.from(row.entryHash).toString('hex'),
  };
}

function parseIsoDate(raw: string | undefined, field: string): Date | undefined {
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO-8601 date`);
  }
  return date;
}

function parseCursorSequence(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new BadRequestException('Invalid cursor');
  }
  return n;
}

/**
 * Surfaces AuditService.verifyChain() (BACKEND_PLAN.md Phase 6.5) to every
 * resident: the hash-chained audit log is one of the dissertation's four
 * novelty claims (DESIGN.md §1a.4), and re-verifying it end to end is cheap
 * enough to expose on demand rather than keep as an internal-only check.
 *
 * Scoped to the caller's own society — a resident can only verify the chain
 * they're themselves a member of, same scoping rule as every other
 * resident-facing route (see VendorsController for the pattern).
 *
 * Lane b1read (Phase 11/12) adds `GET /audit/logs` and `GET
 * /audit/logs/:sequence` below `verify`, UNCHANGED — audit-log browsing for
 * committee officers. Unlike `verify` (any resident), these two are
 * officer-gated (`@ResidentOnly()` + `@Roles(TREASURER, DEPUTY_TREASURER,
 * COMMITTEE)`) and NEVER accept a societyId param: the caller's own society
 * is always the hard scope, both in the filter (`queryLogs`) and in the
 * single-entry lookup (`getLogBySequence` — a match in another society is
 * treated as not found, never as a 403 that would leak its existence).
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('verify')
  @UseGuards(AuthGuard)
  async verify(@CurrentResident() currentUser: ResidentPrincipal): Promise<VerifyChainResponse> {
    const result = await this.auditService.verifyChain(currentUser.societyId);
    return {
      ok: result.ok,
      verifiedThrough: result.verifiedThrough,
      tailHash: result.tailHash.toString('hex'),
      firstDivergence: result.firstDivergence,
    };
  }

  @Get('logs')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async listLogs(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('action') action: string | undefined,
    @Query('subjectType') subjectType: string | undefined,
    @Query('subjectId') subjectId: string | undefined,
    @Query('actorId') actorId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuditLogsPageResponse | undefined> {
    const parsedLimit = parsePageLimit(limit);
    const cursorSequence = parseCursorSequence(cursor);
    const fromDate = parseIsoDate(from, 'from');
    const toDate = parseIsoDate(to, 'to');

    const page = await this.auditService.queryLogs(
      currentUser.societyId,
      { action, subjectType, subjectId, actorId, from: fromDate, to: toDate },
      cursorSequence,
      parsedLimit,
    );
    const response: AuditLogsPageResponse = { items: page.items.map(toEntryResponse), nextCursor: page.nextCursor };

    const etag = computeEtag(response);
    res.set('ETag', etag);
    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return response;
  }

  @Get('logs/:sequence')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async getLog(@CurrentResident() currentUser: ResidentPrincipal, @Param('sequence') sequenceRaw: string): Promise<AuditLogEntryResponse> {
    const sequence = Number(sequenceRaw);
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new BadRequestException('sequence must be a non-negative integer');
    }
    const row = await this.auditService.getLogBySequence(currentUser.societyId, sequence);
    if (!row) {
      throw new NotFoundException('Audit log entry not found');
    }
    return toEntryResponse(row);
  }
}
