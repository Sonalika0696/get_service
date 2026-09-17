import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { TreasuryController } from './treasury.controller.js';
import { TreasuryService } from './treasury.service.js';

/** Phase 12 (M12) — mirrors PocketTransfersModule's wiring (LedgerModule for the money-moving posts, AuditModule for propose/authorise/mature/withdraw/renew/config audit entries). */
@Module({
  imports: [LedgerModule, AuditModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
})
export class TreasuryModule {}
