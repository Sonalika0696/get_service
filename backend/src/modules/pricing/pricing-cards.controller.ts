import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { VendorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext, VendorPrincipal } from '../../common/types/current-user.js';
import { CreatePricingCardDto } from './dto/create-pricing-card.dto.js';
import { RevisePricingCardDto } from './dto/revise-pricing-card.dto.js';
import { CreatePricingLineDto } from './dto/create-pricing-line.dto.js';
import { UpdatePricingLineDto } from './dto/update-pricing-line.dto.js';
import { PricingCardsService, type PricingCardDetail } from './pricing-cards.service.js';

/**
 * Phase 7.2 (BACKEND_PLAN.md Phase 7 items 2-5). Vendor self-service draft
 * management is `@VendorOnly()` throughout; the two `vendors/:vendorId/...`
 * read routes are open to any authenticated principal and rely on
 * PricingCardsService.assertReaderAccess for the real authz decision (a
 * vendor reading its own cards, or a resident of a society the vendor is
 * linked to) — see that method's doc comment for the "why".
 *
 * Route order matters: the literal `mine` and `vendors/...` prefixes are
 * registered before the dynamic `:id`/`:cardId` routes so they aren't
 * swallowed as an id param (same reason VendorsController registers
 * `GET /me` before `GET /:id`).
 */
@Controller('pricing-cards')
export class PricingCardsController {
  constructor(private readonly pricingCards: PricingCardsService) {}

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreatePricingCardDto): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.createDraft(vendor.vendorId, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async listMine(@CurrentUser() currentUser: CurrentUserContext, @Query('category') category?: string): Promise<PricingCardDetail[]> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.listMine(vendor.vendorId, category);
  }

  @Get('vendors/:vendorId/categories/:category/current')
  @UseGuards(AuthGuard, PrincipalGuard)
  async getCurrent(
    @CurrentUser() currentUser: CurrentUserContext,
    @Param('vendorId') vendorId: string,
    @Param('category') category: string,
  ): Promise<PricingCardDetail> {
    return this.pricingCards.getCurrentPublished(currentUser, vendorId, category);
  }

  @Get('vendors/:vendorId/categories/:category/versions/:version')
  @UseGuards(AuthGuard, PrincipalGuard)
  async getVersion(
    @CurrentUser() currentUser: CurrentUserContext,
    @Param('vendorId') vendorId: string,
    @Param('category') category: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<PricingCardDetail> {
    return this.pricingCards.getVersion(currentUser, vendorId, category, version);
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async getOwn(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.getOwnCard(vendor.vendorId, id);
  }

  @Post(':id/lines')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async addLine(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Body() dto: CreatePricingLineDto): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.addLine(vendor.vendorId, id, dto);
  }

  @Patch(':id/lines/:lineId')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async updateLine(
    @CurrentUser() currentUser: CurrentUserContext,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdatePricingLineDto,
  ): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.updateLine(vendor.vendorId, id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async deleteLine(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Param('lineId') lineId: string): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.deleteLine(vendor.vendorId, id, lineId);
  }

  @Post(':id/publish')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async publish(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.publish(vendor, id);
  }

  @Post(':id/revise')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async revise(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Body() dto: RevisePricingCardDto): Promise<PricingCardDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.pricingCards.revise(vendor.vendorId, id, dto);
  }
}
