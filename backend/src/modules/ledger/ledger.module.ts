import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  // AuditModule: LedgerService.rebuildBalances writes a best-effort
  // AuditService entry (Phase 6.5, I6 rebuild guarantee) the same way
  // FlatsService/SocietiesService call AuditService directly rather than
  // via the @AuditLog(...) interceptor.
  imports: [AuditModule],
  controllers: [LedgerController],
  providers: [LedgerService, IdempotencyService, ReconciliationService],
  // Exported so Phase 4B (payments, bulk-buy, payouts) can inject the
  // posting primitive and the idempotency helper without duplicating them.
  exports: [LedgerService, IdempotencyService],
})
export class LedgerModule {}
