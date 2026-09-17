import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { ServiceRequestStatus, RoleKind } from '../../generated/prisma/enums.js';
import type { ServiceRequestModel } from '../../generated/prisma/models.js';
import { CreatePollDto } from './dto/create-poll.dto.js';
import { PollsService, type PollDetail } from './polls.service.js';

@Controller('polls')
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query('status') status?: ServiceRequestStatus): Promise<ServiceRequestModel[]> {
    return this.pollsService.listForSociety(currentUser.societyId, status);
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.get(currentUser.societyId, id, currentUser.id);
  }

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('POLL_CREATE', 'Poll')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreatePollDto): Promise<PollDetail> {
    return this.pollsService.create(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/join')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('POLL_JOIN', 'Poll')
  async join(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.join(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/close')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('POLL_CLOSE', 'Poll')
  async close(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.closeEarly(currentUser.societyId, id, currentUser.id);
  }

  /** Stand-in for a scheduler: resolves every OPEN poll in the caller's society whose closesAt has passed. */
  @Post('process-expired')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  async processExpired(@CurrentResident() currentUser: ResidentPrincipal): Promise<{ resolved: number }> {
    return this.pollsService.processExpired(currentUser.societyId);
  }
}
