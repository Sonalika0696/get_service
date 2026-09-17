import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service.js';
import { UserContextService } from '../users/user-context.service.js';
import { AppConfigService } from '../../config/config.service.js';
import { RealtimeService } from './realtime.service.js';

const BEARER_PREFIX = 'Bearer ';

/** Minimal, dependency-free `Cookie` header parser — mirrors what `cookie-parser` does for unsigned cookies (no secret is configured — see auth.controller.ts's `res.cookie(...)` calls), without adding a new package just for the gateway's handshake, which never runs through Express's cookie-parser middleware. */
function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (!key) continue;
    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

/**
 * Real-time push channel (see RealtimeService's doc comment for the
 * emit-side API/room scheme). CORS is wired dynamically off
 * `AppConfigService.env.API_CORS_ORIGIN` by `RealtimeIoAdapter`
 * (registered in main.ts via `app.useWebSocketAdapter(...)`) rather than a
 * static `@WebSocketGateway({ cors: ... })` literal, since the decorator's
 * options are fixed at class-decoration time and can't read a DI'd config
 * service — the adapter is the documented Nest pattern for env-driven
 * Socket.IO options. Functionally this matches `main.ts`'s
 * `app.enableCors({ origin: config.env.API_CORS_ORIGIN, credentials: true })`
 * for the WebSocket transport too.
 *
 * Auth on connect mirrors AuthGuard's extraction (see
 * common/guards/auth.guard.ts) with the SAME cookie-first-then-bearer
 * order, adapted to the two places Socket.IO exposes them: the native app
 * has no cookie jar, so it sends `handshake.auth.token`; the web app
 * connects with `withCredentials: true` and its `sid` cookie rides along on
 * the handshake's `Cookie` header exactly like any other same-origin
 * request. A session that fails to validate is disconnected before joining
 * ANY room — no partial/anonymous membership.
 */
@WebSocketGateway({ cors: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly userContextService: UserContextService,
    private readonly config: AppConfigService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.debug(`Socket ${client.id} disconnected — no session token in handshake`);
        client.disconnect(true);
        return;
      }

      const session = await this.sessionService.validate(token);
      if (!session) {
        this.logger.debug(`Socket ${client.id} disconnected — session invalid or expired`);
        client.disconnect(true);
        return;
      }

      const userContext = await this.userContextService.load(session.userId);
      if (!userContext) {
        this.logger.debug(`Socket ${client.id} disconnected — no active society membership for user ${session.userId}`);
        client.disconnect(true);
        return;
      }

      await client.join(`user:${userContext.id}`);

      if (userContext.principalKind === 'RESIDENT') {
        await client.join(`society:${userContext.societyId}`);
      } else if (userContext.principalKind === 'VENDOR') {
        for (const societyId of userContext.societyIds) {
          await client.join(`society:${societyId}`);
        }
      }
      // OPERATOR: platform-level principal, scoped to no single society — see this class's doc comment;
      // it still gets its own `user:<id>` room like every other principal kind, for future operator-targeted pushes.

      // Room joins above are awaited, so by the time this fires the socket
      // is guaranteed to be a member of every room it's entitled to — a
      // client can use this to know it's safe to rely on live pushes
      // rather than racing its own "connected" state against this
      // handler's async auth/room-join work.
      client.emit('realtime:ready');
    } catch (error) {
      this.logger.error(`Error authenticating socket ${client.id} — disconnecting`, error instanceof Error ? error.stack : String(error));
      client.disconnect(true);
    }
  }

  /** Cookie checked first (mirrors AuthGuard.extractToken exactly), then the native app's `auth.token` bearer field. */
  private extractToken(client: Socket): string | undefined {
    const cookieHeader = client.handshake.headers.cookie;
    if (typeof cookieHeader === 'string') {
      const cookies = parseCookieHeader(cookieHeader);
      const cookieToken = cookies[this.config.env.SESSION_COOKIE_NAME];
      if (cookieToken) return cookieToken;
    }

    const authToken = client.handshake.auth?.token as unknown;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith(BEARER_PREFIX)) {
      const bearerToken = authHeader.slice(BEARER_PREFIX.length).trim();
      return bearerToken || undefined;
    }

    return undefined;
  }
}
