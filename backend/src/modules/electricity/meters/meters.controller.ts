import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import type { MeterModel } from '../../../generated/prisma/models.js';
import { RegisterMeterDto } from './dto/register-meter.dto.js';
import { ListMetersQuery } from './dto/list-meters.query.js';
import { MetersService } from './meters.service.js';

/**
 * Phase 10 — meter registry routes. `@Roles(...)`/`@SocietyScope()` are
 * per-method, not hoisted to the class — see MaintenanceController/
 * BankStatementsController's identical note (RolesGuard and
 * SocietyScopeGuard only read handler-level metadata). No `:sid` path
 * param — society always comes from the caller's own session, so
 * `@SocietyScope()` is a documented no-op kept for consistency, exactly like
 * those controllers'.
 */
@Controller('meters')
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async register(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: RegisterMeterDto): Promise<MeterModel> {
    return this.meters.register(currentUser.societyId, dto);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query() query: ListMetersQuery): Promise<MeterModel[]> {
    return this.meters.list(currentUser.societyId, query);
  }

  @Post(':id/retire')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async retire(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<MeterModel> {
    return this.meters.retire(currentUser.societyId, id);
  }
}
