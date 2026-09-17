import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

/** Phase 9.3 — see BillsService's doc comment. PrismaModule is `@Global()`, so no explicit import is needed here (mirrors DashboardModule). */
@Module({
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}
