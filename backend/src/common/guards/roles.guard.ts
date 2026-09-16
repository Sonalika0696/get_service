import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator.js';
import type { RoleKind } from '../../generated/prisma/enums.js';
import type { RequestWithUser } from './auth.guard.js';

/**
 * Requires AuthGuard to have already run (needs request.user). Allows the
 * request if the caller holds at least one of the RoleKinds set by
 * `@Roles(...)`; routes without that decorator are allowed through
 * unchanged.
 *
 * Phase 6.2: `roleKinds` only exists on a ResidentPrincipal (committee/
 * treasurer roles are society-scoped, resident-only concepts) — a VENDOR or
 * OPERATOR caller never has one, so it always 403s on a `@Roles(...)`
 * route rather than crashing.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<RoleKind[] | undefined>(ROLES_METADATA_KEY, context.getHandler());
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    const userRoleKinds = user && user.principalKind === 'RESIDENT' ? user.roleKinds : [];
    const hasRequiredRole = requiredRoles.some((role) => userRoleKinds.includes(role));
    if (!hasRequiredRole) {
      throw new ForbiddenException(`Requires one of: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
