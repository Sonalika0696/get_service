import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SOCIETY_SCOPE_METADATA_KEY } from '../decorators/society-scope.decorator.js';
import type { RequestWithUser } from './auth.guard.js';

/**
 * Requires AuthGuard to have already run. On routes marked `@SocietyScope()`
 * and carrying a `:sid` param, rejects the request unless it matches the
 * caller's own society — otherwise a committee member of Society A could
 * manage Society B's data just by editing the URL.
 *
 * Phase 6.2: an OPERATOR principal bypasses this check entirely — an
 * operator is platform-level and carries no societyId at all, so "does :sid
 * match the caller's society" isn't a meaningful question for them; the
 * platform-operator role is itself the authorisation.
 */
@Injectable()
export class SocietyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isScoped = this.reflector.get<boolean | undefined>(SOCIETY_SCOPE_METADATA_KEY, context.getHandler());
    if (!isScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (user?.principalKind === 'OPERATOR') {
      return true;
    }

    const sid = request.params.sid;
    const userSocietyId = user && 'societyId' in user ? user.societyId : undefined;
    if (sid && sid !== userSocietyId) {
      throw new ForbiddenException('Not a member of this society');
    }

    return true;
  }
}
