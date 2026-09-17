import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { RealtimeService, DOMAIN_EVENT_NAME, type DomainEventEnvelope } from '../src/modules/realtime/realtime.service.js';
import { RealtimeIoAdapter } from '../src/modules/realtime/realtime-io.adapter.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole } from '../src/generated/prisma/enums.js';

/**
 * Real-time push layer e2e (BACKEND_PLAN.md's WebSocket push item):
 * RealtimeGateway + RealtimeService, wired into ServiceRequestsService's
 * create() as the headline publish source, proved against a REAL Socket.IO
 * server (app.listen(0), not just supertest's ephemeral per-request
 * server — a persistent WS connection needs an actual bound port) and a
 * real socket.io-client.
 *
 * Covers the Definition of Done directly:
 *  1. an authenticated resident's socket receives the `domain-event` push
 *     for a service request created in their own society, well within the
 *     ~1s budget;
 *  2. a socket with no/invalid session token never joins any room — the
 *     gateway disconnects it outright, and it never sees a `domain-event`;
 *  3. a resident of society B does not receive society A's push (room
 *     isolation — societies never share a `society:<id>` room);
 *  3b. a resident RAISING a pooled bulk-buy request (Flow B,
 *     POST /bulk-buy/polls) pushes `service_request.created` to a
 *     neighbour's socket, and a single neighbour joining pushes
 *     `service_request.joined` — deliberately not `pooled`, which clients
 *     surface as "the threshold was reached";
 *  4. the push is post-commit and best-effort: with RealtimeService's
 *     `emitToSociety` stubbed to throw, the underlying REST create still
 *     returns 201 and the row is durably committed (fresh Prisma read) —
 *     a broken push can never make an already-committed create look like
 *     it failed.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

/** Pulls the raw (unsigned) session token out of a Set-Cookie header — sockets have no cookie jar, so the token is passed explicitly via `auth.token`. */
function extractSidToken(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const entry of values) {
    const match = entry.match(/^sid=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  throw new Error(`No "sid" cookie found in Set-Cookie header: ${JSON.stringify(setCookie)}`);
}

function waitForDomainEvent(socket: Socket, timeoutMs = 2000): Promise<DomainEventEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${DOMAIN_EVENT_NAME}"`)), timeoutMs);
    socket.once(DOMAIN_EVENT_NAME, (envelope: DomainEventEnvelope) => {
      clearTimeout(timer);
      resolve(envelope);
    });
  });
}

/** Resolves once the gateway confirms (via `realtime:ready`) that this socket has finished authenticating and joining every room it's entitled to — see RealtimeGateway.handleConnection. Avoids a race where a REST call fires before the socket's async room-join has landed. */
function waitForReady(socket: Socket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for "realtime:ready"`)), timeoutMs);
    socket.once('realtime:ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForDisconnect(socket: Socket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for disconnect`)), timeoutMs);
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ServiceRequestBody {
  id: string;
  status: string;
  title: string;
  societyId?: string;
}

