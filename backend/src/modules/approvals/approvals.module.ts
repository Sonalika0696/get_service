import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

/** Phase 11/12 (lane b1read) — no LedgerModule/AuditModule needed: this module is strictly read-only. PrismaService is global (see PrismaModule), so nothing else to import. */
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
})
export class ApprovalsModule {}
