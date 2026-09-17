import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind, ServiceRequestStatus } from '../../generated/prisma/enums.js';
import { CreateServiceRequestDto } from './dto/create-service-request.dto.js';
import { CreateServiceRequestCommitteeDto } from './dto/create-service-request-committee.dto.js';
import { AssignVendorDto } from './dto/assign-vendor.dto.js';
import { ConfirmServiceRequestDto } from './dto/confirm-service-request.dto.js';
import { ServiceRequestsService, type ServiceRequestDetail } from './service-requests.service.js';

/**
 * Phase 8.2 — the NEW ServiceRequest pooling loop (create -> join ->
 * threshold -> committee-assign -> committee-relayed vendor-confirm ->
 * PricingCard freeze -> escrow). Owned end-to-end by ServiceRequestsService
 * — see its class doc comment. Built ADDITIVELY alongside /polls (Phase 3
 * EVENT) and /bulk-buy/polls (Phase 5 Flow B); neither is touched here.
 *
 * Every committee-only route here is also `@ResidentOnly()`: a committee
 * member is a resident who additionally holds a `Role` in their own
 * society (see RolesGuard's doc comment) — the same "committee is a kind
 * of resident" shape every other committee-gated route in this codebase
 * (offers, approval-config, bookings) already uses. `@SocietyScope()` is
 * included on assignVendor per this phase's spec for a future `:sid`-param
 * variant of these routes; today's routes carry no `:sid` (society is
 * always taken from the caller's own session, like every other bulk-buy/
 * poll route in this codebase), so the guard is a documented no-op until
 * one exists — the real scoping is `currentUser.societyId`, threaded into
 * every service call below exactly like OffersController/
 * ResidentPollsController already do.
 */
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly serviceRequests: ServiceRequestsService) {}

  /** A resident raises a request for their own flat. */
  @Post()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('SERVICE_REQUEST_CREATE', 'ServiceRequest')
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateServiceRequestDto): Promise<ServiceRequestDetail> {
    return this.serviceRequests.createResident(currentUser.societyId, currentUser.id, dto);
  }

  /** A COMMITTEE member raises a request on a named flat's behalf. */
  @Post('committee')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('SERVICE_REQUEST_CREATE_COMMITTEE', 'ServiceRequest')
  async createCommittee(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateServiceRequestCommitteeDto): Promise<ServiceRequestDetail> {
    return this.serviceRequests.createCommittee(currentUser.societyId, currentUser.id, dto);
  }

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async list(@CurrentResident() currentUser: ResidentPrincipal, @Query('status') status?: ServiceRequestStatus): Promise<ServiceRequestDetail[]> {
    return this.serviceRequests.list(currentUser.societyId, currentUser.id, status);
  }

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<ServiceRequestDetail> {
    return this.serviceRequests.get(currentUser.societyId, id, currentUser.id);
  }

  /** A resident joins; may flip the request to POOLED in the same call once the threshold is met. */
  @Post(':id/join')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  @AuditLog('SERVICE_REQUEST_JOIN', 'ServiceRequest')
  async join(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<ServiceRequestDetail> {
    return this.serviceRequests.join(currentUser.societyId, id, currentUser.id);
  }

  /** A COMMITTEE member assigns a vendor (must be linked + hold a published card for the category). */
  @Post(':id/assign')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @SocietyScope()
  @AuditLog('SERVICE_REQUEST_ASSIGN', 'ServiceRequest')
  async assign(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: AssignVendorDto): Promise<ServiceRequestDetail> {
    return this.serviceRequests.assignVendor(currentUser.societyId, id, currentUser.id, dto);
  }

  /** A COMMITTEE member relays the assigned vendor's confirmation — freezes the PricingCard and creates escrow. */
  @Post(':id/confirm')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('SERVICE_REQUEST_CONFIRM', 'ServiceRequest')
  async confirm(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Body() dto: ConfirmServiceRequestDto): Promise<ServiceRequestDetail> {
    return this.serviceRequests.confirm(currentUser.societyId, id, currentUser.id, dto);
  }

  /** A COMMITTEE member relays the assigned vendor's decline — structural, no money exists yet. */
  @Post(':id/decline')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('SERVICE_REQUEST_DECLINE', 'ServiceRequest')
  async decline(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<ServiceRequestDetail> {
    return this.serviceRequests.decline(currentUser.societyId, id, currentUser.id);
  }

  /** Committee-triggered stand-in for a scheduler: closes an OPEN request past closesAt that never reached threshold. */
  @Post(':id/close')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('SERVICE_REQUEST_CLOSE', 'ServiceRequest')
  async close(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<ServiceRequestDetail> {
    return this.serviceRequests.closeBelowThreshold(currentUser.societyId, id, currentUser.id);
  }
}
