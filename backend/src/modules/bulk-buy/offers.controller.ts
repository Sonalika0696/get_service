import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { OfferStatus, RoleKind } from '../../generated/prisma/enums.js';
import { CreateOfferDto } from './dto/create-offer.dto.js';
import { BulkBuyService, type OfferDetail } from './bulk-buy.service.js';

@Controller('offers')
export class OffersController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  /**
   * v1 has no vendor login yet (see BulkBuyService's doc comment) — a
   * COMMITTEE member creates the offer, naming an existing Vendor id.
   */
  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('OFFER_CREATE', 'Offer')
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreateOfferDto): Promise<OfferDetail> {
    return this.bulkBuy.createOffer(currentUser.societyId, dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() currentUser: CurrentUserContext, @Query('status') status?: OfferStatus): Promise<OfferDetail[]> {
    return this.bulkBuy.listOffers(currentUser.societyId, status);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<OfferDetail> {
    return this.bulkBuy.getOffer(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/commit')
  @UseGuards(AuthGuard)
  @AuditLog('OFFER_COMMIT', 'Offer')
  async commit(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<OfferDetail> {
    return this.bulkBuy.commit(currentUser.societyId, id, currentUser.id);
  }
}
