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
import { BillingCycleService, type BillingCycleDetail } from './billing-cycle.service.js';
import { OpenBillingCycleDto } from './dto/open-billing-cycle.dto.js';
import { ReconcileBillingCycleDto } from './dto/reconcile-billing-cycle.dto.js';
import { ListBillingCyclesQuery } from './dto/list-billing-cycles.query.js';

/**
 * Phase 10 CAPSTONE — the billing-cycle pipeline's HTTP surface. Every route
 * is TREASURER/COMMITTEE-gated, same guard stack/`@SocietyScope()` no-op
 * convention as BankStatementsController (society is always the caller's
 * own session, never a `:sid` path param).
 */
@Controller('billing-cycles')
export class BillingCycleController {
  constructor(private readonly billingCycles: BillingCycleService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async open(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: OpenBillingCycleDto): Promise<BillingCycleDetail> {
    return this.billingCycles.open(currentUser.societyId, dto);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query() query: ListBillingCyclesQuery): Promise<BillingCycleDetail[]> {
    return this.billingCycles.list(currentUser.societyId, query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BillingCycleDetail> {
    return this.billingCycles.get(currentUser.societyId, id);
  }

  @Post(':id/run')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async run(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BillingCycleDetail> {
    return this.billingCycles.run(currentUser.societyId, id);
  }

  @Post(':id/reconcile')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  async reconcile(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: ReconcileBillingCycleDto): Promise<BillingCycleDetail> {
    return this.billingCycles.reconcileInvoice(currentUser.societyId, id, dto);
  }
}
