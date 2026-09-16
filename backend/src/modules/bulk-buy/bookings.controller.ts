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
   * Approval-ladder authorisation call (Phase 6.4, M14) — SMALL bookings
   * only (LARGE bookings are rejected with 400; see authoriseMilestone
   * below). Open to any of TREASURER/DEPUTY_TREASURER/COMMITTEE (widened
   * from TREASURER-only — this is what makes DEPUTY_TREASURER a live role;
   * see BulkBuyService.authorisePayout's doc comment for the full N-officer
   * ladder and exactly when a call actually executes the payout vs. merely
   * records one more distinct officer's approval).
   */
  @Post(':id/payout/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  @AuditLog('PAYOUT_AUTHORISE', 'Payout')
  async authorisePayout(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.authorisePayout(currentUser.societyId, id, currentUser.id);
  }

  /**
   * Approval-ladder authorisation call (Phase 6.4, M14) — LARGE bookings
   * only (SMALL bookings are rejected with 400). Same role widening as
   * authorisePayout above. See BulkBuyService.authoriseMilestone's doc
   * comment for the ordering, idempotency, and once-only retention
   * set-aside rules under the new N-officer ladder.
   */
  @Post(':id/milestones/:mid/authorise')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
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
