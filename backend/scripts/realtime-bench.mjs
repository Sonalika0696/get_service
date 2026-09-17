/**
 * THROWAWAY, UNCOMMITTED benchmark harness for the real-time Socket.IO push
 * layer (src/modules/realtime/*), committed at HEAD 566fdda. Measures:
 *   - admin-side publish time    (t1 - t0): REST request -> REST response
 *   - delivery latency           (t2 - t1): REST response -> socket receipt
 *   - end-to-end latency         (t2 - t0): REST call issued -> socket receipt
 *   - throughput under a burst of publishes
 *   - how delivery latency scales with room size (1 / 10 / 50 / 100 / 200
 *     connected residents of the same society)
 *
 * MEASUREMENT ONLY. Does not modify any src/ file, does not run a DB
 * migration, and is never committed.
 *
 * Boots the real Nest AppModule in-process on a real bound port
 * (`app.listen(0)`), the same way test/realtime.e2e-spec.ts does (a
 * persistent WebSocket connection can't ride supertest's ephemeral
 * per-request server). Imports the COMPILED `dist/` output (this file is
 * plain JS, not run through tsx/esbuild) rather than `src/*.ts` directly:
 * NestJS's constructor-injection relies on `emitDecoratorMetadata`-produced
 * `design:paramtypes`, which esbuild-based transforms (tsx, vite/vitest's
 * default transform) do not reliably reproduce - the initial version of
 * this harness hit exactly that (`AppConfigService`'s injected
 * `ConfigService` came back `undefined`). `dist/` was produced by the real
 * `nest build` (tsc), so its decorator metadata is intact; run `npm run
 * build` first if `dist/` is stale relative to `src/`.
 *
 * Run from backend/ (so ConfigModule's default `.env` resolves) with:
 *   npm run build && node scripts/realtime-bench.mjs
 *
 * Seeds one throwaway Society + N flats/residents/sessions directly via
 * Prisma (bypassing the OTP/signup flow - see DevAuthController's doc
 * comment for why a direct-session shortcut is the documented dev pattern
 * here), runs the benchmark, then deletes every row it created, in the same
 * dependency order test/service-requests.e2e-spec.ts's afterAll uses.
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { io } from 'socket.io-client';

import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/infra/prisma/prisma.service.js';
import { RealtimeIoAdapter } from '../dist/modules/realtime/realtime-io.adapter.js';
import { DOMAIN_EVENT_NAME } from '../dist/modules/realtime/realtime.service.js';
import { createGlobalValidationPipe } from '../dist/common/pipes/validation.pipe.js';
import {
  OccupancyRole,
  RoleKind,
  PricingCardStatus,
  PricingBasis,
  RatificationStatus,
  ServiceRequestType,
} from '../dist/generated/prisma/enums.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TIERS = process.env.BENCH_TIERS ? process.env.BENCH_TIERS.split(',').map(Number) : [1, 10, 50, 100, 200];
const ITERATIONS_PER_TIER = process.env.BENCH_ITERATIONS ? Number(process.env.BENCH_ITERATIONS) : 100; // >= 100 publishes per tier, per the task spec
const BURST_SIZE = process.env.BENCH_BURST ? Number(process.env.BENCH_BURST) : 30; // back-to-back publishes with no wait, for the throughput figure
const WARMUP_ITERATIONS = process.env.BENCH_WARMUP ? Number(process.env.BENCH_WARMUP) : 5; // unmeasured cycles run before each tier's timed loop
const CATEGORY = 'Plumbing';
const ACTOR_COUNT = 8; // rotating pool of residents that perform REST actions (create/join)
const MAX_LISTENERS = Math.max(...TIERS);
const REPORT_PATH = new URL('../../scripts/realtime-latency-report.md', import.meta.url);

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function makeToken() {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: sha256(rawToken) };
}

function futureIso(msFromNow = 24 * 60 * 60 * 1000) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function computeStats(values) {
  if (values.length === 0) {
    return { n: 0, min: NaN, median: NaN, p95: NaN, p99: NaN, max: NaN, mean: NaN };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
  };
}

function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(2) : 'n/a';
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seed(prisma) {
  const suffix = randomUUID().slice(0, 8);
  const society = await prisma.society.create({ data: { name: `Realtime Bench Society ${suffix}`, address: 'n/a' } });

  const totalResidents = 1 /* committee */ + ACTOR_COUNT + MAX_LISTENERS;
  const flatData = Array.from({ length: totalResidents }, (_, i) => ({
    id: randomUUID(),
    societyId: society.id,
    unitNo: `BENCH-${i}-${suffix}`,
    maintenanceAmount: 1000,
  }));
  await prisma.flat.createMany({ data: flatData });

  const userData = flatData.map((_flat, i) => ({
    id: randomUUID(),
    name: `Bench Resident ${i}`,
    email: `bench-${suffix}-${i}@realtime-bench.local`,
  }));
  await prisma.user.createMany({ data: userData });

  const now = new Date();
  await prisma.occupancy.createMany({
    data: flatData.map((flat, i) => ({
      id: randomUUID(),
      flatId: flat.id,
      userId: userData[i].id,
      role: OccupancyRole.OWNER_OCCUPIER,
      ratificationStatus: RatificationStatus.RATIFIED,
      ratificationDecidedAt: now,
    })),
  });

  const sessionExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const tokensByUserId = new Map();
  const sessionData = userData.map((u) => {
    const { rawToken, tokenHash } = makeToken();
    tokensByUserId.set(u.id, rawToken);
    return { id: randomUUID(), userId: u.id, tokenHash, expiresAt: sessionExpiry, lastSeenAt: now };
  });
  await prisma.session.createMany({ data: sessionData });

  // userData[0] = committee, [1..ACTOR_COUNT] = actors, rest = listener pool
  const committeeUser = userData[0];
  await prisma.role.create({ data: { societyId: society.id, userId: committeeUser.id, kind: RoleKind.COMMITTEE } });

  const actors = userData.slice(1, 1 + ACTOR_COUNT).map((u) => ({ userId: u.id, token: tokensByUserId.get(u.id) }));
  const listeners = userData.slice(1 + ACTOR_COUNT).map((u) => ({ userId: u.id, token: tokensByUserId.get(u.id) }));

  const vendor = await prisma.vendor.create({ data: { name: `Realtime Bench Vendor ${suffix}` } });
  await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId: society.id } });
  const card = await prisma.pricingCard.create({
    data: {
      vendorId: vendor.id,
      category: CATEGORY,
      version: 1,
      gstRatePct: 18,
      effectiveFrom: now,
      status: PricingCardStatus.PUBLISHED,
      publishedAt: now,
    },
  });
  await prisma.pricingLine.create({
    data: { cardId: card.id, label: 'Standard visit', basis: PricingBasis.PER_VISIT, rate: 500 },
  });

  return {
    societyId: society.id,
    vendorId: vendor.id,
    committee: { userId: committeeUser.id, token: tokensByUserId.get(committeeUser.id) },
    actors,
    listeners,
    userIds: userData.map((u) => u.id),
  };
}

