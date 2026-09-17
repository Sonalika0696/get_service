import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { RoleKind, Utility } from '../../generated/prisma/enums.js';
import type { TariffScheduleModel } from '../../generated/prisma/models.js';
import { CreateTariffScheduleDto } from './dto/create-tariff-schedule.dto.js';
import { TariffScheduleService } from './tariff-schedule.service.js';

/**
 * Phase 10 — electricity/water tariff-schedule config plane.
 * `@Roles(...)`/`@SocietyScope()` are per-method, not hoisted to the class
 * — see MaintenanceController/BankStatementsController's identical note;
 * these routes carry no `:sid` path param, so `@SocietyScope()` here is a
 * documented no-op kept for consistency/future-proofing.
 */
@Controller('tariffs')
export class TariffScheduleController {
  constructor(private readonly tariffs: TariffScheduleService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  @AuditLog('TARIFF_SCHEDULE_CREATE', 'TariffSchedule')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateTariffScheduleDto): Promise<TariffScheduleModel> {
    return this.tariffs.create(currentUser.societyId, dto, currentUser.id);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query('utility') utility?: string): Promise<TariffScheduleModel[]> {
    const parsedUtility = this.parseUtility(utility);
    return this.tariffs.list(currentUser.societyId, { utility: parsedUtility ?? undefined });
  }

  @Get('current')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async current(@CurrentResident() currentUser: ResidentPrincipal, @Query('utility') utility: string | undefined, @Query('period') period: string | undefined): Promise<TariffScheduleModel> {
    const parsedUtility = this.parseUtility(utility);
    if (!parsedUtility) {
      throw new BadRequestException(`utility must be one of ${Object.values(Utility).join(', ')}`);
    }
    if (!period) {
      throw new BadRequestException('period is required (YYYY-MM)');
    }
    return this.tariffs.currentFor(currentUser.societyId, parsedUtility, period);
  }

  private parseUtility(raw: string | undefined): Utility | null {
    if (raw === undefined) return null;
    if ((Object.values(Utility) as string[]).includes(raw)) {
      return raw as Utility;
    }
    throw new BadRequestException(`utility must be one of ${Object.values(Utility).join(', ')}`);
  }
}
