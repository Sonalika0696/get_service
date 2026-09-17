import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Single Socket.IO event name every client listens on; `type` inside the envelope discriminates the payload shape. */
export const DOMAIN_EVENT_NAME = 'domain-event';

/**
 * Discriminator values emitted today. Phase 9.2 (maintenance billing) adds
 * `bill.published` (MaintenanceBillingService.generateForPeriod, post-commit,
 * pushed to the flat's primary ratified resident) and `bill.paid`
 * (PaymentsService.applyCapture's MaintenanceCharge branch, post-commit,
 * same resident) down `emitToUser` — see that method's doc comment.
 * `bill.updated` is reserved for a future charge-mutation push (e.g. a
 * late-fee accrual pass or a waiver) — nothing emits it yet.
 */
export type DomainEventType =
  | 'service_request.created'
  | 'service_request.pooled'
  | 'service_request.joined'
  | 'service_request.assigned'
  | 'service_request.confirmed'
  | 'service_request.cancelled'
  | 'event.created'
  | 'event.fired'
  | 'event.expired'
  | 'bill.published'
  | 'bill.paid'
  | 'bill.updated';

export interface DomainEventEnvelope<T = unknown> {
  type: DomainEventType | string;
  payload: T;
  at: string;
}

/**
 * Thin push layer over the Socket.IO server RealtimeGateway hands it at
 * `afterInit` (see that gateway's doc comment — this service has no
 * dependency on the gateway itself, only on the `Server` instance, so
 * there's no circular DI). Every method here is a fire-and-forget,
 * best-effort wrapper: a push failure (no listeners, a serialization edge
 * case, the server not being ready yet) is logged and swallowed, NEVER
 * thrown to the caller — callers sit on the post-commit side of a money/
 * state transition (see service-requests.service.ts, polls.service.ts) and
 * must be able to treat this exactly like the notification dispatch beside
 * it: a delivery-layer hiccup can never roll back or appear to fail an
 * already-committed change.
 *
 * Room scheme (joined by RealtimeGateway.handleConnection):
 *   - `user:<userId>`    — every connected principal, always. Reserved for
 *     Phase 9 bill pushes (per-resident) via emitToUser — nothing publishes
 *     to it yet.
 *   - `society:<societyId>` — a RESIDENT's own society; a VENDOR's every
 *     linked society (one join per societyId in `societyIds`). An OPERATOR
 *     joins no society room (platform-level, not scoped to one society) —
 *     see RealtimeGateway's doc comment for that call.
 *
 * Scaling note: the default Socket.IO adapter (in-memory) only fans a
 * `server.to(room).emit(...)` out to sockets connected to THIS process — it
 * has no cross-instance awareness. Exactly like ThrottlerModule's in-memory
 * store (see auth.module.ts's doc comment), this is correct for exactly one
 * backend instance. Running more than one requires wiring a shared adapter
 * (e.g. `@socket.io/redis-adapter`) before rooms/emits behave as intended
 * behind a load balancer.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once by RealtimeGateway.afterInit with the live Socket.IO server. */
  setServer(server: Server): void {
    this.server = server;
  }

  /** Pushes to every socket that joined `society:<societyId>` — see this class's doc comment for who that is. */
  async emitToSociety(societyId: string, type: DomainEventType | string, payload: unknown): Promise<void> {
    await this.emitToRoom(`society:${societyId}`, type, payload);
  }

  /**
   * Pushes to every socket for one user, across however many devices/tabs
   * they have connected — every principal joins `user:<id>` on connect (see
   * this class's doc comment), so this works uniformly for a resident,
   * vendor, or operator. Nothing calls this yet: it is the clean seam Phase
   * 9 (bills) hooks into — a bill publish will call
   * `emitToUser(residentId, 'bill.published', { ... })` the exact same way
   * the pooling loop below calls emitToSociety, with the same post-commit/
   * best-effort placement.
   */
  async emitToUser(userId: string, type: DomainEventType | string, payload: unknown): Promise<void> {
    await this.emitToRoom(`user:${userId}`, type, payload);
  }

  private async emitToRoom(room: string, type: DomainEventType | string, payload: unknown): Promise<void> {
    try {
      if (!this.server) {
        this.logger.warn(`Dropped domain event "${type}" for room ${room} — Socket.IO server not initialized yet`);
        return;
      }
      const envelope: DomainEventEnvelope = { type, payload, at: new Date().toISOString() };
      this.server.to(room).emit(DOMAIN_EVENT_NAME, envelope);
    } catch (error) {
      this.logger.error(`Failed to emit domain event "${type}" to room ${room}`, error instanceof Error ? error.stack : String(error));
    }
  }
}
