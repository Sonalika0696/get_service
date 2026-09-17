import { Controller, Get, Headers, HttpStatus, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { ApprovalsService } from './approvals.service.js';
import type { ApprovalsInboxResponse } from './approval-item.types.js';

/**
 * `GET /me/approvals` — see ApprovalsService's doc comment for the full
 * design. No `:sid` route param (society is always the caller's own, like
 * PocketTransfersController), so there is nothing for `SocietyScopeGuard`
 * to check here — omitted rather than added as a documented no-op, to keep
 * this controller's guard list minimal and honest.
 *
 * `@Roles(...)` is repeated per-handler rather than hoisted to the class —
 * `RolesGuard` (like `SocietyScopeGuard`) reads handler-level metadata only
 * via `Reflector.get(key, context.getHandler())`, not
 * `getAllAndOverride([handler, class])` the way `PrincipalGuard` does for
 * `@ResidentOnly()` — see PocketTransfersController's identical note.
 * `@ResidentOnly()` is safe to keep at class level for that reason.
 */
@Controller('me/approvals')
@UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
@ResidentOnly()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async getInbox(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApprovalsInboxResponse | undefined> {
    const startedAt = Date.now();
    const inbox = await this.approvals.getInbox(currentUser.societyId, currentUser.id, currentUser.roleKinds);
    const durationMs = Date.now() - startedAt;
    res.set('Server-Timing', `db;dur=${durationMs}`);

    const etag = computeEtag(inbox);
    res.set('ETag', etag);
    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return inbox;
  }
}
