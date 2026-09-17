import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../../common/guards/principal.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../../common/decorators/principal.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../../common/types/current-user.js';
import { RoleKind } from '../../../generated/prisma/enums.js';
import type { ReadingModel } from '../../../generated/prisma/models.js';
import { CaptureReadingDto } from './dto/capture-reading.dto.js';
import { IngestReadingsDto } from './dto/ingest-readings.dto.js';
import { ReadingsService, type IngestReadingsResult } from './readings.service.js';

/**
 * Phase 10 — meter-reading routes. `@Roles(...)`/`@SocietyScope()` are
 * per-method, not hoisted to the class (see MetersController's identical
 * note). No `@AuditLog(...)` on capture/reverse/ingest — ReadingsService
 * writes its own richer, atomically-chained AuditService-equivalent entries
 * directly (see ReadingsService's doc comment), the same reasoning
 * BankStatementsController documents for its own ingest/allocate/ignore.
 */
@Controller()
export class ReadingsController {
  constructor(private readonly readings: ReadingsService) {}

  @Post('meters/:id/readings')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async capture(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') meterId: string, @Body() dto: CaptureReadingDto): Promise<ReadingModel> {
    return this.readings.capture(currentUser.societyId, meterId, dto, currentUser.id);
  }

  @Post('readings/:id/reverse')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async reverse(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') readingId: string): Promise<ReadingModel> {
    return this.readings.reverse(currentUser.societyId, readingId, currentUser.id);
  }

  @Post('readings/ingest')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async ingest(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: IngestReadingsDto): Promise<IngestReadingsResult> {
    return this.readings.ingestCsv(currentUser.societyId, dto.csv, currentUser.id);
  }

  @Get('meters/:id/readings')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async listForMeter(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') meterId: string): Promise<ReadingModel[]> {
    return this.readings.listForMeter(currentUser.societyId, meterId);
  }
}
