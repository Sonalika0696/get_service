import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserContext } from '../types/current-user.js';

interface RequestWithUser extends Request {
  user?: CurrentUserContext;
}

/** Requires AuthGuard to have run first — throws if request.user is unset. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUserContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) {
    throw new Error('@CurrentUser() used on a route without AuthGuard');
  }
  return request.user;
});
