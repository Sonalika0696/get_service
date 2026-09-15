import type { OccupancyRole, RoleKind } from '../../generated/prisma/enums.js';

/** Attached to `request.user` by AuthGuard once a session is validated. */
export interface CurrentUserContext {
  id: string;
  name: string;
  email: string;
  /** v1 assumption: one user has exactly one active occupancy/society. */
  societyId: string;
  occupancyRole: OccupancyRole;
  roleKinds: RoleKind[];
}
