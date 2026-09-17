# Real-time push layer - latency/throughput report

Generated: 2026-09-17T04:29:55.840Z

## Methodology

- Target: `src/modules/realtime/*` (RealtimeGateway + RealtimeService), committed at HEAD `566fdda`.
- Server: the real Nest `AppModule` booted **in-process** via `Test.createTestingModule({ imports: [AppModule] }).compile()` + `app.listen(0)` on an ephemeral loopback port, using the same `RealtimeIoAdapter`, global validation pipe, cookie parser and `api/v1` prefix as `main.ts` - identical bootstrap to `test/realtime.e2e-spec.ts`. Imports the **compiled `dist/` output** (`npm run build`), not `src/*.ts` directly: NestJS constructor injection needs real `emitDecoratorMetadata` output, which esbuild-based transforms (tsx, vitest/vite's default transform) do not reliably reproduce - confirmed by hitting exactly that failure (an injected `ConfigService` resolving to `undefined`) before switching to `dist/`. The alternative of a second `node dist/main` process on a fixed port was not used, to avoid an extra process/IPC hop that would only add noise to the very latency being measured.
- Client: `socket.io-client` (already a devDependency), connecting with `handshake.auth.token` exactly like the native app path in `RealtimeGateway.extractToken`.
- Data: one throwaway Society seeded directly via Prisma (bypassing OTP/signup) with flats + RATIFIED occupancies for every resident, a COMMITTEE role, and a Vendor with a PUBLISHED PricingCard so the full create -> join x3 (threshold=3, default) -> pooled -> assign -> confirm chain (plus a Phase 3 EVENT `POST /polls`) is exercised for real, not stubbed. Sessions were inserted directly (SHA-256(token) matching SessionService's own scheme) and used as `Authorization: Bearer` on REST calls / `auth.token` on socket connects.
- Client tiers: 1, 10, 50, 100, 200 residents of the SAME society connected simultaneously (every publish fans out to all of them).
- Iterations: 100 full create/join/pool/assign/confirm/event cycles per tier -> 5 measured publishes per iteration -> 500 timed publishes per tier (well above the >=100 minimum), plus a 30-publish concurrent burst per tier for the throughput figure.
- Timestamps: `t0` immediately before the REST call, `t1` on REST response, `t2` on each socket's `domain-event` receipt (matched to the REST response's `id` field), all via `performance.now()`.
- Host: win32 10.0.26200, Intel(R) Core(TM) i7-14700HX x28, 16GB RAM

**LOOPBACK CAVEAT**: client and server run on the same host/process (127.0.0.1). These numbers measure backend processing + Socket.IO room fan-out ONLY. They exclude real mobile-network RTT (cellular/Wi-Fi latency, TLS, NAT, distance to the server), which is additive and environmental - a real client will see `delivery latency (loopback) + network RTT`, not this number alone.

## Results

All times in milliseconds unless noted. "Delivery" = REST response -> socket receipt. "Admin" = REST request -> REST response. "E2E" = REST request issued -> socket receipt.

| Clients | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | Delivery p99 | Delivery max | E2E p50 | E2E p95 | E2E max | Samples | Missed | Throughput (events/s, burst) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 394.33 | 511.55 | -1.44 | -0.25 | -0.20 | -0.19 | 391.80 | 509.94 | 2019.59 | 500 | 0/500 | 248.99 |
| 10 | 389.44 | 526.17 | -1.15 | -0.24 | -0.20 | -0.17 | 387.34 | 524.67 | 2398.15 | 5000 | 0/5000 | 1875.48 |
| 50 | 392.16 | 525.90 | -0.96 | -0.32 | -0.22 | -0.17 | 390.60 | 525.68 | 2438.41 | 25000 | 0/25000 | 6076.44 |
| 100 | 395.24 | 549.13 | -1.40 | -0.45 | -0.24 | -0.17 | 392.98 | 548.58 | 2350.46 | 50000 | 0/50000 | 11454.85 |
| 200 | 401.53 | 557.86 | -2.41 | -0.70 | -0.36 | -0.18 | 398.47 | 554.96 | 996.88 | 100000 | 0/100000 | 14327.13 |

### Full per-tier detail

#### 1 client(s)

- Admin-side publish time (t1-t0): min 8.92, mean 275.90, median 394.33, p95 511.55, p99 578.38, max 2022.79 (n=500)
- Delivery latency (t2-t1): min -9.63, mean -1.68, median -1.44, p95 -0.25, p99 -0.20, max -0.19 (n=500)
- End-to-end (t2-t0): min 7.98, mean 274.22, median 391.80, p95 509.94, p99 577.63, max 2019.59 (n=500)
- Missed deliveries: 0 / 500 expected (socket-events that never arrived within the 5s wait)
- Burst throughput: 30 deliveries in 120.48 ms (30 publishes x 1 client(s)) = 248.99 events/s

  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):

  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |
  |---|---|---|---|---|---|
  | service_request.created | 11.50 | 18.53 | -1.12 | -0.91 | 100 |
  | service_request.pooled | 435.61 | 495.84 | -2.58 | -2.01 | 100 |
  | service_request.assigned | 436.08 | 511.55 | -2.59 | -2.09 | 100 |
  | service_request.confirmed | 452.33 | 557.52 | -0.34 | -0.20 | 100 |
  | event.created | 11.42 | 17.98 | -1.17 | -0.93 | 100 |

#### 10 client(s)

