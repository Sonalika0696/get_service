import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BulkBuyModule } from '../bulk-buy/bulk-buy.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ServiceRequestsController } from './service-requests.controller.js';
import { ServiceRequestsService } from './service-requests.service.js';

/**
 * Phase 8.2 — the NEW ServiceRequest pooling loop. Imports BulkBuyModule
 * (which now exports BulkBuyService) purely to reuse
 * BulkBuyService.createBookingWithEscrow unchanged — see that method's
 * updated doc comment and ServiceRequestsService.confirm. Phase 8.3 adds
 * NotificationsModule for the post-commit pooled/assigned/confirmed
 * notification fan-out — same shape as PollsModule's import.
 */
@Module({
  imports: [AuditModule, BulkBuyModule, NotificationsModule],
  controllers: [ServiceRequestsController],
  providers: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
