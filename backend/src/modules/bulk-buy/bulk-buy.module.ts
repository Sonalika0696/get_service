import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { OffersController } from './offers.controller.js';
import { JobCardsController } from './job-cards.controller.js';
import { BookingsController } from './bookings.controller.js';
import { ResidentPollsController } from './resident-polls.controller.js';
import { BulkBuyService } from './bulk-buy.service.js';

@Module({
  imports: [LedgerModule, PaymentsModule],
  controllers: [OffersController, JobCardsController, BookingsController, ResidentPollsController],
  providers: [BulkBuyService],
})
export class BulkBuyModule {}
