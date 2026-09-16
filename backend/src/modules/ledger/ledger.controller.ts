import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly, OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { LedgerEntryModel } from '../../generated/prisma/models.js';
import { PostAdjustmentDto } from './dto/post-adjustment.dto.js';
import {
  LedgerService,
  type AccountBalance,
  type BalanceAssertionSummary,
  type BalanceVerificationReport,
  type CashflowSeries,
  type RebuildResult,
} from './ledger.service.js';
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

  /**
   * Phase 6.5 Invariant I6 — surfaces LedgerService.verifyBalances()
   * (the balance-cache analogue of AuditService.verifyChain) to every
   * resident of the caller's own society, mirroring the just-shipped
   * `GET /audit/verify`: `AuthGuard` + `@CurrentResident()` only, no
   * `RolesGuard` — see AuditController.verify's doc comment for why that
   * route (and this one) is left open to any resident rather than gated to
   * COMMITTEE/TREASURER the way GET /ledger's aggregates are.
   */
  @Get('verify')
  @UseGuards(AuthGuard)
  async verify(@CurrentResident() currentUser: ResidentPrincipal): Promise<BalanceVerificationReport> {
    return this.ledgerService.verifyBalances(currentUser.societyId);
  }

  /**
   * Dated income/expense/net timeseries for the web console's CashflowCard
   * — see LedgerService.cashflow's doc comment for the exact definition and
   * the `range` contract. Same gate as `GET /ledger` (COMMITTEE-visible
   * aggregates, never per-resident rows).
   */
  @Get('cashflow')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  async cashflow(@CurrentResident() currentUser: ResidentPrincipal, @Query('range') range?: string): Promise<CashflowSeries> {
    return this.ledgerService.cashflow(currentUser.societyId, range);
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

  /**
   * Phase 6.5 Invariant I6 "rebuildable cache" guarantee: rewrites every
   * Account.balance in the caller's society from LedgerEntry truth.
   * TREASURER-only (not COMMITTEE, unlike POST /ledger/adjustments) — this
   * overwrites the balance cache outright rather than posting a normal
   * transfer, so it's scoped to the officer most directly accountable for
   * cash integrity, matching GET /ledger/reconciliation's precedent
   * (also TREASURER-only) rather than the wider COMMITTEE-or-TREASURER
   * gate on ordinary adjustments.
   *
   * No `@AuditLog(...)` here on purpose — LedgerService.rebuildBalances
   * writes its own richer AuditService entry (per-account rebuilt
   * balances) directly, same reasoning as SocietiesService/FlatsService
   * (see AuditService.appendBestEffort's doc comment), rather than the
   * interceptor's generic `{params, body}` payload.
   */
  @Post('rebuild')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  async rebuild(@CurrentResident() currentUser: ResidentPrincipal): Promise<RebuildResult> {
    return this.ledgerService.rebuildBalances(currentUser.societyId, currentUser.id);
  }

  /**
   * Phase 6.5 Invariant I6 assertion worker trigger — see
   * LedgerService.assertAllBalances' doc comment for why this is
   * `@OperatorOnly()` and cross-society rather than the
   * `@ResidentOnly()` + `@Roles(...)` shape every other route on this
   * controller uses: PollsService.processExpired's "stand-in for a future
   * scheduler" pattern, adapted to a check that inherently spans every
   * society at once.
   */
  @Post('assert-balances')
  @UseGuards(AuthGuard, PrincipalGuard)
  @OperatorOnly()
  async assertBalances(): Promise<BalanceAssertionSummary> {
    return this.ledgerService.assertAllBalances();
  }
}
