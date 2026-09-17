import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { WaterSourceModel } from '../../generated/prisma/models.js';
import { RecordWaterSourceDto } from './dto/record-water-source.dto.js';
import { WaterService } from './water.service.js';

/**
 * Phase 10 — water-source config plane. `@Roles(...)`/`@SocietyScope()` are
 * per-method, not hoisted to the class — see MaintenanceController/
 * BankStatementsController's identical note; these routes carry no `:sid`
 * path param, so `@SocietyScope()` here is a documented no-op kept for
 * consistency/future-proofing.
 */
@Controller('water-sources')
export class WaterController {
  constructor(private readonly water: WaterService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  @AuditLog('WATER_SOURCE_RECORD', 'WaterSource')
  async recordSource(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: RecordWaterSourceDto): Promise<WaterSourceModel> {
    return this.water.recordSource(currentUser.societyId, dto);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('period') period?: string,
    @Query('billingCycleId') billingCycleId?: string,
  ): Promise<WaterSourceModel[]> {
    return this.water.list(currentUser.societyId, { period, billingCycleId });
  }
}
