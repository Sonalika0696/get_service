import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  // Phase 9.2: RealtimeModule added so applyCapture's MaintenanceCharge
  // branch can push a post-commit, best-effort 'bill.paid' event —
  // RealtimeModule exports RealtimeService (see its own doc comment).
  imports: [LedgerModule, RealtimeModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // Exported so Phase 4C (bulk-buy) can inject PaymentsService and reuse
  // createOrderForLink for each commitment's escrow-in, instead of
  // duplicating order-creation logic.
  exports: [PaymentsService],
})
export class PaymentsModule {}
