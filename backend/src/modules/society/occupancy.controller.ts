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
import { MoveInDto } from './dto/move-in.dto.js';
import { OccupancyService } from './occupancy.service.js';

/**
 * Committee-scoped occupancy management (BACKEND_PLAN.md Phase 6.3 item 4).
 * COMMITTEE, not OPERATOR — this is routine, day-to-day society membership
 * upkeep (a paper-form move-in, a tenant leaving), the same shape of
 * decision as onboarding a vendor (VendorsController, also COMMITTEE-only).
 * Contrast the platform operator's society/flat-register/account
 * provisioning surface (`operator/` module), which is deliberately
 * OPERATOR-only instead.
 */
// NOTE: `@Roles(...)` (RolesGuard) and `@SocietyScope()` (SocietyScopeGuard)
// read their metadata with `Reflector.get(key, context.getHandler())` —
// method-level ONLY, unlike PrincipalGuard's `getAllAndOverride` (which also
// honors a class-level `@ResidentOnly()`). Both decorators below are
// therefore repeated on every handler, not hoisted to the class — a
// class-level `@Roles(...)`/`@SocietyScope()` here would be silently
// invisible to their guards and every route would pass unguarded.
@Controller('society/:sid/occupancies')
@UseGuards(AuthGuard, PrincipalGuard, SocietyScopeGuard, RolesGuard)
@ResidentOnly()
export class OccupancyController {
  constructor(private readonly occupancyService: OccupancyService) {}

  @Get()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  async list(@Param('sid') sid: string): Promise<OccupancyModel[]> {
    return this.occupancyService.listForSociety(sid);
  }

  /** No `@AuditLog(...)` — OccupancyService.moveIn writes its own (best-effort) entry; see its doc comment. */
  @Post()
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  async moveIn(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Body() dto: MoveInDto): Promise<OccupancyModel> {
    return this.occupancyService.moveIn(sid, currentUser.id, dto);
  }

  /** No `@AuditLog(...)` — OccupancyService.moveOut writes its own (best-effort) entry; see its doc comment. */
  @Post(':id/move-out')
  @SocietyScope()
  @Roles(RoleKind.COMMITTEE)
  async moveOut(@CurrentResident() currentUser: ResidentPrincipal, @Param('sid') sid: string, @Param('id') id: string): Promise<OccupancyModel> {
    return this.occupancyService.moveOut(sid, currentUser.id, id);
  }
}
