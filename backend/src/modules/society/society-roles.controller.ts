import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
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
import type { RoleModel } from '../../generated/prisma/models.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';
import { SocietyRolesService } from './society-roles.service.js';

// NOTE: `@Roles(...)`/`@SocietyScope()` are repeated per-handler, not
// hoisted to the class — see OccupancyController's identical note (both
// guards read handler-level metadata only, unlike PrincipalGuard).
/**
 * Committee-only role assignment (BACKEND_PLAN.md Phase 6.3 item 8) — same
 * COMMITTEE gate as vendor onboarding elsewhere in this repo. No
 * `@AuditLog(...)` on assign/revoke — SocietyRolesService writes its own
 * (best-effort, awaited) entries; see its class doc comment.
 */
@Controller('society/:sid/roles')
@UseGuards(AuthGuard, PrincipalGuard, SocietyScopeGuard, RolesGuard)
@ResidentOnly()
export class SocietyRolesController {
  constructor(private readonly societyRolesService: SocietyRolesService) {}

  @Get()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  async list(@Param('sid') sid: string): Promise<RoleModel[]> {
    return this.societyRolesService.list(sid);
  }

  @Post()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  async assign(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Body() dto: AssignRoleDto): Promise<RoleModel> {
    return this.societyRolesService.assign(sid, currentUser.id, dto);
  }

  @Delete(':id')
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Param('id') id: string): Promise<void> {
    await this.societyRolesService.revoke(sid, currentUser.id, id);
  }
}
