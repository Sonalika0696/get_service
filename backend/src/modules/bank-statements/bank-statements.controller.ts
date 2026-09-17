import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import { IngestBankStatementDto } from './dto/ingest-bank-statement.dto.js';
import { AllocateBankStatementLineDto } from './dto/allocate-bank-statement-line.dto.js';
import {
  BankStatementsService,
  type BankStatementIngestResult,
  type BankStatementLineDetail,
  type BankStatementLinesPage,
} from './bank-statements.service.js';

/**
 * Phase 9.5 (BACKEND_HANDOFF.md §6 / 9.5) — bank-statement ingestion and the
 * treasurer allocate queue. Every route is TREASURER/COMMITTEE-gated.
 * `@Roles(...)`/`@SocietyScope()` are per-method, not hoisted to the class —
 * see MaintenanceController's identical note (both RolesGuard and
 * SocietyScopeGuard read handler-level metadata only). These routes carry
 * no `:sid` path param (society is always taken from the caller's own
 * session, like every other committee-gated route in this codebase), so
 * `@SocietyScope()` here is a documented no-op kept for consistency/
 * future-proofing, exactly like MaintenanceController's.
 *
 * No `@AuditLog(...)` on ingest/allocate/ignore — BankStatementsService
 * writes its own richer AuditService entries directly (see its doc
 * comment), same reasoning as FlatsService.importCsv / LedgerService.
 * rebuildBalances.
 */
@Controller('bank-statements')
export class BankStatementsController {
  constructor(private readonly bankStatements: BankStatementsService) {}

  @Post('ingest')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async ingest(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: IngestBankStatementDto): Promise<BankStatementIngestResult> {
    return this.bankStatements.ingestCsv(currentUser.societyId, currentUser.id, dto.csv);
  }

  @Get('lines')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BankStatementLinesPage | undefined> {
    const page = await this.bankStatements.list(currentUser.societyId, { status, cursor, limit });
    const etag = computeEtag(page);
    res.set('ETag', etag);

    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return page;
  }

  @Post('lines/:id/allocate')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async allocate(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: AllocateBankStatementLineDto): Promise<BankStatementLineDetail> {
    return this.bankStatements.allocate(currentUser.societyId, id, currentUser.id, dto);
  }

  @Post('lines/:id/ignore')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async ignore(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BankStatementLineDetail> {
    return this.bankStatements.ignore(currentUser.societyId, id, currentUser.id);
  }

  /**
   * Sends the CSV body directly via `res.send` (not a `passthrough` return
   * value) so the `text/csv` Content-Type actually sticks — Nest's default
   * response handling would otherwise treat a returned string as JSON.
   */
  @Get('export')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async exportCsv(@CurrentResident() currentUser: ResidentPrincipal, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response): Promise<void> {
    const csv = await this.bankStatements.exportCsv(currentUser.societyId, { from, to });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="bank-statement-export.csv"');
    res.status(HttpStatus.OK).send(csv);
  }
}
