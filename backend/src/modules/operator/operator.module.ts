import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { OperatorController } from './operator.controller.js';
import { SocietiesController } from './societies.controller.js';
import { SocietiesService } from './societies.service.js';
import { FlatsController } from './flats.controller.js';
import { FlatsService } from './flats.service.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

/**
 * Phase 6.3 (BACKEND_PLAN.md Phase 6.3 items 1-2; DECISIONS_V2_SCOPE.md
 * §1.4 "platform operator console"): society CRUD, flat-register CSV
 * import, and VENDOR/OPERATOR account provisioning, all OPERATOR-only.
 * AuditModule is imported explicitly (it isn't @Global()) because
 * SocietiesService/FlatsService/AccountsService call AuditService directly
 * rather than only through the global AuditLogInterceptor.
 */
@Module({
  imports: [AuditModule],
  controllers: [OperatorController, SocietiesController, FlatsController, AccountsController],
  providers: [SocietiesService, FlatsService, AccountsService],
})
export class OperatorModule {}
