import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceBillingService } from './maintenance-billing.service.js';

@Module({
  imports: [LedgerModule, AuditModule, RealtimeModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceBillingService],
})
export class MaintenanceModule {}