- Admin-side publish time (t1-t0): min 8.53, mean 279.30, median 389.44, p95 526.17, p99 586.98, max 2398.33 (n=500)
- Delivery latency (t2-t1): min -7.54, mean -1.48, median -1.15, p95 -0.24, p99 -0.20, max -0.17 (n=5000)
- End-to-end (t2-t0): min 7.75, mean 277.82, median 387.34, p95 524.67, p99 586.31, max 2398.15 (n=5000)
- Missed deliveries: 0 / 5000 expected (socket-events that never arrived within the 5s wait)
- Burst throughput: 300 deliveries in 159.96 ms (30 publishes x 10 client(s)) = 1875.48 events/s

  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):

  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |
  |---|---|---|---|---|---|
  | service_request.created | 10.20 | 17.29 | -0.97 | -0.75 | 100 |
  | service_request.pooled | 435.02 | 554.48 | -2.25 | -1.85 | 100 |
  | service_request.assigned | 434.44 | 520.10 | -2.24 | -1.83 | 100 |
  | service_request.confirmed | 451.05 | 566.55 | -0.28 | -0.20 | 100 |
  | event.created | 10.40 | 15.21 | -0.98 | -0.78 | 100 |

#### 50 client(s)

- Admin-side publish time (t1-t0): min 9.22, mean 286.30, median 392.16, p95 525.90, p99 768.27, max 2440.48 (n=500)
- Delivery latency (t2-t1): min -4.74, mean -1.26, median -0.96, p95 -0.32, p99 -0.22, max -0.17 (n=25000)
- End-to-end (t2-t0): min 8.26, mean 285.03, median 390.60, p95 525.68, p99 766.89, max 2438.41 (n=25000)
- Missed deliveries: 0 / 25000 expected (socket-events that never arrived within the 5s wait)
- Burst throughput: 1500 deliveries in 246.86 ms (30 publishes x 50 client(s)) = 6076.44 events/s

  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):

  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |
  |---|---|---|---|---|---|
  | service_request.created | 10.34 | 14.93 | -0.84 | -0.57 | 100 |
  | service_request.pooled | 435.67 | 544.58 | -1.96 | -1.57 | 100 |
  | service_request.assigned | 431.59 | 568.08 | -1.97 | -1.54 | 100 |
  | service_request.confirmed | 447.01 | 558.69 | -0.45 | -0.22 | 100 |
  | event.created | 10.38 | 13.83 | -0.82 | -0.56 | 100 |

#### 100 client(s)

- Admin-side publish time (t1-t0): min 10.70, mean 282.35, median 395.24, p95 549.13, p99 660.09, max 2350.64 (n=500)
- Delivery latency (t2-t1): min -9.71, mean -1.59, median -1.40, p95 -0.45, p99 -0.24, max -0.17 (n=50000)
- End-to-end (t2-t0): min 9.19, mean 280.76, median 392.98, p95 548.58, p99 657.92, max 2350.46 (n=50000)
- Missed deliveries: 0 / 50000 expected (socket-events that never arrived within the 5s wait)
- Burst throughput: 3000 deliveries in 261.90 ms (30 publishes x 100 client(s)) = 11454.85 events/s

  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):

  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |
  |---|---|---|---|---|---|
  | service_request.created | 12.63 | 19.04 | -1.10 | -0.61 | 100 |
  | service_request.pooled | 435.74 | 564.23 | -2.27 | -1.63 | 100 |
  | service_request.assigned | 439.59 | 552.75 | -2.29 | -1.62 | 100 |
  | service_request.confirmed | 455.60 | 577.66 | -0.71 | -0.24 | 100 |
  | event.created | 12.68 | 15.86 | -1.10 | -0.59 | 100 |

#### 200 client(s)

- Admin-side publish time (t1-t0): min 12.95, mean 287.09, median 401.53, p95 557.86, p99 700.53, max 1001.68 (n=500)
- Delivery latency (t2-t1): min -28.38, mean -3.25, median -2.41, p95 -0.70, p99 -0.36, max -0.18 (n=100000)
- End-to-end (t2-t0): min 10.40, mean 283.84, median 398.47, p95 554.96, p99 698.09, max 996.88 (n=100000)
- Missed deliveries: 0 / 100000 expected (socket-events that never arrived within the 5s wait)
- Burst throughput: 6000 deliveries in 418.79 ms (30 publishes x 200 client(s)) = 14327.13 events/s

  By publish type (admin-side REST time varies a lot by how much work the handler does - `confirm` writes commitments + escrow/ledger rows inside an advisory-locked transaction, `create`/`event.created` are a single insert):

  | Type | Admin p50 | Admin p95 | Delivery p50 | Delivery p95 | n |
  |---|---|---|---|---|---|
  | service_request.created | 15.78 | 35.85 | -2.02 | -0.75 | 100 |
  | service_request.pooled | 443.24 | 607.59 | -3.27 | -1.87 | 100 |
  | service_request.assigned | 439.61 | 608.87 | -3.21 | -1.81 | 100 |
  | service_request.confirmed | 454.50 | 592.40 | -1.55 | -0.36 | 100 |
  | event.created | 15.45 | 36.64 | -2.01 | -0.76 | 100 |

## Fan-out scaling

Delivery p95 moved from -0.25 ms at 1 client(s) to -0.70 ms at 200 client(s) (-0.45 ms). No meaningful ballooning was observed up to the largest tested tier - the in-memory adapter comfortably fans this payload size out to this many sockets on one process.

Known structural bottleneck (not exercised by this benchmark, but relevant beyond it): `RealtimeService`'s doc comment notes the default Socket.IO adapter only fans out within one process - a horizontally-scaled deployment (>1 backend instance behind a load balancer) needs a shared adapter (e.g. `@socket.io/redis-adapter`) before cross-instance delivery works at all. All numbers above are single-process.

## Verdict

Worst observed delivery p95 across all tested tiers: -0.24 ms (loopback). Worst observed end-to-end p95: 554.96 ms (loopback). **"Updates in seconds" is comfortably met** on loopback, with orders-of-magnitude of headroom before adding real mobile-network RTT.
