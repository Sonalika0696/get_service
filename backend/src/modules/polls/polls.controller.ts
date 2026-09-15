import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { PollStatus, RoleKind } from '../../generated/prisma/enums.js';
import type { PollModel } from '../../generated/prisma/models.js';
import { CreatePollDto } from './dto/create-poll.dto.js';
import { VotePollDto } from './dto/vote-poll.dto.js';
import { PollsService, type PollDetail } from './polls.service.js';

@Controller('polls')
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() currentUser: CurrentUserContext, @Query('status') status?: PollStatus): Promise<PollModel[]> {
    return this.pollsService.listForSociety(currentUser.societyId, status);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.get(currentUser.societyId, id, currentUser.id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @AuditLog('POLL_CREATE', 'Poll')
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreatePollDto): Promise<PollDetail> {
    return this.pollsService.create(currentUser.societyId, currentUser.id, currentUser.roleKinds, dto);
  }

  @Post(':id/vote')
  @UseGuards(AuthGuard)
  @AuditLog('POLL_VOTE', 'Poll')
  async vote(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Body() dto: VotePollDto): Promise<PollDetail> {
    return this.pollsService.vote(currentUser.societyId, id, currentUser.id, dto);
  }

  @Post(':id/join')
  @UseGuards(AuthGuard)
  @AuditLog('POLL_JOIN', 'Poll')
  async join(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.join(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/close')
  @UseGuards(AuthGuard)
  @AuditLog('POLL_CLOSE', 'Poll')
  async close(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PollDetail> {
    return this.pollsService.closeEarly(currentUser.societyId, id, currentUser.id);
  }

  /** Stand-in for a scheduler: resolves every OPEN poll in the caller's society whose closesAt has passed. */
  @Post('process-expired')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  async processExpired(@CurrentUser() currentUser: CurrentUserContext): Promise<{ resolved: number }> {
    return this.pollsService.processExpired(currentUser.societyId);
  }
}
