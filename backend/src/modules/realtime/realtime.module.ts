import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Imports AuthModule (for SessionService) and UsersModule (for
 * UserContextService) — both already exported by AuthModule (see its doc
 * comment: it re-exports UsersModule itself so any consumer of
 * SessionService/AuthGuard can resolve UserContextService too). AuthModule
 * is `@Global()`, so these would already be injectable without this import,
 * but declaring it explicitly documents the real dependency instead of
 * relying on global registration.
 */
@Module({
  imports: [AuthModule, UsersModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
