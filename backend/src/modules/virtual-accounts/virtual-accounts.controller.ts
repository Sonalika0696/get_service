import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { VirtualAccountsService, type VirtualAccountDetail } from './virtual-accounts.service.js';

/**
 * Phase 9.1 committee-facing read of a flat's VirtualAccount — DECISIONS_V2_SCOPE.md
 * §1.4's "committee gets read access to its own society's operational
 * data" area. Same "committee is a kind of resident holding a Role" shape
 * as ServiceRequestsController's committee routes (ResidentOnly +
 * RolesGuard + Roles(COMMITTEE)) — a plain resident (no COMMITTEE role) is
 * 403d, and residents don't get their own read route in this sub-phase
 * per the phase brief (they don't need to see the raw code yet).
 *
 * `@Roles(...)` is applied at the METHOD level, not the class — RolesGuard
 * reads its metadata via `context.getHandler()` only (see its doc comment;
 * unlike PrincipalGuard, it does not fall back to `context.getClass()`), so
 * a class-level `@Roles(...)` would silently never be read and every
 * resident (not just committee) would pass.
 */
@Controller('flats')
@UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
@ResidentOnly()
export class VirtualAccountsController {
  constructor(private readonly virtualAccounts: VirtualAccountsService) {}

  @Get(':id/virtual-account')
  @Roles(RoleKind.COMMITTEE)
  async getForFlat(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<VirtualAccountDetail> {
    return this.virtualAccounts.getForFlat(currentUser.societyId, id);
  }
}