describe('Real-time push layer (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let realtimeService: RealtimeService;
  let baseUrl: string;

  let societyAId: string;
  let societyBId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const vendorIds: string[] = [];
  const openSockets: Socket[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(societyId: string, email: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Realtime Test User ${email}`, email, societyId, flatId, role })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    const rawToken = extractSidToken(verifyRes.headers['set-cookie'] as string[] | string | undefined);

    // Ratification gate — see service-requests.e2e-spec.ts's identical helper for why this is poked directly.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    return { userId, agent, email, rawToken };
  }

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
  }

  /** Connects a socket authenticated the "native app" way (`handshake.auth.token`) — see RealtimeGateway.extractToken. */
  function connectSocket(token?: string): Socket {
    const socket = io(baseUrl, {
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
      transports: ['websocket', 'polling'],
    });
    openSockets.push(socket);
    return socket;
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    // Mirrors main.ts's bootstrap — a real bound port is required here
    // (unlike every other e2e spec) because a persistent WebSocket
    // connection can't ride supertest's ephemeral per-request server.
    app.useWebSocketAdapter(new RealtimeIoAdapter(app));
    await app.listen(0);

    prisma = app.get(PrismaService);
    realtimeService = app.get(RealtimeService);

    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const societyA = await prisma.society.create({ data: { name: `Realtime Society A ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyAId = societyA.id;
    const societyB = await prisma.society.create({ data: { name: `Realtime Society B ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyBId = societyB.id;

    for (let i = 0; i < 2; i++) {
      const flat = await prisma.flat.create({ data: { societyId: societyAId, unitNo: `RTA-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
    const flatB = await prisma.flat.create({ data: { societyId: societyBId, unitNo: `RTB-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatIds.push(flatB.id);
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  });

  afterAll(async () => {
    // AuditLogInterceptor writes audit rows fire-and-forget (never awaited
    // by the response pipeline — see its doc comment), so a write triggered
    // by the very last HTTP call in this suite can still be in flight here;
    // give it a moment to land before cleanup deletes the rows it needs.
    await delay(300);

    await prisma.participation.deleteMany({ where: { serviceRequest: { societyId: { in: [societyAId, societyBId] } } } });
    await prisma.serviceRequest.deleteMany({ where: { societyId: { in: [societyAId, societyBId] } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { societyId: { in: [societyAId, societyBId] } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyAId, societyBId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyAId, societyBId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyAId, societyBId] } } });

    await app.close();
  });

  it('pushes a domain-event to an authenticated resident when a service request is created in their society', async () => {
    const resident = await signupAndLogin(societyAId, `rt-a1-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    const socket = connectSocket(resident.rawToken);
    await waitForReady(socket);
    const eventPromise = waitForDomainEvent(socket);

    const createRes = await resident.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Plumbing', title: 'Leaking tap', description: 'Kitchen tap drips constantly', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    const envelope = await eventPromise;
    expect(envelope.type).toBe('service_request.created');
    expect((envelope.payload as ServiceRequestBody).id).toBe(created.id);
    expect((envelope.payload as ServiceRequestBody).societyId).toBe(societyAId);
    expect(typeof envelope.at).toBe('string');
  });

  it('disconnects a socket with no session token and never delivers it a domain-event', async () => {
    const socket = connectSocket(undefined);
    let received: unknown = null;
    socket.on(DOMAIN_EVENT_NAME, (envelope: DomainEventEnvelope) => {
      received = envelope;
    });

    await waitForDisconnect(socket);
    expect(received).toBeNull();
  });

  it('disconnects a socket with an invalid session token and never delivers it a domain-event', async () => {
    const socket = connectSocket('this-is-not-a-real-session-token');
    let received: unknown = null;
    socket.on(DOMAIN_EVENT_NAME, (envelope: DomainEventEnvelope) => {
      received = envelope;
    });

    await waitForDisconnect(socket);
    expect(received).toBeNull();
  });

  it('does not deliver society A events to a society B resident (room isolation)', async () => {
    const residentA = await signupAndLogin(societyAId, `rt-a2-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    const residentB = await signupAndLogin(societyBId, `rt-b1-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);

    const socketA = connectSocket(residentA.rawToken);
    const socketB = connectSocket(residentB.rawToken);
    await Promise.all([waitForReady(socketA), waitForReady(socketB)]);

    let receivedByB: DomainEventEnvelope | null = null;
    socketB.on(DOMAIN_EVENT_NAME, (envelope: DomainEventEnvelope) => {
      receivedByB = envelope;
    });
    const eventPromiseA = waitForDomainEvent(socketA);

    const createRes = await residentA.agent
      .post('/api/v1/service-requests')
      .send({ category: 'Electrical', title: 'Flickering hallway light', description: 'Common area', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    // Society A's own resident gets it promptly...
    const envelopeA = await eventPromiseA;
    expect((envelopeA.payload as ServiceRequestBody).id).toBe(created.id);

    // ...but society B's resident, watched over the same window, never does.
    await delay(500);
    expect(receivedByB).toBeNull();
  });

  it('pushes service_request.created to a neighbour when a resident raises a pooled bulk-buy request, and service_request.joined (not pooled) on a single join', async () => {
    const raiserFlat = await prisma.flat.create({ data: { societyId: societyAId, unitNo: `RTA-FB1-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const neighbourFlat = await prisma.flat.create({ data: { societyId: societyAId, unitNo: `RTA-FB2-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatIds.push(raiserFlat.id, neighbourFlat.id);
    const vendor = await prisma.vendor.create({ data: { name: `Realtime Flow B Vendor ${randomUUID().slice(0, 8)}` } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId: societyAId } });

    const raiser = await signupAndLogin(societyAId, `rt-fb-raiser-${randomUUID()}@example.com`, raiserFlat.id, OccupancyRole.OWNER_OCCUPIER);
    const neighbour = await signupAndLogin(societyAId, `rt-fb-neighbour-${randomUUID()}@example.com`, neighbourFlat.id, OccupancyRole.TENANT);

    // The neighbour's socket is the one that matters: this is the "shows up
    // live on someone else's Requests tab" case that previously never fired.
    const neighbourSocket = connectSocket(neighbour.rawToken);
    await waitForReady(neighbourSocket);
    const createdEvent = waitForDomainEvent(neighbourSocket);

    const createRes = await raiser.agent
      .post('/api/v1/bulk-buy/polls')
      .send({ taggedVendorId: vendor.id, category: 'Groceries', title: 'Bulk rice order', proposedMinimum: 5, closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    const createdEnvelope = await createdEvent;
    expect(createdEnvelope.type).toBe('service_request.created');
    expect((createdEnvelope.payload as ServiceRequestBody).id).toBe(created.id);
    expect((createdEnvelope.payload as ServiceRequestBody).societyId).toBe(societyAId);
    expect((createdEnvelope.payload as { type: string }).type).toBe('BULK_BUY_RESIDENT');

    // One neighbour joining, far below the proposed minimum of 5 (and no
    // vendor confirmation yet), is a join — not a threshold being reached.
    const raiserSocket = connectSocket(raiser.rawToken);
    await waitForReady(raiserSocket);
    const joinedEvent = waitForDomainEvent(raiserSocket);

    await neighbour.agent.post(`/api/v1/bulk-buy/polls/${created.id}/join`).expect(201);

    const joinedEnvelope = await joinedEvent;
    expect(joinedEnvelope.type).toBe('service_request.joined');
    expect((joinedEnvelope.payload as ServiceRequestBody).id).toBe(created.id);
    expect((joinedEnvelope.payload as ServiceRequestBody).status).toBe('OPEN');
  });

  it('is post-commit and best-effort: a throwing RealtimeService still lets the REST create succeed and commit', async () => {
    const resident = await signupAndLogin(societyAId, `rt-a3-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    const originalEmitToSociety = realtimeService.emitToSociety.bind(realtimeService);
    realtimeService.emitToSociety = async () => {
      throw new Error('Simulated realtime outage');
    };

    try {
      const createRes = await resident.agent
        .post('/api/v1/service-requests')
        .send({ category: 'Carpentry', title: 'Squeaky door', description: 'Main door hinge', closesAt: futureIso(86_400_000) })
        .expect(201);
      const created = createRes.body as ServiceRequestBody;
      expect(created.status).toBe('OPEN');

      // Durable, independent of the (still-successful) HTTP response — the
      // realtime push throwing must never be able to roll back or hide the
      // fact that the create already committed.
      const persisted = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.id } });
      expect(persisted.societyId).toBe(societyAId);
      expect(persisted.title).toBe('Squeaky door');
    } finally {
      realtimeService.emitToSociety = originalEmitToSociety;
    }
  });
});
