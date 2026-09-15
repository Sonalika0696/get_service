import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [LedgerModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // Exported so Phase 4C (bulk-buy) can inject PaymentsService and reuse
  // createOrderForLink for each commitment's escrow-in, instead of
  // duplicating order-creation logic.
  exports: [PaymentsService],
})
export class PaymentsModule {}
