import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PRINCIPAL_KIND_METADATA_KEY } from '../decorators/principal.decorator.js';
import type { PrincipalKind } from '../../generated/prisma/enums.js';
import type { RequestWithUser } from './auth.guard.js';

/**
 * Requires AuthGuard to have already run (needs request.user). Backs
 * `@ResidentOnly()` / `@VendorOnly()` / `@OperatorOnly()`: allows the
 * request only if the caller's principalKind matches the one the route
 * declared; routes without any of those decorators are allowed through
 * unchanged (same "opt-in" shape as RolesGuard).
 */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride (not plain get(..., context.getHandler())) so a
    // class-level `@ResidentOnly()`/etc. (e.g. UsersController) is honored
    // too, not just a method-level one (e.g. VendorsController.me,
    // OperatorController.ping) — method-level always wins if both are set.
    const required = this.reflector.getAllAndOverride<PrincipalKind | undefined>(PRINCIPAL_KIND_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.principalKind !== required) {
      throw new ForbiddenException(`Requires a ${required} account`);
    }

    return true;
  }
}
