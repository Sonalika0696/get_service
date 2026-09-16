import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserContext, ResidentPrincipal } from '../types/current-user.js';

interface RequestWithUser extends Request {
  user?: CurrentUserContext;
}

/**
 * Requires AuthGuard to have run first — throws if request.user is unset.
 * Returns whichever principal kind authenticated (resident/vendor/operator);
 * narrow on `.principalKind` yourself, or prefer `@CurrentResident()` below
 * on a route that only ever serves residents.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) {
    throw new Error('@CurrentUser() used on a route without AuthGuard');
  }
  return request.user;
});

/**
 * Like `@CurrentUser()`, but asserts (and types) the caller as a RESIDENT
 * principal — 403s otherwise. Used by every route built for the resident
 * business surface (job blog, polls, bulk-buy, vendor directory, ledger,
 * payments, ...) now that AuthGuard also accepts VENDOR/OPERATOR sessions
 * (Phase 6.2) — those routes assume `societyId`/`occupancyRole`/`roleKinds`
 * are present, which is only true for a ResidentPrincipal.
 */
export const CurrentResident = createParamDecorator((_data: unknown, ctx: ExecutionContext): ResidentPrincipal => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) {
    throw new Error('@CurrentResident() used on a route without AuthGuard');
  }
  if (request.user.principalKind !== 'RESIDENT') {
    throw new ForbiddenException('This route requires a resident account');
  }
  return request.user;
});
