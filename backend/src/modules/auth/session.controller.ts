import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import type { OccupancyRole, RoleKind } from '../../generated/prisma/enums.js';

/**
 * The "who am I" shape returned by `GET /auth/session` — always the
 * principal-agnostic fields, plus whichever kind-specific fields that
 * principal's `CurrentUserContext` variant carries (see
 * `common/types/current-user.ts`). `undefined` fields are dropped from the
 * JSON response by Nest's default serializer, so a RESIDENT session never
 * shows a `vendorId: undefined` key and vice versa.
 */
interface SessionResponse {
  principalKind: CurrentUserContext['principalKind'];
  id: string;
  name: string;
  email: string;
  societyId?: string;
  occupancyRole?: OccupancyRole;
  roleKinds?: RoleKind[];
  vendorId?: string;
  /** VENDOR sessions only (Phase 7.1) — every society this vendor is currently linked to. */
  societyIds?: string[];
}

/**
 * The single principal-agnostic identity echo the web console needs:
 * unlike `GET /me` (resident-only), `GET /vendors/me` (vendor-only), and
 * `GET /operator/ping` (operator-only), this route is guarded by
 * `AuthGuard` alone — no `PrincipalGuard`/`@ResidentOnly()` etc — so it
 * serves whichever of the three principal kinds is signed in and reports
 * back which one it was, letting the web client drop its localStorage
 * principal-kind hint in favour of asking the backend directly.
 */
@Controller('auth')
export class SessionController {
  @Get('session')
  @UseGuards(AuthGuard)
  session(@CurrentUser() currentUser: CurrentUserContext): SessionResponse {
    const base = { principalKind: currentUser.principalKind, id: currentUser.id, name: currentUser.name, email: currentUser.email };

    switch (currentUser.principalKind) {
      case 'RESIDENT':
        return { ...base, societyId: currentUser.societyId, occupancyRole: currentUser.occupancyRole, roleKinds: currentUser.roleKinds };
      case 'VENDOR':
        return { ...base, vendorId: currentUser.vendorId, societyIds: currentUser.societyIds };
      case 'OPERATOR':
        return base;
    }
  }
}
