import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { LedgerEntryModel } from '../../generated/prisma/models.js';
import { PostAdjustmentDto } from './dto/post-adjustment.dto.js';
import { LedgerService, type AccountBalance } from './ledger.service.js';
import { ReconciliationService, type ReconciliationReport } from './reconciliation.service.js';

@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  /**
   * Aggregates only, by design: account-kind balances for the caller's own
   * society plus a cheap integrity flag. Never exposes per-resident rows —
   * that's the whole point of keeping this COMMITTEE- rather than
   * resident-visible.
   */
  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  async getLedger(@CurrentResident() currentUser: ResidentPrincipal): Promise<{ balances: AccountBalance[]; balancesIntact: boolean }> {
    const [balances, verification] = await Promise.all([this.ledgerService.balances(currentUser.societyId), this.ledgerService.verifyBalances(currentUser.societyId)]);
    return { balances, balancesIntact: verification.ok };
  }

  @Get('reconciliation')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  async reconciliation(@CurrentResident() currentUser: ResidentPrincipal, @Query('date') date?: string): Promise<ReconciliationReport> {
    return this.reconciliationService.run(currentUser.societyId, date);
  }

  /**
   * Treasury tool + the proof-of-concept for unit-of-work + idempotency that
   * Phase 4B's payment posting will reuse: requires an `Idempotency-Key`
   * header, and replaying the same request with the same key returns the
   * identical prior response without creating a second LedgerEntry.
   */
  @Post('adjustments')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  @AuditLog('LEDGER_ADJUSTMENT', 'LedgerEntry')
  async postAdjustment(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: PostAdjustmentDto, @Headers('idempotency-key') idempotencyKey?: string): Promise<LedgerEntryModel> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const { entry } = await this.ledgerService.postAdjustment(currentUser.societyId, idempotencyKey, dto);
    return entry;
  }
}
