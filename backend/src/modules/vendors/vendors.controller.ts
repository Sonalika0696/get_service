import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { VendorAccessRequestModel } from '../../generated/prisma/models.js';
import { CreateVendorDto } from './dto/create-vendor.dto.js';
import { RateVendorDto } from './dto/rate-vendor.dto.js';
import { VendorAccessRequestDto } from './dto/vendor-access-request.dto.js';
import { VendorsService, type VendorDetail } from './vendors.service.js';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(
    @CurrentUser() currentUser: CurrentUserContext,
    @Query('category') category?: string,
    @Query('q') q?: string,
  ): Promise<VendorDetail[]> {
    return this.vendorsService.listForSociety(currentUser.societyId, { category, q });
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<VendorDetail> {
    return this.vendorsService.get(currentUser.societyId, id);
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('VENDOR_ONBOARD', 'Vendor')
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreateVendorDto): Promise<VendorDetail> {
    return this.vendorsService.create(currentUser.societyId, dto);
  }

  @Post(':id/approve')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('VENDOR_APPROVE', 'Vendor')
  async approve(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<VendorDetail & { note: string }> {
    return this.vendorsService.approve(currentUser.societyId, id);
  }

  @Post(':id/rate')
  @UseGuards(AuthGuard)
  async rate(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string, @Body() dto: RateVendorDto): Promise<VendorDetail> {
    return this.vendorsService.rate(currentUser.societyId, id, currentUser.id, dto);
  }

  @Post(':id/access-request')
  @UseGuards(AuthGuard)
  async requestAccess(
    @CurrentUser() currentUser: CurrentUserContext,
    @Param('id') id: string,
    @Body() dto: VendorAccessRequestDto,
  ): Promise<VendorAccessRequestModel> {
    return this.vendorsService.createAccessRequest(currentUser.societyId, id, currentUser.id, dto);
  }
}
