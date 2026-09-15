import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { BulkBuyService, type BookingDetail } from './bulk-buy.service.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.getBooking(currentUser.societyId, id);
  }

  /**
   * TREASURER-only dual-authorisation call — see BulkBuyService.authorisePayout's
   * doc comment for exactly when the SYSTEM row is added and when the
   * payout actually executes.
   */
  @Post(':id/payout/authorise')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.TREASURER)
  @AuditLog('PAYOUT_AUTHORISE', 'Payout')
  async authorisePayout(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<BookingDetail> {
    return this.bulkBuy.authorisePayout(currentUser.societyId, id, currentUser.id);
  }
}
