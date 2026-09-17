import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ClockModule } from '../../infra/clock/clock.module.js';
import { BankStatementsController } from './bank-statements.controller.js';
import { BankStatementsService } from './bank-statements.service.js';

@Module({
  imports: [LedgerModule, AuditModule, ClockModule],
  controllers: [BankStatementsController],
  providers: [BankStatementsService],
})
export class BankStatementsModule {}