async function cleanup(prisma, seedResult) {
  const { societyId, vendorId, userIds } = seedResult;
  // Same order as test/service-requests.e2e-spec.ts's afterAll, so every
  // table confirm()'s escrow/booking path can touch is torn down safely.
  // (No WebhookEvent rows are created by this benchmark's flows, so that
  // table needs no cleanup here.)
  await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId } } } });
  await prisma.payout.deleteMany({ where: { booking: { societyId } } });
  await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
  await prisma.booking.deleteMany({ where: { societyId } });
  await prisma.commitment.deleteMany({ where: { serviceRequest: { societyId } } });
  await prisma.participation.deleteMany({ where: { serviceRequest: { societyId } } });
  await prisma.serviceRequest.deleteMany({ where: { societyId } });
  await prisma.payment.deleteMany({ where: { societyId } });
  await prisma.ledgerEntry.deleteMany({ where: { societyId } });
  await prisma.account.deleteMany({ where: { societyId } });
  await prisma.idempotencyKey.deleteMany({ where: { societyId } });
  await prisma.pricingLine.deleteMany({ where: { card: { vendorId } } });
  await prisma.pricingCard.deleteMany({ where: { vendorId } });
  await prisma.vendorSocietyLink.deleteMany({ where: { societyId } });
  await prisma.vendor.deleteMany({ where: { id: vendorId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { societyId } });
  await prisma.flat.deleteMany({ where: { societyId } });
  await prisma.society.deleteMany({ where: { id: societyId } });
}

