import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { CreateResidentPollDto } from './dto/create-resident-poll.dto.js';
import { VendorConfirmDto } from './dto/vendor-confirm.dto.js';
import { BulkBuyService, type ResidentPollDetail } from './bulk-buy.service.js';

/**
 * Phase 5 Flow B — resident-initiated, tagged-vendor bulk-buy polls. Owned
 * end-to-end by BulkBuyService (see its class doc comment and
 * PollsService's own doc comment for the ownership split): the shared
 * PollsController/PollsService never handles PollType.BULK_BUY_RESIDENT.
 */
@Controller('bulk-buy/polls')
export class ResidentPollsController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  /** A resident opens a poll tagging an existing vendor in their own society. */
  @Post()
  @UseGuards(AuthGuard)
  @AuditLog('BULKBUY_POLL_CREATE', 'Poll')
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreateResidentPollDto): Promise<ResidentPollDetail> {
    return this.bulkBuy.createResidentPoll(currentUser.societyId, currentUser.id, dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() currentUser: CurrentUserContext): Promise<ResidentPollDetail[]> {
    return this.bulkBuy.listResidentPolls(currentUser.societyId, currentUser.id);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<ResidentPollDetail> {
    return this.bulkBuy.getResidentPoll(currentUser.societyId, id, currentUser.id);
  }

  /**
   * A COMMITTEE member, acting for the tagged vendor (no vendor login in
   * v1 — see BulkBuyService's class doc comment), confirms the terms Flow B
   * fires under. May fire the poll immediately in the same call — see
   * BulkBuyService.vendorConfirm's doc comment.
   */
  @Post(':id/vendor-confirm')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('BULKBUY_VENDOR_CONFIRM', 'Poll')
  async vendorConfirm(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Body() dto: VendorConfirmDto): Promise<ResidentPollDetail> {
    return this.bulkBuy.vendorConfirm(currentUser.societyId, id, dto);
  }

  /** A COMMITTEE member, acting for the tagged vendor, declines — the poll is CANCELLED outright. */
  @Post(':id/vendor-decline')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('BULKBUY_VENDOR_DECLINE', 'Poll')
  async vendorDecline(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<ResidentPollDetail> {
    return this.bulkBuy.vendorDecline(currentUser.societyId, id);
  }

  /** A resident registers interest; may fire the poll immediately in the same call — see BulkBuyService.joinResidentPoll's doc comment. */
  @Post(':id/join')
  @UseGuards(AuthGuard)
  @AuditLog('BULKBUY_POLL_JOIN', 'Poll')
  async join(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<ResidentPollDetail> {
    return this.bulkBuy.joinResidentPoll(currentUser.societyId, id, currentUser.id);
  }
}
