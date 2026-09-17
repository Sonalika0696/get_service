import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VirtualAccountsService } from './virtual-accounts.service.js';
import { VirtualAccountsController } from './virtual-accounts.controller.js';
import { VirtualAccountsOperatorController } from './virtual-accounts-operator.controller.js';

/**
 * Phase 9.1 — VirtualAccount (per-flat attribution key) provisioning +
 * reads. AuditModule is imported explicitly (not @Global()) because
 * VirtualAccountsService calls AuditService directly, same reasoning as
 * OperatorModule's doc comment. VirtualAccountsService is exported so
 * FlatsService (operator module) can call `provisionForFlat` from inside
 * its own CSV-import transaction — see OperatorModule's import of this
 * module.
 */
@Module({
  imports: [AuditModule],
  controllers: [VirtualAccountsController, VirtualAccountsOperatorController],
  providers: [VirtualAccountsService],
  exports: [VirtualAccountsService],
})
export class VirtualAccountsModule {}
