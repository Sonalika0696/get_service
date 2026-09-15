import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { SessionService } from './session.service.js';

/**
 * Global: AuthGuard/RolesGuard/SocietyScopeGuard need to be usable via
 * `@UseGuards(...)` from any feature module without each one importing
 * AuthModule + UsersModule itself. UsersModule is imported one-directionally
 * here (for UserContextService) — it does not import AuthModule back.
 */
@Global()
@Module({
  imports: [NotificationsModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionService, AuthGuard, RolesGuard, SocietyScopeGuard],
  // Re-export UsersModule itself (not just a provider token) so consumers
  // of AuthGuard elsewhere can resolve its UserContextService dependency.
  exports: [SessionService, AuthGuard, RolesGuard, SocietyScopeGuard, UsersModule],
})
export class AuthModule {}
