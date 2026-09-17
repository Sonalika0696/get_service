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
import {
  WelfareDisbursementsService,
  type WelfareDisbursementDetail,
  type WelfareDisbursementPage,
} from './welfare-disbursements.service.js';
import { RequestDisbursementDto } from './dto/request-disbursement.dto.js';

/**
 * M10 — money OUT of the WELFARE pocket. Every route is officer-gated
 * (TREASURER/DEPUTY_TREASURER/COMMITTEE), the same trio pocket-transfers
 * uses — see welfare-disbursements.service.ts's doc comment for the two
 * deliberate divergences from that module's authorisation flow.
 */
@Controller('welfare-disbursements')
export class WelfareDisbursementsController {
  constructor(private readonly disbursements: WelfareDisbursementsService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('WELFARE_DISBURSEMENT_REQUEST', 'WelfareDisbursement')
  async request(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: RequestDisbursementDto): Promise<WelfareDisbursementDetail> {
    return this.disbursements.request(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('WELFARE_DISBURSEMENT_AUTHORISE', 'WelfareDisbursement')
  async authorise(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<WelfareDisbursementDetail> {
    return this.disbursements.authorise(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('WELFARE_DISBURSEMENT_CANCEL', 'WelfareDisbursement')
  async cancel(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<WelfareDisbursementDetail> {
    return this.disbursements.cancel(currentUser.societyId, id);
  }

  /** ETag: computed over the exact page body — same contract as GET /pocket-transfers. */
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
  ): Promise<WelfareDisbursementPage | undefined> {
    const page = await this.disbursements.list(currentUser.societyId, { status, cursor, limit });
    const etag = computeEtag(page);
    res.set('ETag', etag);

    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return page;
  }
}
