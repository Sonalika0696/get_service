import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../../modules/auth/session.service.js';
import { UserContextService } from '../../modules/users/user-context.service.js';
import { AppConfigService } from '../../config/config.service.js';
import type { CurrentUserContext } from '../types/current-user.js';

export interface RequestWithUser extends Request {
  user?: CurrentUserContext;
}

/**
 * Reads the session cookie, validates it against the Session table, loads
 * the user's auth context (society, occupancy role, society-level roles),
 * and attaches it to `request.user`. Apply with `@UseGuards(AuthGuard)` on
 * any controller/route that requires a signed-in resident.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly userContextService: UserContextService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const token = request.cookies?.[this.config.env.SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    const session = await this.sessionService.validate(token);
    if (!session) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    const userContext = await this.userContextService.load(session.userId);
    if (!userContext) {
      throw new UnauthorizedException('No active society membership');
    }

    request.user = userContext;
    return true;
  }
}
