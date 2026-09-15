import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, IdempotencyService, ReconciliationService],
  // Exported so Phase 4B (payments, bulk-buy, payouts) can inject the
  // posting primitive and the idempotency helper without duplicating them.
  exports: [LedgerService, IdempotencyService],
})
export class LedgerModule {}