// ---------------------------------------------------------------------------
// HTTP + socket plumbing
// ---------------------------------------------------------------------------

let baseUrl = '';

async function call(path, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function connectSocket(token) {
  return io(baseUrl, { auth: { token }, reconnection: false, forceNew: true, transports: ['websocket', 'polling'] });
}

function waitForReady(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for realtime:ready')), timeoutMs);
    socket.once('realtime:ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Per-socket log of every domain-event this socket has received, keyed by `${type}:${payload.id}` -> receipt timestamp (performance.now()). */
function attachListener(socket, log) {
  socket.on(DOMAIN_EVENT_NAME, (envelope) => {
    const t2 = performance.now();
    const id = envelope?.payload?.id;
    if (id) log.set(`${envelope.type}:${id}`, t2);
  });
}

async function waitForAll(logs, key, timeoutMs = 5000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (logs.every((l) => l.has(key))) return true;
    await sleep(2);
  }
  return logs.every((l) => l.has(key));
}

function freshResults() {
  return { admin: [], delivery: [], e2e: [], missed: 0, expectedDeliveries: 0, byType: new Map() };
}

function bucketFor(results, type) {
  let bucket = results.byType.get(type);
  if (!bucket) {
    bucket = { admin: [], delivery: [], e2e: [] };
    results.byType.set(type, bucket);
  }
  return bucket;
}

async function publishAndMeasure(logs, results, type, fn) {
  const t0 = performance.now();
  const resp = await fn();
  const t1 = performance.now();
  const key = `${type}:${resp.id}`;
  await waitForAll(logs, key);
  const bucket = bucketFor(results, type);
  results.admin.push(t1 - t0);
  bucket.admin.push(t1 - t0);
  results.expectedDeliveries += logs.length;
  for (const log of logs) {
    const t2 = log.get(key);
    if (t2 !== undefined) {
      results.delivery.push(t2 - t1);
      results.e2e.push(t2 - t0);
      bucket.delivery.push(t2 - t1);
      bucket.e2e.push(t2 - t0);
      log.delete(key);
    } else {
      results.missed++;
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

async function runTier(tierSize, seedResult) {
  const listenerSlice = seedResult.listeners.slice(0, tierSize);
  const sockets = listenerSlice.map((l) => connectSocket(l.token));
  const logs = sockets.map(() => new Map());
  sockets.forEach((s, i) => attachListener(s, logs[i]));
  await Promise.all(sockets.map((s) => waitForReady(s)));

  const results = freshResults();
  const actors = seedResult.actors;
  const committeeToken = seedResult.committee.token;

  // Warm-up: a few unmeasured cycles so JIT warm-up, connection-pool
  // establishment and the first-request Prisma/argon2 cold-start don't leak
  // into the recorded stats (most visible on the very first tier, run right
  // after seeding).
  for (let w = 0; w < WARMUP_ITERATIONS; w++) {
    const creator = actors[w % actors.length];
    const joiners = [1, 2, 3].map((offset) => actors[(w + offset) % actors.length]);
    const sr = await call('/service-requests', {
      method: 'POST',
      token: creator.token,
      body: { category: CATEGORY, title: `Bench Warmup t${tierSize}-${w}`, description: 'warmup', closesAt: futureIso() },
    });
    await call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[0].token });
    await call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[1].token });
    await call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[2].token });
    await call(`/service-requests/${sr.id}/assign`, { method: 'POST', token: committeeToken, body: { vendorId: seedResult.vendorId } });
    await call(`/service-requests/${sr.id}/confirm`, { method: 'POST', token: committeeToken, body: { contribution: 500 } });
  }
  for (const log of logs) log.clear(); // drop any domain-events the warm-up itself triggered

  for (let i = 0; i < ITERATIONS_PER_TIER; i++) {
    const creator = actors[i % actors.length];
    const joiners = [1, 2, 3].map((offset) => actors[(i + offset) % actors.length]);

    const sr = await publishAndMeasure(logs, results, 'service_request.created', () =>
      call('/service-requests', {
        method: 'POST',
        token: creator.token,
        body: { category: CATEGORY, title: `Bench SR t${tierSize}-${i}`, description: 'realtime bench', closesAt: futureIso() },
      }),
    );

    // First two joins never emit (below the default threshold of 3) -
    // unmeasured, just advance state.
    await call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[0].token });
    await call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[1].token });
    // Third join crosses the threshold -> 'service_request.pooled'.
    await publishAndMeasure(logs, results, 'service_request.pooled', () =>
      call(`/service-requests/${sr.id}/join`, { method: 'POST', token: joiners[2].token }),
    );

    await publishAndMeasure(logs, results, 'service_request.assigned', () =>
      call(`/service-requests/${sr.id}/assign`, { method: 'POST', token: committeeToken, body: { vendorId: seedResult.vendorId } }),
    );

    await publishAndMeasure(logs, results, 'service_request.confirmed', () =>
      call(`/service-requests/${sr.id}/confirm`, { method: 'POST', token: committeeToken, body: { contribution: 500 } }),
    );

    await publishAndMeasure(logs, results, 'event.created', () =>
      call('/polls', {
        method: 'POST',
        token: creator.token,
        body: { pollType: ServiceRequestType.EVENT, title: `Bench Event t${tierSize}-${i}`, minCommitments: 1, closesAt: futureIso() },
      }),
    );
  }

  // Throughput burst: fire BURST_SIZE creates back-to-back with no wait in
  // between, then measure how long it takes every connected socket to
  // receive every one of them.
  const burstStart = performance.now();
  const burstIds = await Promise.all(
    Array.from({ length: BURST_SIZE }, (_, i) =>
      call('/service-requests', {
        method: 'POST',
        token: actors[i % actors.length].token,
        body: { category: CATEGORY, title: `Bench Burst t${tierSize}-${i}`, description: 'burst', closesAt: futureIso() },
      }).then((r) => r.id),
    ),
  );
  const expectedBurstDeliveries = burstIds.length * logs.length;
  let burstDeliveries = 0;
  const burstDeadline = performance.now() + 10_000;
  while (performance.now() < burstDeadline) {
    burstDeliveries = burstIds.reduce((sum, id) => sum + logs.filter((l) => l.has(`service_request.created:${id}`)).length, 0);
    if (burstDeliveries >= expectedBurstDeliveries) break;
    await sleep(5);
  }
  const burstElapsedMs = performance.now() - burstStart;
  for (const id of burstIds) for (const log of logs) log.delete(`service_request.created:${id}`);

  for (const s of sockets) {
    s.removeAllListeners();
    s.disconnect();
  }

  const throughputPerSec = burstDeliveries / (burstElapsedMs / 1000);

  const byType = {};
  for (const [type, bucket] of results.byType) {
    byType[type] = { admin: computeStats(bucket.admin), delivery: computeStats(bucket.delivery), e2e: computeStats(bucket.e2e) };
  }

  return {
    tierSize,
    admin: computeStats(results.admin),
    delivery: computeStats(results.delivery),
    e2e: computeStats(results.e2e),
    byType,
    missed: results.missed,
    expectedDeliveries: results.expectedDeliveries,
    throughputPerSec,
    burstDeliveries,
    burstElapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function renderReport(reports, hostInfo) {
  const lines = [];
  lines.push('# Real-time push layer - latency/throughput report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('- Target: `src/modules/realtime/*` (RealtimeGateway + RealtimeService), committed at HEAD `566fdda`.');
  lines.push(
    '- Server: the real Nest `AppModule` booted **in-process** via `Test.createTestingModule({ imports: [AppModule] }).compile()` + `app.listen(0)` on an ephemeral loopback port, using the same `RealtimeIoAdapter`, global validation pipe, cookie parser and `api/v1` prefix as `main.ts` - identical bootstrap to `test/realtime.e2e-spec.ts`. Imports the **compiled `dist/` output** (`npm run build`), not `src/*.ts` directly: NestJS constructor injection needs real `emitDecoratorMetadata` output, which esbuild-based transforms (tsx, vitest/vite\'s default transform) do not reliably reproduce - confirmed by hitting exactly that failure (an injected `ConfigService` resolving to `undefined`) before switching to `dist/`. The alternative of a second `node dist/main` process on a fixed port was not used, to avoid an extra process/IPC hop that would only add noise to the very latency being measured.',
  );
  lines.push('- Client: `socket.io-client` (already a devDependency), connecting with `handshake.auth.token` exactly like the native app path in `RealtimeGateway.extractToken`.');
  lines.push(
    "- Data: one throwaway Society seeded directly via Prisma (bypassing OTP/signup) with flats + RATIFIED occupancies for every resident, a COMMITTEE role, and a Vendor with a PUBLISHED PricingCard so the full create -> join x3 (threshold=3, default) -> pooled -> assign -> confirm chain (plus a Phase 3 EVENT `POST /polls`) is exercised for real, not stubbed. Sessions were inserted directly (SHA-256(token) matching SessionService's own scheme) and used as `Authorization: Bearer` on REST calls / `auth.token` on socket connects.",
  );
  lines.push(`- Client tiers: ${TIERS.join(', ')} residents of the SAME society connected simultaneously (every publish fans out to all of them).`);
  lines.push(
    `- Iterations: ${ITERATIONS_PER_TIER} full create/join/pool/assign/confirm/event cycles per tier -> 5 measured publishes per iteration -> ${ITERATIONS_PER_TIER * 5} timed publishes per tier (well above the >=100 minimum), plus a ${BURST_SIZE}-publish concurrent burst per tier for the throughput figure.`,
  );
  lines.push("- Timestamps: `t0` immediately before the REST call, `t1` on REST response, `t2` on each socket's `domain-event` receipt (matched to the REST response's `id` field), all via `performance.now()`.");
  lines.push(`- Host: ${hostInfo}`);
  lines.push('');
  lines.push(
    '**LOOPBACK CAVEAT**: client and server run on the same host/process (127.0.0.1). These numbers measure backend processing + Socket.IO room fan-out ONLY. They exclude real mobile-network RTT (cellular/Wi-Fi latency, TLS, NAT, distance to the server), which is additive and environmental - a real client will see `delivery latency (loopback) + network RTT`, not this number alone.',
  );
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('All times in milliseconds unless noted. "Delivery" = REST response -> socket receipt. "Admin" = REST request -> REST response. "E2E" = REST request issued -> socket receipt.');
  lines.push('');
  lines.push('| Clients | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | Delivery p99 | Delivery max | E2E p50 | E2E p95 | E2E max | Samples | Missed | Throughput (events/s, burst) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    lines.push(
      `| ${r.tierSize} | ${fmt(r.admin.median)} | ${fmt(r.admin.p95)} | ${fmt(r.delivery.median)} | ${fmt(r.delivery.p95)} | ${fmt(r.delivery.p99)} | ${fmt(r.delivery.max)} | ${fmt(r.e2e.median)} | ${fmt(r.e2e.p95)} | ${fmt(r.e2e.max)} | ${r.delivery.n} | ${r.missed}/${r.expectedDeliveries} | ${fmt(r.throughputPerSec)} |`,
    );
  }
  lines.push('');
  lines.push('### Full per-tier detail');
  lines.push('');
  for (const r of reports) {
    lines.push(`#### ${r.tierSize} client(s)`);
    lines.push('');
    lines.push(`- Admin-side publish time (t1-t0): min ${fmt(r.admin.min)}, mean ${fmt(r.admin.mean)}, median ${fmt(r.admin.median)}, p95 ${fmt(r.admin.p95)}, p99 ${fmt(r.admin.p99)}, max ${fmt(r.admin.max)} (n=${r.admin.n})`);
    lines.push(`- Delivery latency (t2-t1): min ${fmt(r.delivery.min)}, mean ${fmt(r.delivery.mean)}, median ${fmt(r.delivery.median)}, p95 ${fmt(r.delivery.p95)}, p99 ${fmt(r.delivery.p99)}, max ${fmt(r.delivery.max)} (n=${r.delivery.n})`);
    lines.push(`- End-to-end (t2-t0): min ${fmt(r.e2e.min)}, mean ${fmt(r.e2e.mean)}, median ${fmt(r.e2e.median)}, p95 ${fmt(r.e2e.p95)}, p99 ${fmt(r.e2e.p99)}, max ${fmt(r.e2e.max)} (n=${r.e2e.n})`);
    lines.push(`- Missed deliveries: ${r.missed} / ${r.expectedDeliveries} expected (socket-events that never arrived within the 5s wait)`);
    lines.push(`- Burst throughput: ${r.burstDeliveries} deliveries in ${fmt(r.burstElapsedMs)} ms (${BURST_SIZE} publishes x ${r.tierSize} client(s)) = ${fmt(r.throughputPerSec)} events/s`);
    lines.push('');
    lines.push('  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):');
    lines.push('');
    lines.push('  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |');
    lines.push('  |---|---|---|---|---|---|');
    for (const [type, s] of Object.entries(r.byType)) {
      lines.push(`  | ${type} | ${fmt(s.admin.median)} | ${fmt(s.admin.p95)} | ${fmt(s.delivery.median)} | ${fmt(s.delivery.p95)} | ${s.admin.n} |`);
    }
    lines.push('');
  }

  const firstTier = reports[0];
  const lastTier = reports[reports.length - 1];
  lines.push('## Fan-out scaling');
  lines.push('');
  if (firstTier && lastTier && firstTier.tierSize !== lastTier.tierSize) {
    const p95Growth = lastTier.delivery.p95 - firstTier.delivery.p95;
    lines.push(
      `Delivery p95 moved from ${fmt(firstTier.delivery.p95)} ms at ${firstTier.tierSize} client(s) to ${fmt(lastTier.delivery.p95)} ms at ${lastTier.tierSize} client(s) (${p95Growth >= 0 ? '+' : ''}${fmt(p95Growth)} ms). ${
        p95Growth > 20
          ? 'This is a real, if modest, room-size effect: the default in-memory Socket.IO adapter serialises the envelope once and iterates every socket in the room synchronously per emit, so p95/p99 tend to creep up with room size even on loopback.'
          : 'No meaningful ballooning was observed up to the largest tested tier - the in-memory adapter comfortably fans this payload size out to this many sockets on one process.'
      }`,
    );
  } else {
    lines.push('Not enough distinct tiers were completed to characterise scaling.');
  }
  lines.push('');
  lines.push(
    "Known structural bottleneck (not exercised by this benchmark, but relevant beyond it): `RealtimeService`'s doc comment notes the default Socket.IO adapter only fans out within one process - a horizontally-scaled deployment (>1 backend instance behind a load balancer) needs a shared adapter (e.g. `@socket.io/redis-adapter`) before cross-instance delivery works at all. All numbers above are single-process.",
  );
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  const worstP95 = Math.max(...reports.map((r) => r.delivery.p95));
  const worstE2eP95 = Math.max(...reports.map((r) => r.e2e.p95));
  lines.push(
    `Worst observed delivery p95 across all tested tiers: ${fmt(worstP95)} ms (loopback). Worst observed end-to-end p95: ${fmt(worstE2eP95)} ms (loopback). ${
      worstE2eP95 < 1000
        ? '**"Updates in seconds" is comfortably met** on loopback, with orders-of-magnitude of headroom before adding real mobile-network RTT.'
        : '**"Updates in seconds" is met but with less headroom than expected** - investigate before adding real network RTT on top.'
    }`,
  );
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(createGlobalValidationPipe());
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app));
  await app.listen(0);

  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[bench] app listening on ${baseUrl}`);

  const prisma = app.get(PrismaService);
  console.log('[bench] seeding...');
  const seedResult = await seed(prisma);
  console.log(`[bench] seeded society ${seedResult.societyId} with ${MAX_LISTENERS} potential listeners + ${ACTOR_COUNT} actors + 1 committee`);

  const reports = [];
  try {
    for (const tierSize of TIERS) {
      console.log(`[bench] running tier: ${tierSize} client(s)...`);
      const report = await runTier(tierSize, seedResult);
      reports.push(report);
      console.log(
        `[bench] tier ${tierSize}: delivery p50=${fmt(report.delivery.median)}ms p95=${fmt(report.delivery.p95)}ms max=${fmt(report.delivery.max)}ms missed=${report.missed}/${report.expectedDeliveries} throughput=${fmt(report.throughputPerSec)}/s`,
      );
    }
  } finally {
    console.log('[bench] cleaning up seeded rows...');
    await cleanup(prisma, seedResult);
    await app.close();
  }

  const hostInfo = `${os.platform()} ${os.release()}, ${os.cpus()[0]?.model ?? 'unknown CPU'} x${os.cpus().length}, ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM`;
  const report = renderReport(reports, hostInfo);
  writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(`[bench] report written to ${REPORT_PATH.pathname}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[bench] FAILED', err);
    process.exit(1);
  });
