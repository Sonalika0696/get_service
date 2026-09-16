import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
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
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateOfferDto): Promise<OfferDetail> {
    return this.bulkBuy.createOffer(currentUser.societyId, dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query('status') status?: OfferStatus): Promise<OfferDetail[]> {
    return this.bulkBuy.listOffers(currentUser.societyId, status);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<OfferDetail> {
    return this.bulkBuy.getOffer(currentUser.societyId, id, currentUser.id);
  }

  @Post(':id/commit')
  @UseGuards(AuthGuard)
  @AuditLog('OFFER_COMMIT', 'Offer')
  async commit(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<OfferDetail> {
    return this.bulkBuy.commit(currentUser.societyId, id, currentUser.id);
  }

  /**
   * Phase 5: "rolls" a WEEKLY-recurring offer whose deadline has passed
   * into a fresh OPEN offer with deadline +7 days and empty commitments —
   * see BulkBuyService.rollOffer's doc comment. Stand-in for a scheduler
   * that doesn't exist yet in v1 (same stance as
   * PollsService.processExpired).
   */
  @Post(':id/roll')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('OFFER_ROLL', 'Offer')
  async roll(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<OfferDetail> {
    return this.bulkBuy.rollOffer(currentUser.societyId, id);
  }
}
