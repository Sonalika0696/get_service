import { SetMetadata } from '@nestjs/common';
import type { RoleKind } from '../../generated/prisma/enums.js';

export const ROLES_METADATA_KEY = 'roles';

/** RolesGuard allows the request if the user holds at least one of these RoleKinds in their society. */
export const Roles = (...kinds: RoleKind[]) => SetMetadata(ROLES_METADATA_KEY, kinds);
