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
import type { CampRegistrationModel, HealthCampModel } from '../../generated/prisma/models.js';
import {
  HealthCampsService,
  type HealthCampDetail,
  type HealthCampPage,
  type RosterRow,
} from './health-camps.service.js';
import { CreateHealthCampDto } from './dto/create-health-camp.dto.js';
import { RegisterCampDto } from './dto/register-camp.dto.js';

/**
 * Phase 12 M9 — health camps. INVARIANT I5: the platform never collects,
 * stores or displays health information. Every route on this controller
 * touches identity + slot + money only — see health-camps.service.ts's doc
 * comments and i5-no-health-data.spec.ts for the structural guarantee.
 */
@Controller('health-camps')
export class HealthCampsController {
  constructor(private readonly healthCamps: HealthCampsService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('HEALTH_CAMP_CREATE', 'HealthCamp')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateHealthCampDto): Promise<HealthCampModel> {
    return this.healthCamps.create(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('HEALTH_CAMP_CANCEL', 'HealthCamp')
  async cancel(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<HealthCampModel> {
    return this.healthCamps.cancel(currentUser.societyId, id);
  }

  @Post(':id/complete')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('HEALTH_CAMP_COMPLETE', 'HealthCamp')
  async complete(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<HealthCampModel> {
    return this.healthCamps.complete(currentUser.societyId, id);
  }

  @Post('process-due')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async processDue(@CurrentResident() currentUser: ResidentPrincipal): Promise<{ closed: number }> {
    return this.healthCamps.processDue(currentUser.societyId);
  }

  @Get(':id/roster')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async roster(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<RosterRow[]> {
    return this.healthCamps.roster(currentUser.societyId, id);
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
  ): Promise<HealthCampPage | undefined> {
    const page = await this.healthCamps.list(currentUser.societyId, { cursor, limit });
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
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<HealthCampDetail> {
    return this.healthCamps.getDetail(currentUser.societyId, currentUser.id, id);
  }

  @Post(':id/registrations')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @AuditLog('HEALTH_CAMP_REGISTER', 'CampRegistration')
  async registerForCamp(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Param('id') id: string,
    @Body() dto: RegisterCampDto,
  ): Promise<CampRegistrationModel> {
    return this.healthCamps.register(currentUser.societyId, currentUser.id, id, dto);
  }

  @Post(':id/registrations/:regId/cancel')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @AuditLog('HEALTH_CAMP_REGISTRATION_CANCEL', 'CampRegistration')
  async cancelRegistration(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Param('id') id: string,
    @Param('regId') regId: string,
  ): Promise<CampRegistrationModel> {
    return this.healthCamps.cancelRegistration(currentUser.societyId, currentUser.id, id, regId);
  }
}
