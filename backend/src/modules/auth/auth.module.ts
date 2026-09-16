import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from '../../config/config.module.js';
import { AppConfigService } from '../../config/config.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OfficerAuthController } from './officer-auth.controller.js';
import { OfficerAuthService } from './officer-auth.service.js';
import { OtpService } from './otp.service.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';

/**
 * Global: AuthGuard/RolesGuard/SocietyScopeGuard/PrincipalGuard need to be
 * usable via `@UseGuards(...)` from any feature module without each one
 * importing AuthModule + UsersModule itself. UsersModule is imported
 * one-directionally here (for UserContextService) — it does not import
 * AuthModule back.
 *
 * Phase 6.5: ThrottlerModule is registered HERE (not in AppModule) so the
 * rate-limit guard's blast radius is scoped to this module's own DI graph —
 * AuthController/OfficerAuthController opt into it per-route via
 * `@UseGuards(ThrottlerGuard)` + `@Throttle(...)` (see those controllers).
 * No other module gets a global throttling guard. Gated by
 * THROTTLE_ENABLED (on by default; dev/test set it false in backend/.env —
 * see env.schema.ts's doc comment for why: the e2e suite's fixture helpers
 * sign up/verify/enroll hundreds of times per run). The store is
 * `ThrottlerStorageService`, an in-memory
 * Map — correct for a single instance only. Once this service runs behind
 * more than one instance, the limits below become per-instance instead of
 * global (an attacker could get N× the intended limit by hitting different
 * instances), so a shared store (e.g. `@nestjs/throttler`'s Redis storage
 * adapter) will be needed at that point.
 */
@Global()
@Module({
  imports: [
    NotificationsModule,
    UsersModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
        // Keyed per client IP by @nestjs/throttler's default getTracker
        // (req.ip) — deliberately NOT overridden to key on phone/email, so
        // no credential ever ends up in the throttle store or its logs.
        skipIf: () => !config.env.THROTTLE_ENABLED,
      }),
    }),
  ],
  controllers: [AuthController, OfficerAuthController, SessionController],
  providers: [AuthService, OfficerAuthService, OtpService, SessionService, AuthGuard, RolesGuard, SocietyScopeGuard, PrincipalGuard],
  // Re-export UsersModule itself (not just a provider token) so consumers
  // of AuthGuard elsewhere can resolve its UserContextService dependency.
  exports: [SessionService, AuthGuard, RolesGuard, SocietyScopeGuard, PrincipalGuard, UsersModule],
})
export class AuthModule {}
