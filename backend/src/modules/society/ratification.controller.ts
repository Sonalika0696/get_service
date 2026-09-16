import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { OccupancyModel } from '../../generated/prisma/models.js';
import { DecideRatificationDto } from './dto/decide-ratification.dto.js';
import { RatificationService } from './ratification.service.js';

/**
 * Committee ratification queue (BACKEND_PLAN.md Phase 6.3 item 5). Only a
 * COMMITTEE or TREASURER officer may ratify/reject — matches the task
 * brief exactly ("only a committee officer (RoleKind COMMITTEE/TREASURER)
 * can ratify"). No `@AuditLog(...)` on ratify/reject — RatificationService
 * writes its own entries; see its doc comment.
 */
// NOTE: `@Roles(...)`/`@SocietyScope()` are repeated per-handler, not
// hoisted to the class — see OccupancyController's identical note (both
// guards read handler-level metadata only, unlike PrincipalGuard).
@Controller('society/:sid/ratifications')
@UseGuards(AuthGuard, PrincipalGuard, SocietyScopeGuard, RolesGuard)
@ResidentOnly()
export class RatificationController {
  constructor(private readonly ratificationService: RatificationService) {}

  @Get()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  async listPending(@Param('sid') sid: string): Promise<OccupancyModel[]> {
    return this.ratificationService.listPending(sid);
  }

  @Post(':id/ratify')
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  async ratify(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Param('id') id: string, @Body() dto: DecideRatificationDto): Promise<OccupancyModel> {
    return this.ratificationService.ratify(sid, currentUser.id, id, dto);
  }

  @Post(':id/reject')
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  async reject(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Param('id') id: string, @Body() dto: DecideRatificationDto): Promise<OccupancyModel> {
    return this.ratificationService.reject(sid, currentUser.id, id, dto);
  }
}
