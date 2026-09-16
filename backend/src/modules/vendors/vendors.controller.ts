import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { VendorOnly, ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal, VendorPrincipal, CurrentUserContext } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { VendorAccessRequestModel } from '../../generated/prisma/models.js';
import { CreateVendorDto } from './dto/create-vendor.dto.js';
import { RateVendorDto } from './dto/rate-vendor.dto.js';
import { VendorAccessRequestDto } from './dto/vendor-access-request.dto.js';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto.js';
import { AddVendorCategoryDto } from './dto/add-vendor-category.dto.js';
import { VendorsService, type VendorDetail, type VendorProfileDetail } from './vendors.service.js';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  /**
   * Phase 6.2: a VENDOR principal's own identity echo — the same purpose
   * `GET /me` serves for residents. Registered before `GET /:id` so "me"
   * isn't swallowed as an :id param. Phase 7.1: `societyId` (singular)
   * became `societyIds` — a vendor may now be linked to many societies.
   * Real vendor self-service (pricing cards, profile) is Phase 7.2/7.3.
   */
  @Get('me')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async me(@CurrentUser() currentUser: CurrentUserContext): Promise<{ vendorId: string; societyIds: string[] }> {
    const vendor = currentUser as VendorPrincipal;
    return { vendorId: vendor.vendorId, societyIds: vendor.societyIds };
  }

  /**
   * Phase 6.3: ConsentGrant enforced at query time — see
   * VendorsService.getResidentContact's doc comment. Registered before
   * `GET /:id` (same reason as `GET /me` above) so "residents" isn't
   * swallowed as an :id param. Phase 7.1: a vendor may now be linked to
   * several societies, so the caller must name WHICH one this lookup is
   * scoped to via `?societyId=` — VendorsService.getResidentContact
   * validates the caller is actually linked to it before doing anything
   * else, so a vendor can't probe a society it has no relationship with.
   */
  @Get('residents/:residentId/contact')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async residentContact(
    @CurrentUser() currentUser: CurrentUserContext,
    @Param('residentId') residentId: string,
    @Query('societyId') societyId: string,
  ) {
    const vendor = currentUser as VendorPrincipal;
    return this.vendorsService.getResidentContact(vendor.id, vendor.vendorId, societyId, residentId);
  }

  /**
   * Phase 7.3 (BACKEND_PLAN.md Phase 7 item 6): the vendor's own profile,
   * including the settlement account trio — never exposed via the
   * resident/committee-facing routes below (see VendorsService.toDetail's
   * doc comment). Registered before `GET /:id` (same reason as `GET /me`
   * above) so `me` isn't swallowed as an :id param.
   */
  @Get('me/profile')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async myProfile(@CurrentUser() currentUser: CurrentUserContext): Promise<VendorProfileDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.vendorsService.getOwnProfile(vendor.vendorId);
  }

  /** Vendor self-service profile update — contact/geo/radius, trade licence, and the settlement account destination (PATCH semantics: only sent fields change). */
  @Patch('me/profile')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async updateMyProfile(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: UpdateVendorProfileDto): Promise<VendorProfileDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.vendorsService.updateOwnProfile(vendor.vendorId, dto);
  }

  /** Adds one category to the caller's own vendor listing. */
  @Post('me/categories')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async addMyCategory(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: AddVendorCategoryDto): Promise<VendorDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.vendorsService.addOwnCategory(vendor.vendorId, dto.category);
  }

  /** Removes one category from the caller's own vendor listing. */
  @Delete('me/categories/:category')
  @UseGuards(AuthGuard, PrincipalGuard)
  @VendorOnly()
  async removeMyCategory(@CurrentUser() currentUser: CurrentUserContext, @Param('category') category: string): Promise<VendorDetail> {
    const vendor = currentUser as VendorPrincipal;
    return this.vendorsService.removeOwnCategory(vendor.vendorId, category);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async list(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('category') category?: string,
    @Query('q') q?: string,
  ): Promise<VendorDetail[]> {
    return this.vendorsService.listForSociety(currentUser.societyId, { category, q });
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<VendorDetail> {
    return this.vendorsService.get(currentUser.societyId, id);
  }

  @Post()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('VENDOR_ONBOARD', 'Vendor')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateVendorDto): Promise<VendorDetail> {
    return this.vendorsService.create(currentUser.societyId, dto);
  }

  @Post(':id/approve')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('VENDOR_APPROVE', 'Vendor')
  async approve(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<VendorDetail & { note: string }> {
    return this.vendorsService.approve(currentUser.societyId, id);
  }

  @Post(':id/rate')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async rate(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: RateVendorDto): Promise<VendorDetail> {
    return this.vendorsService.rate(currentUser.societyId, id, currentUser.id, dto);
  }

  @Post(':id/access-request')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async requestAccess(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Param('id') id: string,
    @Body() dto: VendorAccessRequestDto,
  ): Promise<VendorAccessRequestModel> {
    return this.vendorsService.createAccessRequest(currentUser.societyId, id, currentUser.id, dto);
  }
}
