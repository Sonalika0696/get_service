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
import type { DonationCampaignModel, DonationContributionModel } from '../../generated/prisma/models.js';
import { DonationCampaignsService, type DonationCampaignDetail, type DonationCampaignPage } from './donation-campaigns.service.js';
import { CreateDonationCampaignDto } from './dto/create-donation-campaign.dto.js';
import { ContributeDto } from './dto/contribute.dto.js';

@Controller('donation-campaigns')
export class DonationCampaignsController {
  constructor(private readonly campaigns: DonationCampaignsService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('DONATION_CAMPAIGN_CREATE', 'DonationCampaign')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateDonationCampaignDto): Promise<DonationCampaignModel> {
    return this.campaigns.create(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/close')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('DONATION_CAMPAIGN_CLOSE', 'DonationCampaign')
  async close(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<DonationCampaignModel> {
    return this.campaigns.close(currentUser.societyId, id);
  }

  /** ETag: computed over the exact page body — same contract as GET /pocket-transfers. */
  @Get()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DonationCampaignPage | undefined> {
    const page = await this.campaigns.list(currentUser.societyId, { cursor, limit });
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
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<DonationCampaignDetail> {
    return this.campaigns.getDetail(currentUser.societyId, currentUser.id, id);
  }

  @Post(':id/contributions')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @AuditLog('DONATION_CONTRIBUTION_CREATE', 'DonationContribution')
  async contribute(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Param('id') id: string,
    @Body() dto: ContributeDto,
  ): Promise<DonationContributionModel> {
    return this.campaigns.contribute(currentUser.societyId, currentUser.id, id, dto);
  }
}
