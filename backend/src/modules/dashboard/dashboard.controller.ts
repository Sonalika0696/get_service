import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ResidentOnly, OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { DashboardService, type OperatorDashboardKpis, type SocietyDashboardKpis } from './dashboard.service.js';

/**
 * Web-console dashboard KPI aggregate: one call for the top-row counts a
 * dashboard needs, instead of the console composing several requests
 * itself. Read-only — no writes, no `@AuditLog(...)`.
 *
 * Two routes with two different principal kinds live on this controller
 * (committee/treasurer resident vs. platform operator), so — like
 * LedgerController's `assertBalances` alongside its resident-only routes —
 * guards/principal decorators are specified per-handler rather than
 * hoisted to the class.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Committee-scoped KPIs for one society. Balances are included because
   * this route is gated the same way GET /ledger already is (COMMITTEE or
   * TREASURER) — see LedgerController.getLedger's doc comment on why
   * account-kind balances are committee-visible, not resident-wide.
   */
  @Get('society/:sid')
  @UseGuards(AuthGuard, PrincipalGuard, SocietyScopeGuard, RolesGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  async society(@Param('sid') sid: string): Promise<SocietyDashboardKpis> {
    return this.dashboardService.societyKpis(sid);
  }

  /**
   * Platform-wide KPIs. OPERATOR-only, and deliberately exposes only
   * cross-society COUNTS (societies/flats/residents/vendors/pending
   * ratifications) — no per-society financials, unlike the committee
   * route above which includes accountBalances for its own society only.
   */
  @Get('operator')
  @UseGuards(AuthGuard, PrincipalGuard)
  @OperatorOnly()
  async operator(): Promise<OperatorDashboardKpis> {
    return this.dashboardService.operatorKpis();
  }
}
