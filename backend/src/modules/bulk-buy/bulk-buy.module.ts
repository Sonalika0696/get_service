import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { OffersController } from './offers.controller.js';
import { JobCardsController } from './job-cards.controller.js';
import { BookingsController } from './bookings.controller.js';
import { ResidentPollsController } from './resident-polls.controller.js';
import { ApprovalConfigController } from './approval-config.controller.js';
import { BulkBuyService } from './bulk-buy.service.js';

@Module({
  imports: [LedgerModule, PaymentsModule, AuditModule, RealtimeModule],
  controllers: [OffersController, JobCardsController, BookingsController, ResidentPollsController, ApprovalConfigController],
  providers: [BulkBuyService],
  // Phase 8.2: exported so ServiceRequestsModule can inject BulkBuyService
  // and reuse its createBookingWithEscrow helper unchanged — see that
  // method's updated doc comment.
  exports: [BulkBuyService],
})
export class BulkBuyModule {}
