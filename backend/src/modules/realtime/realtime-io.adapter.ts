import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import { AppConfigService } from '../../config/config.service.js';

/**
 * Registered in main.ts via `app.useWebSocketAdapter(new RealtimeIoAdapter(app))`.
 * `@WebSocketGateway()`'s options are fixed at class-decoration time, so
 * there's no way for a static decorator literal to read a DI'd
 * `AppConfigService` — this adapter is the documented Nest pattern for
 * env-driven Socket.IO server options instead: it resolves
 * `AppConfigService` from the already-bootstrapped app container the first
 * time Nest asks it to construct the underlying `socket.io` server, and
 * merges in the SAME CORS policy `main.ts` gives the plain HTTP API via
 * `app.enableCors(...)` — one allowed origin, credentials on, so the `sid`
 * session cookie rides along on the WebSocket handshake exactly like it
 * does on a normal fetch.
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  // Return type widened to `any` (matches Nest's own documented example for
  // this exact override) — `options` may be `undefined`, and spreading a
  // possibly-undefined `ServerOptions` makes every property optional,
  // which no longer satisfies `ServerOptions`'s own (non-optional) field
  // types; there is no precise supertype to declare here instead.
  override createIOServer(port: number, options?: ServerOptions): any {
    const config = this.app.get(AppConfigService);
    const optionsWithCors = {
      ...options,
      cors: {
        origin: config.env.API_CORS_ORIGIN,
        credentials: true,
      },
    };
    return super.createIOServer(port, optionsWithCors as ServerOptions);
  }
}
