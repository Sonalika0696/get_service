import type { OccupancyRole, RoleKind } from '../../generated/prisma/enums.js';

interface BasePrincipal {
  id: string;
  name: string;
  email: string;
}

/**
 * A resident: identity anchored to phone OTP (DECISIONS_V2_SCOPE.md §7.1),
 * scoped to one active occupancy/society (v1 assumption — one user, one
 * active occupancy at a time, see UserContextService).
 */
export interface ResidentPrincipal extends BasePrincipal {
  principalKind: 'RESIDENT';
  societyId: string;
  occupancyRole: OccupancyRole;
  roleKinds: RoleKind[];
}

/**
 * A vendor: identity anchored to password + mandatory TOTP 2FA
 * (DECISIONS_V2_SCOPE.md §7.2), linked to exactly one Vendor row via
 * User.vendorId — and, transitively, that Vendor's home society. See
 * Phase 7's note about splitting Vendor from VendorSocietyLink once a
 * vendor can serve multiple societies.
 */
export interface VendorPrincipal extends BasePrincipal {
  principalKind: 'VENDOR';
  vendorId: string;
  societyId: string;
}

/**
 * A platform operator: identity anchored to password + mandatory TOTP 2FA,
 * no society scope at all — see SocietyScopeGuard's operator bypass.
 */
export interface OperatorPrincipal extends BasePrincipal {
  principalKind: 'OPERATOR';
}

/**
 * Attached to `request.user` by AuthGuard once a session is validated.
 * Discriminated on `principalKind` — see BACKEND_PLAN.md Phase 6.2.
 * `societyId`/`occupancyRole`/`roleKinds` are NOT unconditionally present
 * any more; narrow with `principalKind` (or use `@CurrentResident()` /
 * `@ResidentOnly()` on a route that only ever serves residents).
 */
export type CurrentUserContext = ResidentPrincipal | VendorPrincipal | OperatorPrincipal;
