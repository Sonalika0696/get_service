import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../../modules/auth/session.service.js';
import { UserContextService } from '../../modules/users/user-context.service.js';
import { AppConfigService } from '../../config/config.service.js';
import type { CurrentUserContext } from '../types/current-user.js';

export interface RequestWithUser extends Request {
  user?: CurrentUserContext;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Reads the session token — from the session cookie, or (Phase 6.2, for the
 * native client) an `Authorization: Bearer <token>` header — validates it
 * against the Session table, loads the user's auth context (principal kind
 * plus whatever that kind carries: society/occupancy/roles for a resident,
 * vendor id + society for a vendor, nothing society-scoped for an
 * operator), and attaches it to `request.user`. Apply with
 * `@UseGuards(AuthGuard)` on any controller/route that requires a signed-in
 * principal of any kind — pair with PrincipalGuard's
 * `@ResidentOnly()`/`@VendorOnly()`/`@OperatorOnly()` to restrict to one.
 *
 * The cookie is checked first so existing cookie-based sessions keep
 * working unchanged; the bearer header is only consulted when no cookie is
 * present, not merged or preferred over it.
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

    const token = this.extractToken(request);
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

  private extractToken(request: RequestWithUser): string | undefined {
    const cookieToken = request.cookies?.[this.config.env.SESSION_COOKIE_NAME] as string | undefined;
    if (cookieToken) return cookieToken;

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith(BEARER_PREFIX)) {
      const bearerToken = authHeader.slice(BEARER_PREFIX.length).trim();
      return bearerToken || undefined;
    }

    return undefined;
  }
}
