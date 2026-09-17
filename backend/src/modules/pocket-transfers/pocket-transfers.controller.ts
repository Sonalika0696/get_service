import { Body, Controller, Get, HttpStatus, Headers, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
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
import { PocketTransfersService, type PocketTransferDetail, type PocketTransferPage } from './pocket-transfers.service.js';
import { RequestTransferDto } from './dto/request-transfer.dto.js';

/**
 * Phase 9.6 — dual-authorised cross-pocket transfers. Every route is
 * officer-gated (TREASURER/DEPUTY_TREASURER/COMMITTEE), same trio bulk-buy's
 * BookingsController widens to. `@Roles(...)`/`@SocietyScope()` are
 * per-method, not hoisted to the class — see MaintenanceController's
 * identical note; these routes carry no `:sid` path param (society is
 * always taken from the caller's own session), so `@SocietyScope()` here is
 * a documented no-op kept for consistency/future-proofing.
 */
@Controller('pocket-transfers')
export class PocketTransfersController {
  constructor(private readonly pocketTransfers: PocketTransfersService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('POCKET_TRANSFER_REQUEST', 'PocketTransfer')
  async request(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: RequestTransferDto): Promise<PocketTransferDetail> {
    return this.pocketTransfers.request(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('POCKET_TRANSFER_AUTHORISE', 'PocketTransfer')
  async authorise(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PocketTransferDetail> {
    return this.pocketTransfers.authoriseTransfer(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('POCKET_TRANSFER_CANCEL', 'PocketTransfer')
  async cancel(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PocketTransferDetail> {
    return this.pocketTransfers.cancel(currentUser.societyId, id, currentUser.id);
  }

  /** ETag: computed over the exact page body (`{ items, nextCursor }`) — same contract as GET /me/bills. */
  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PocketTransferPage | undefined> {
    const page = await this.pocketTransfers.list(currentUser.societyId, { status, cursor, limit });
    const etag = computeEtag(page);
    res.set('ETag', etag);

    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return page;
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PocketTransferDetail> {
    return this.pocketTransfers.get(currentUser.societyId, id);
  }
}
