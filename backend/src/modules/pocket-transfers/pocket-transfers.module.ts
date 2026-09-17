import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PocketTransfersController } from './pocket-transfers.controller.js';
import { PocketTransfersService } from './pocket-transfers.service.js';

/** Phase 9.6 — mirrors BulkBuyModule's wiring (LedgerModule for the money-moving post, AuditModule for the execution audit entry). */
@Module({
  imports: [LedgerModule, AuditModule],
  controllers: [PocketTransfersController],
  providers: [PocketTransfersService],
})
export class PocketTransfersModule {}
