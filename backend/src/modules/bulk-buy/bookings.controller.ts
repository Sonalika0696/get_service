import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { BulkBuyService, type BookingDetail } from './bulk-buy.service.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.getBooking(currentUser.societyId, id);
  }

  /**
   * TREASURER-only dual-authorisation call — SMALL bookings only (LARGE
   * bookings are rejected with 400; see authoriseMilestone below). See
   * BulkBuyService.authorisePayout's doc comment for exactly when the
   * SYSTEM row is added and when the payout actually executes.
   */
  @Post(':id/payout/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  @AuditLog('PAYOUT_AUTHORISE', 'Payout')
  async authorisePayout(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.authorisePayout(currentUser.societyId, id, currentUser.id);
  }

  /**
   * TREASURER-only dual-authorisation call — LARGE bookings only (SMALL
   * bookings are rejected with 400). See
   * BulkBuyService.authoriseMilestone's doc comment for the ordering,
   * idempotency, and once-only retention set-aside rules.
   */
  @Post(':id/milestones/:mid/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  @AuditLog('MILESTONE_AUTHORISE', 'Milestone')
  async authoriseMilestone(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string, @Param('mid') mid: string): Promise<BookingDetail> {
    return this.bulkBuy.authoriseMilestone(currentUser.societyId, id, mid, currentUser.id);
  }

  /**
   * TREASURER-only release of a LARGE booking's defect-liability retention
   * share, once every milestone is PAID and the retention period has
   * elapsed. See BulkBuyService.releaseRetention's doc comment.
   */
  @Post(':id/retention/release')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  @AuditLog('RETENTION_RELEASE', 'Booking')
  async releaseRetention(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.releaseRetention(currentUser.societyId, id, currentUser.id);
  }
}
