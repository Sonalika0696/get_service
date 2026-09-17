import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { VirtualAccountsService, type VirtualAccountBackfillResult, type VirtualAccountDetail } from './virtual-accounts.service.js';

/**
 * Phase 9.1 operator surface for VirtualAccount provisioning. Same
 * `operator/societies/:sid/...` shape as FlatsController/AccountsController
 * — kept as its own controller (rather than folded into FlatsController)
 * because it lives in this new virtual-accounts module rather than the
 * operator module, so VirtualAccountsService's Prisma access and audit
 * wiring have exactly one home.
 */
@Controller('operator/societies/:sid/virtual-accounts')
@UseGuards(AuthGuard, PrincipalGuard)
@OperatorOnly()
export class VirtualAccountsOperatorController {
  constructor(private readonly virtualAccounts: VirtualAccountsService) {}

  /**
   * Idempotent: creates a VirtualAccount for every pre-existing flat in the
   * society that doesn't already have one. Re-running after every flat is
   * covered creates zero rows. No `@AuditLog(...)` — the service writes its
   * own compact summary, same pattern as FlatsService.importCsv.
   */
  @Post('backfill')
  async backfill(@CurrentUser() operator: CurrentUserContext, @Param('sid') sid: string): Promise<VirtualAccountBackfillResult> {
    return this.virtualAccounts.backfillSociety(sid, operator.id);
  }

  /** Operator read of one flat's VirtualAccount — mirrors the committee-scoped GET /flats/:id/virtual-account, for operator-side support/debugging. */
  @Get(':flatId')
  async get(@Param('sid') sid: string, @Param('flatId') flatId: string): Promise<VirtualAccountDetail> {
    return this.virtualAccounts.getForFlatAsOperator(sid, flatId);
  }
}
