import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Read-only dashboard KPI aggregate — see DashboardService's doc comment
 * for what it composes and why. Imports LedgerModule only for
 * LedgerService.balances(societyId), the one piece of this aggregate that
 * isn't a plain Prisma count (PrismaService itself is global — see
 * PrismaModule — so it needs no import here).
 */
@Module({
  imports: [LedgerModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
