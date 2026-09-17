import { Body, Controller, Get, HttpStatus, Headers, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { TreasuryService, type FixedDepositDetail, type FixedDepositPage, type LadderBucket, type SweepProposeResult, type TreasuryConfigReadoutDto } from './treasury.service.js';
import { SetTreasuryConfigDto } from './dto/set-treasury-config.dto.js';
import { ProposeDepositDto } from './dto/propose-deposit.dto.js';
import { WithdrawDepositDto } from './dto/withdraw-deposit.dto.js';
import { RenewDepositDto } from './dto/renew-deposit.dto.js';

const TREASURY_OFFICER_ROLES = [RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE] as const;

/**
 * Phase 12 (M12) — corpus treasury: fixed deposits, sweep rule, maturity
 * ladder. Every route is officer-gated (TREASURER/DEPUTY_TREASURER/
 * COMMITTEE), mirroring PocketTransfersController — see TreasuryService's
 * doc comment for the full behavioural spec and the I4 regulatory stance.
 */
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('config')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async getConfig(@CurrentResident() currentUser: ResidentPrincipal): Promise<TreasuryConfigReadoutDto> {
    return this.treasury.getConfig(currentUser.societyId);
  }

  @Put('config')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.COMMITTEE)
  @AuditLog('TREASURY_CONFIG_SET', 'Society')
  async setConfig(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: SetTreasuryConfigDto): Promise<TreasuryConfigReadoutDto> {
    return this.treasury.setConfig(currentUser.societyId, currentUser.id, dto);
  }

  @Post('deposits')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_PROPOSE', 'FixedDeposit')
  async proposeDeposit(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: ProposeDepositDto): Promise<FixedDepositDetail> {
    return this.treasury.proposeDeposit(currentUser.societyId, currentUser.id, dto);
  }

  @Post('sweep/propose')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_SWEEP_PROPOSE', 'FixedDeposit')
  async sweepPropose(@CurrentResident() currentUser: ResidentPrincipal): Promise<SweepProposeResult> {
    return this.treasury.sweepPropose(currentUser.societyId, currentUser.id);
  }

  @Post('deposits/:id/authorise-placement')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_AUTHORISE_PLACEMENT', 'FixedDeposit')
  async authorisePlacement(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<FixedDepositDetail> {
    return this.treasury.authorisePlacement(currentUser.societyId, id, currentUser.id);
  }

  @Post('deposits/:id/cancel')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_CANCEL', 'FixedDeposit')
  async cancel(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<FixedDepositDetail> {
    return this.treasury.cancel(currentUser.societyId, id);
  }

  @Post('deposits/process-maturities')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_PROCESS_MATURITIES', 'FixedDeposit')
  async processMaturities(@CurrentResident() currentUser: ResidentPrincipal): Promise<{ maturedIds: string[] }> {
    return this.treasury.processMaturities(currentUser.societyId);
  }

  @Post('deposits/:id/mature')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_MATURE', 'FixedDeposit')
  async mature(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<FixedDepositDetail> {
    return this.treasury.mature(currentUser.societyId, id);
  }

  @Post('deposits/:id/withdraw')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_WITHDRAW', 'FixedDeposit')
  async withdraw(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: WithdrawDepositDto): Promise<FixedDepositDetail> {
    return this.treasury.withdraw(currentUser.societyId, id, currentUser.id, dto.reason);
  }

  @Post('deposits/:id/renew')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(...TREASURY_OFFICER_ROLES)
  @AuditLog('TREASURY_DEPOSIT_RENEW', 'FixedDeposit')
  async renew(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: RenewDepositDto): Promise<FixedDepositDetail> {
    return this.treasury.renew(currentUser.societyId, currentUser.id, id, dto);
  }

  @Get('ladder')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(...TREASURY_OFFICER_ROLES)
  async ladder(@CurrentResident() currentUser: ResidentPrincipal): Promise<{ buckets: LadderBucket[] }> {
    return this.treasury.ladder(currentUser.societyId);
  }

  /** ETag: computed over the exact page body (`{ items, nextCursor }`) — same contract as GET /pocket-transfers. */
  @Get('deposits')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(...TREASURY_OFFICER_ROLES)
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FixedDepositPage | undefined> {
    const page = await this.treasury.list(currentUser.societyId, { status, cursor, limit });
    const etag = computeEtag(page);
    res.set('ETag', etag);

    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return page;
  }

  @Get('deposits/:id')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(...TREASURY_OFFICER_ROLES)
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<FixedDepositDetail> {
    return this.treasury.get(currentUser.societyId, id);
  }
}
