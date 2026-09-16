import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { OccupancyController } from './occupancy.controller.js';
import { OccupancyService } from './occupancy.service.js';
import { RatificationController } from './ratification.controller.js';
import { RatificationService } from './ratification.service.js';
import { SocietyRolesController } from './society-roles.controller.js';
import { SocietyRolesService } from './society-roles.service.js';

/**
 * Phase 6.3 (BACKEND_PLAN.md Phase 6.3 items 4, 5, 8): COMMITTEE-scoped
 * society-management surface — occupancy move-in/move-out, the ratification
 * queue, and role assignment. Distinct from the OPERATOR-only `operator/`
 * module (society CRUD, flat import, account provisioning) — see
 * OccupancyController's class doc comment for the COMMITTEE-vs-OPERATOR
 * split rationale.
 */
@Module({
  imports: [AuditModule],
  controllers: [OccupancyController, RatificationController, SocietyRolesController],
  providers: [OccupancyService, RatificationService, SocietyRolesService],
})
export class SocietyModule {}
