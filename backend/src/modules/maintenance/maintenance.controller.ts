import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { IdempotencyService } from '../ledger/idempotency.service.js';
import { RoleKind, MaintenanceChargeStatus } from '../../generated/prisma/enums.js';
import type { MaintenanceChargeModel, InstalmentPlanModel } from '../../generated/prisma/models.js';
import { GenerateMaintenanceDto } from './dto/generate-maintenance.dto.js';
import { AccrueLateFeesDto } from './dto/accrue-late-fees.dto.js';
import { CreateInstalmentPlanDto } from './dto/create-instalment-plan.dto.js';
import { MaintenanceBillingService, type GenerateForPeriodResult } from './maintenance-billing.service.js';

/**
 * Phase 9.2 (BACKEND_HANDOFF.md §6 / 9.2) — maintenance billing routes.
 * `@Roles(...)`/`@SocietyScope()` are per-method, not hoisted to the class
 * — see SocietyRolesController/ServiceRequestsController's identical note;
 * these routes carry no `:sid` path param (society is always taken from
 * the caller's own session, like every other committee-gated route in this
 * codebase), so `@SocietyScope()` here is a documented no-op kept for
 * consistency/future-proofing, exactly like ServiceRequestsController's
 * assignVendor.
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceBillingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Generates one MaintenanceCharge per flat for `period` — idempotent, safe to re-run. */
  @Post('generate')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  @AuditLog('MAINTENANCE_GENERATE_REQUEST', 'MaintenanceCharge')
  async generate(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Body() dto: GenerateMaintenanceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<GenerateForPeriodResult> {
    if (!idempotencyKey) {
      return this.maintenance.generateForPeriod(currentUser.societyId, dto.period, { dueDay: dto.dueDay });
    }
    const { body } = await this.idempotency.runOnce<GenerateForPeriodResult>('maintenance:generate', idempotencyKey, currentUser.societyId, async () => {
      const result = await this.maintenance.generateForPeriod(currentUser.societyId, dto.period, { dueDay: dto.dueDay });
      return { status: 201, body: result };
    });
    return body;
  }

  /** Accrues late fees on every PENDING/PARTIAL charge past its due date. */
  @Post('accrue-late-fees')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  @AuditLog('MAINTENANCE_ACCRUE_LATE_FEES', 'MaintenanceCharge')
  async accrueLateFees(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: AccrueLateFeesDto): Promise<{ updated: number }> {
    const asOf = dto.asOf ? new Date(dto.asOf) : undefined;
    const updated = await this.maintenance.accrueLateFees(currentUser.societyId, asOf);
    return { updated };
  }

  /**
   * Resident-self instalment plan on their OWN charge, OR a committee/
   * treasurer officer on any charge in the society — picked over
   * committee-only because splitting one's own bill into instalments is
   * fundamentally a resident self-service action (mirrors how a resident
   * signs off their own JobCard in bulk-buy), with the officer path kept
   * for a committee member setting one up on a resident's behalf.
   */
  @Post('charges/:id/instalment-plan')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('MAINTENANCE_INSTALMENT_PLAN_CREATE', 'MaintenanceCharge')
  async createInstalmentPlan(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: CreateInstalmentPlanDto): Promise<InstalmentPlanModel> {
    const isOfficer = currentUser.roleKinds.includes(RoleKind.TREASURER) || currentUser.roleKinds.includes(RoleKind.COMMITTEE) || currentUser.roleKinds.includes(RoleKind.DEPUTY_TREASURER);
    if (!isOfficer) {
      // Resident-self path: 403/404 here if this isn't their own flat's
      // charge, before createInstalmentPlan (which only checks
      // societyId, not flat ownership) ever runs.
      await this.maintenance.assertResidentOwnsCharge(currentUser.societyId, currentUser.id, id);
    }
    // Officer path (or a resident who just passed the ownership check):
    // createInstalmentPlan itself re-checks charge.societyId === societyId,
    // 404ing on a cross-society id — no separate pre-check needed here.
    return this.maintenance.createInstalmentPlan(currentUser.societyId, id, dto.instalments);
  }

  /** Committee/treasurer listing, optionally filtered by period/status. */
  @Get('charges')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE, RoleKind.DEPUTY_TREASURER)
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query('period') period?: string, @Query('status') status?: string): Promise<MaintenanceChargeModel[]> {
    if (status && !Object.values(MaintenanceChargeStatus).includes(status as MaintenanceChargeStatus)) {
      throw new BadRequestException(`status must be one of ${Object.values(MaintenanceChargeStatus).join(', ')}`);
    }
    return this.maintenance.list(currentUser.societyId, period, status as MaintenanceChargeStatus | undefined);
  }
}
