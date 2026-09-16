# Architecture — GateX Platform v0.3

**Revised to V2.0 scope on 2026-09-16 — see [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).**

Companion to [PRODUCT_PLAN.md](PRODUCT_PLAN.md) and [DESIGN.md](DESIGN.md). This document commits to a stack, a repository layout, and a code split between the backend, the two clients and the simulation harness. Build sequencing lives in [BACKEND_PLAN.md](BACKEND_PLAN.md) and [FRONTEND_PLAN.md](FRONTEND_PLAN.md); progress in [SUPERVISOR.md](SUPERVISOR.md).

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Client surfaces | **Native resident app** (React Native + Expo) + **management web app** (Next.js) for committee, vendor and platform operator |
| Payment aggregator | **Razorpay sandbox** (test-mode, UPI collect, no real money), settling to the society's account |
| Money posture | Platform **holds no funds and takes no commission**; revenue is a vendor listing/subscription fee outside the society's rails |
| Synthetic society scale | **90 flats** (default; parameterised) |
| Simulation horizon | **12 months** (default) |
| Dispute resolution | **Automated triage → committee final call** |
| Non-functional targets | **p95 < 500 ms** on read endpoints; full **400-flat billing run < 60 s** |

Time boundation: none — completeness over speed.

---

## 2. Stack

Chosen for: strong TypeScript typing across the stack; a real, boring, production-grade backend framework; Python where it earns its keep (the economic simulation).

| Layer | Choice | Why |
|---|---|---|
| **Resident client** | React Native + Expo + TypeScript; Expo Router; TanStack Query persisted to MMKV | Residents act in response to events (pool threshold reached, vendor confirmed, bill published) — a notification-driven pattern a web client serves poorly. Push, secure credential storage and background revalidation are first-class. |
| **Management client** | Next.js (App Router) + TypeScript + Tailwind + TanStack Query | One framework serving three role-scoped interfaces (committee, vendor, operator); data-dense desk work — billing runs, reconciliation, approval ladders, audit review. |
| **Backend API** | NestJS + TypeScript (true ESM) + Prisma ORM with `@prisma/adapter-pg` | Modular, opinionated, testable; works cleanly with the domain slicing this project needs. |
| **Database** | PostgreSQL 16 | Transactions, advisory locks and society scoping. Ledger lines, readings, pricing cards and audit rows are append-only. |
| **Worker tier** | Redis-backed job queue | Billing runs, scheduled audit-chain verification and balance-cache assertion are long-running and must be restartable; they never block a request. |
| **Payments** | Razorpay Node SDK (test-mode keys only; deterministic stub by default) | Collection through an RBI-authorised aggregator; webhook signature verification is real HMAC even when stubbed. |
| **Auth** | Residents: **phone OTP** → bearer token in secure storage. Committee officers and vendors: **password + mandatory TOTP 2FA** → session cookie. DB-backed `Session` table behind both | Logout and force-revoke work for privileged accounts; bearer tokens for the native client are one guard on the same session store. |
| **Simulation** | Python 3.13 + NumPy + pandas + matplotlib, offline harness | Monte Carlo, sensitivity analysis and reporting are Python's home turf. |
| **Simulation surfacing** | Simulation writes JSON/CSV artefacts to `simulation/outputs/`; reporting surface deferred | Keeps the sim out of the request path; a run isn't triggered by a user click. |
| **Shared types** | `shared/openapi.json` generated from NestJS decorators; one typed client consumed by both apps; CI fails on drift | Single source of truth for contracts across two clients. |
| **Local dev** | `docker-compose` (Postgres + Maildev; Redis added with the worker tier) | One command up. |
| **Testing** | Backend: vitest (unit + e2e against real PostgreSQL), oxlint. Web: Playwright. Mobile: Maestro. Simulation: pytest | Coverage where it earns its place; e2e never against a mock database. |
| **Package manager** | npm workspaces | Already in use at the repo root. |

---

## 3. Repository layout (top level)

```
gatex/
├── README.md
├── docker-compose.yml
├── .env.example
├── package.json                 # npm workspaces root
├── backend/                     # NestJS API          — §4
├── apps/
│   ├── mobile/                  # Expo resident app   — §5.1
│   └── web/                     # Next.js management  — §5.2
├── packages/
│   ├── api-client/              # generated typed client, consumed by both apps
│   └── tokens/                  # shared design tokens (Tailwind + RN theme)
├── simulation/                  # Python sim          — §6
├── shared/                      # OpenAPI + shared constants — §7
├── docs/
└── scripts/                     # dev, seed, migrate, demo
```

Three deployables (`backend/`, `apps/mobile/`, `apps/web/`) plus one offline harness (`simulation/`) and one worker process built from `backend/`. Type-safety across the wire via `shared/` and `packages/api-client/`.

---

## 4. Backend — `backend/` *(NestJS API)*

### 4.1 Directory layout

Target layout for V2.0. Modules shipped in Phases 0–5 are marked *(shipped)*; several carry rework listed in [BACKEND_PLAN.md](BACKEND_PLAN.md).

```
backend/
├── prisma/
│   ├── schema.prisma            # single source of truth for the data model
│   ├── migrations/              # versioned migrations
│   └── seed/                    # deterministic 90-flat dev seed
├── src/
│   ├── main.ts                  # bootstrap
│   ├── worker.ts                # worker-tier entrypoint (queue consumers)
│   ├── app.module.ts
│   ├── config/                  # Zod env schema, feature flags
│   ├── common/
│   │   ├── decorators/          # @Roles, @CurrentUser, @SocietyScope, @ResidentOnly, @VendorOnly, @OperatorOnly
│   │   ├── guards/              # AuthGuard (cookie + bearer), RolesGuard, SocietyScopeGuard (operator bypass)
│   │   ├── interceptors/        # AuditLogInterceptor, ConsentLedgerInterceptor
│   │   ├── pipes/ filters/ types/ util/
│   ├── infra/
│   │   ├── prisma/              # PrismaService, unit-of-work helpers
│   │   ├── razorpay/            # aggregator client wrapper (sandbox + stub)
│   │   ├── gstinapi/            # gstinapi.in GSTIN lookup (offline stub by default)
│   │   ├── bbps/                # bill-presentment adapter for individually metered electricity
│   │   ├── queue/               # Redis-backed job queue
│   │   ├── mailer/ sms/ push/   # notification channels
│   │   └── clock/               # injectable Clock for deterministic tests
│   └── modules/
│       ├── health/              # (shipped)
│       ├── auth/                # (shipped, rework) phone OTP, password + TOTP, sessions, bearer tokens
│       ├── users/               # (shipped, rework) principal kinds RESIDENT | VENDOR | OPERATOR
│       ├── societies/           # M1: society, flat register CSV import, configuration
│       ├── occupancy/           # M2: occupancy, ratification queue, delegation, consent grants
│       ├── operator/            # platform operator console endpoints
│       ├── kyc/                 # (shipped) vendor document capture
│       ├── vendors/             # (shipped, rework) M4: directory, VendorSocietyLink, ratings, access requests
│       ├── pricing-cards/       # M4: versioned immutable cards and lines
│       ├── charge-sheets/       # M4: itemised sheets, variance computation
│       ├── service-requests/    # M7: ServiceRequest + Participation (replaces shipped polls/)
│       ├── bulk-buy/            # (shipped) committee-origin offers, bookings, job cards, milestones, retention
│       ├── payments/            # (shipped) aggregator orders, webhook, idempotency
│       ├── ledger/              # (shipped, rework) double-entry ledger, sub-ledgers, balance cache
│       ├── collections/         # M12: virtual accounts, statement ingestion, arrears, late fees
│       ├── bills/               # M11: consolidated bills hub read model, /me/home aggregate
│       ├── electricity/         # M5: meters, readings, tariffs, billing cycles, apportionment, reconciliation
│       ├── water/               # M6: sources, cost pool, blended rate
│       ├── events/              # M8: committee-created events, registrations, refunds
│       ├── camps/               # M9: health camps (no clinical fields)
│       ├── donations/           # M10: campaigns and contributions
│       ├── treasury/            # M12: fixed deposits, sweep rule, maturity ladder
│       ├── approvals/           # M14: three-rung approval ladder, thresholds, majority fraction
│       ├── disputes/            # M14: dispute cases, automated triage, adjudication
│       ├── job-blog/            # (shipped) non-financial notice board + moderation
│       ├── notifications/       # (shipped, extended) push / SMS / email, preferences, quiet hours
│       └── audit/               # (shipped) M13: hash-chained audit log + verification
├── test/                        # e2e specs per module, against real PostgreSQL
├── oxlint.json
├── vitest.config.ts
├── vitest.config.e2e.ts
├── nest-cli.json
├── package.json
└── tsconfig.json
```

### 4.2 Module responsibilities

**`auth/`, `users/`**
- Residents: phone OTP (6-digit, 10-minute expiry, 60-second resend cooldown, rate-limited); session issued as a bearer token for the native client.
- Committee officers and vendors: password + mandatory TOTP; cookie session with short idle expiry on privileged roles.
- `CurrentUserContext` is a discriminated union over `RESIDENT | VENDOR | OPERATOR`; `societyId` and `occupancyRole` exist only on the resident branch.

**`societies/`, `occupancy/`, `operator/`** *(M1, M2)*
- Society is the tenant boundary; every society record scopes to it.
- Flat register CSV import validates that area factors sum to unity within tolerance.
- Occupancy: `OWNER_OCCUPIER | OWNER_ABSENTEE | TENANT`, tenure clock, move-in/move-out.
- **Ratification queue:** no self-registered resident activates without committee approval against the register.
- `Delegation` (scoped, revocable; financial capabilities excluded at the type level) and `ConsentGrant` (enforced at query time).
- Roles: `COMMITTEE | TREASURER | DEPUTY_TREASURER`.
- Operator: create society, assign first committee officer, promote vendor to `PLATFORM_AUDITED`.

**`vendors/`, `pricing-cards/`, `charge-sheets/`** *(M4)*
- `Vendor` (one identity) + `VendorSocietyLink` (per society); one rating aggregate across societies.
- Verification tier state machine: `UNVERIFIED → SOCIETY_ATTESTED → PLATFORM_AUDITED`. GSTIN lookup at onboarding auto-promotes an Active GSTIN; failures are logged, not fatal. Trade licence captured.
- `PricingCard` immutable once published; revision creates a new version; publication audit-chained.
- `ChargeSheet` matched line by line against the frozen card; per-line and total variance; out-of-card lines flagged for acknowledgement or dispute.
- Rating aggregate maintained on every signed-off job card.

**`service-requests/`** *(M7 — core loop)*
- `ServiceRequest`: origin `RESIDENT | COMMITTEE`, category, description, window, threshold (frozen from category configuration at creation), status.
- `Participation`: an opt-in record — no weight, no choice.
- Below threshold at closing → lapse and return contributions.
- Committee assigns a vendor (no bidding) → vendor confirms → **card freeze** against the pool, audit-chained, fan-out notification.
- Threshold evaluation serialised with a Postgres advisory lock (the Phase 5 double-fire fix).
- Migrates the shipped Phase 3 commitment mechanic; `Vote`, `VoteChoice` and `PollWeightMode` are deleted.

**`bulk-buy/`** *(shipped; committee-origin path)*
- `Offer` with `discountLadder: Json`; on fire, the applied tier (highest `minN ≤ commitments`) is snapshotted onto each `JobCard` so later commitments cannot change the price.
- `Booking → JobCard[] → escrow → sign-off → Payout`, shared by both request origins.
- `JobCard.tier: SMALL | LARGE` — LARGE uses milestone settlement and defect-liability retention.
- Recurring offers (`OfferRecurrence`) for repeating committee procurement.

**`payments/`**
- Aggregator order creation, capture, refund; webhook with real signature verification; idempotency keys.
- Every payment event posts to the ledger.

**`ledger/`, `collections/`, `treasury/`** *(M12)*
- Append-only journal with conservation invariant; idempotency keys on journal entries.
- `Account.kind` covers society-owned sub-ledgers and external counterparties only: maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus. **No platform-owned account exists** (I2); `VOUCHER`, `LENDING_SIM` and `COMMISSION_SINK` are removed.
- `Account.balance` is a cache written only by the posting layer; a scheduled worker asserts it equals the derived balance (I6).
- Cross-pocket movement requires an explicit journal through the approval ladder.
- `VirtualAccount` per flat — **attribution key only**; no role in authentication.
- `BankStatementLine` CSV ingestion; match by virtual account; unmatched credits queue for treasurer review.
- Arrears ageing, configurable late fees, instalment forbearance on the society's own receivable.
- `FixedDeposit` with sweep rule, operating-float floor, minimum tenor and maturity ladder; interest posts to society income only (I4).

**`bills/`** *(M11)*
- `GET /me/bills` composes maintenance, utilities, procurement contributions and event charges **in one query**, not six service calls; dedicated read model if join cost exceeds budget.
- `GET /me/home` — the mobile aggregate: amount due, actions needed, joinable requests, upcoming events.
- Every line carries its computation basis and evidence link.

**`electricity/`, `water/`** *(M5, M6)*
- `Meter` (flat / common), `Reading` (immutable; audit-chained at capture; corrections post a reversing reading), `TariffSchedule` (JSONB, versioned by effective date), `BillingCycle`, `FlatBill.computationTrace`.
- Pipeline on the worker tier, each stage idempotent and resumable: ingest → validate → compute → apportion → reconcile → publish. A flagged meter halts the cycle.
- Common area = bulk − Σ sub-meters, apportioned by area factor with deterministic rounding-residue allocation; variance against the bulk invoice published.
- Individually metered configuration bypasses apportionment and routes through `infra/bbps`.
- Water: `WaterSource` (municipal / tanker / borewell), per-cycle cost pool, blended per-kilolitre rate with derivation; fallback basis for unmetered flats recorded per bill.

**`events/`, `camps/`, `donations/`** *(M8, M9, M10)*
- `Event`: committee-created only; per-flat opt-in charge, capacity, window, concessions, refund policy fixed at creation. `Registration` with waitlist promotion; automatic refunds per policy.
- `HealthCamp`, `CampRegistration`: provider receives name, flat and slot only. **No field capable of holding clinical information** (I5).
- `DonationCampaign`, `Contribution`: internal welfare fund under dual authorisation; external pass-through records participation only.

**`approvals/`, `disputes/`** *(M14)*
- `PayoutAuthorisation` generalised from an implied two approvers to N. Required count derived from amount: rung 1 single officer; rung 2 two distinct identities; rung 3 configurable majority of the committee roster. Initiator and repeat identities rejected; execution blocked until the count is met. Applies to payouts, cross-pocket journals and corpus placements.
- Thresholds and majority fraction are per-society configuration.
- **Automated triage:** rule engine categorises a new dispute (out-of-card line, missed SLA, quality issue, payment mismatch), recommends a resolution, and routes to committee for adjudication. Committee can accept or override.

**`job-blog/`**
- Post CRUD, company-email verification via signed token link, rate limiter (1 post / resident / month, society-configurable), committee moderation. Non-financial.

**`notifications/`**
- Push to the resident app, email and SMS fallback; per-resident preferences and quiet hours; committee-only emergency broadcast, logged.

**`audit/`** *(M13)*
- One append-only table. Every state change writes here via `AuditLogInterceptor`.
- **Hash-chained.** `entryHash = SHA-256(previousHash || canonicalJson({ts, societyId, actorId, action, subjectType, subjectId, payload}))` — the full logical row, not only the payload. Genesis `previousHash = 0x00…00`. Writes take a society-scoped Postgres advisory lock so no two rows share a `previousHash`. Tail hash cached for O(1) reads.
- **Verification:** recomputes forward and returns the first divergent row (or intact). Exposed as `GET /audit/verify`, **callable by any resident**; a scheduled worker verifies and alerts on divergence.
- Consent ledger is a sub-view of audit filtered to consent actions.

### 4.3 Prisma data model (headline entities)

```
User(id, phone, name, email, status, principal_kind[RESIDENT|VENDOR|OPERATOR], password_hash?, totp_secret?)
Session(id, user_id, kind[COOKIE|BEARER], expires_at, revoked_at)
Society(id, name, address, geolocation, config, audit_tail_hash)
Flat(id, society_id, unit_no, area_factor, maintenance_amount)
Occupancy(id, flat_id, user_id, role[OWNER_OCCUPIER|OWNER_ABSENTEE|TENANT], status, ratified_by, tenure_started_at, tenure_ended_at)
Role(id, society_id, user_id, kind[COMMITTEE|TREASURER|DEPUTY_TREASURER])
Delegation(id, occupancy_id, delegate_user_id, scope, revoked_at)
ConsentGrant(id, user_id, purpose, grantee, granted_at, revoked_at)

Vendor(id, name, geolocation, radius_km, verification_tier, gstin, gstin_verified_at, trade_licence)
VendorSocietyLink(id, vendor_id, society_id, status)
VendorCategory(vendor_id, category)
VendorRating(id, vendor_id, job_card_id, rating, comment, source[RESIDENT|COMMITTEE])
PricingCard(id, vendor_id, category, version, effective_from, superseded_at, gst_rate)
PricingLine(id, card_id, label, basis, rate, minimum, conditions)
ChargeSheet(id, booking_id, frozen_card_id, status)
ChargeLine(id, sheet_id, pricing_line_id?, amount, variance, flagged)

ServiceRequest(id, society_id, raised_by_flat_id?, origin[RESIDENT|COMMITTEE], category, description, window, threshold, status)
Participation(id, request_id, flat_id, joined_at, contribution, status)
Offer(id, society_id, vendor_id, category, unit_price, discount_ladder JSON, min_commitments, deadline, recurrence)
Commitment(id, offer_id, flat_id, amount, status)
Booking(id, source_type, source_id, vendor_id, society_id, frozen_card_id, status, tier[SMALL|LARGE])
JobCard(id, booking_id, flat_id, scope, unit_price, applied_discount_pct, status, signed_off_at)
Milestone(id, booking_id, pct, status, retention_release_at)

Account(id, society_id, kind[MAINTENANCE|ELECTRICITY|WATER|PROCUREMENT_ESCROW|EVENTS|WELFARE|SINKING|CORPUS|EXTERNAL], balance_cache)
LedgerEntry(id, ts, idempotency_key, reason_code, linked_entity_type, linked_entity_id)
LedgerLine(id, entry_id, account_id, debit, credit)
Payment(id, flat_id, aggregator_order_id, amount, status)
Payout(id, source_type, source_id, amount, status)
PayoutAuthorisation(id, payout_id, approver_id, decision, ts)
ApprovalPolicy(society_id, lower_threshold, upper_threshold, majority_fraction)
VirtualAccount(id, flat_id, account_number, issued_at, active)
BankStatementLine(id, society_id, value_date, amount, reference, matched_flat_id?, status)
FixedDeposit(id, society_id, principal, rate, placed_at, maturity, initiated_by, status)

Meter(id, society_id, flat_id?, kind[FLAT|COMMON|BULK])
Reading(id, meter_id, value, captured_at, reverses_reading_id?)
TariffSchedule(id, society_id, utility, effective_from, slabs JSONB)
BillingCycle(id, society_id, utility, period, stage, status)
FlatBill(id, cycle_id, flat_id, amount, basis, computation_trace JSONB)
WaterSource(id, society_id, kind[MUNICIPAL|TANKER|BOREWELL])

Event(id, society_id, title, description, capacity, window, per_flat_charge, concessions, refund_policy, status)
Registration(id, event_id, flat_id, status, waitlist_position)
HealthCamp(id, society_id, provider, slots)                -- no clinical fields (I5)
CampRegistration(id, camp_id, flat_id, user_id, slot)
DonationCampaign(id, society_id, kind[INTERNAL|PASS_THROUGH], target)
Contribution(id, campaign_id, flat_id, amount, anonymous_to_residents)

JobBlogPost(id, poster_id, kind[HIRING|SEEKING], title, body, company_email_verified, expires_at)
Dispute(id, case_type, opener_id, subject_type, subject_id, status, triage_recommendation, resolution)
AuditLog(id, ts, society_id, actor_id, action, subject_type, subject_id, payload_json, previous_hash BYTEA, entry_hash BYTEA)
Notification(id, user_id, category, payload, seen_at)
```

`AuditLog`, ledger lines, `Reading` and published `PricingCard`/`PricingLine` rows are append-only; corrections are new rows. There is **no** `Vote`, loan, voucher or platform-owned account entity. Field lists are headline-level; `schema.prisma` is authoritative.

### 4.4 API surface (headline routes)

REST + OpenAPI. Route prefix `/api/v1` (`GET /health` excluded).

```
POST   /auth/otp                            resident: request phone OTP
POST   /auth/verify                         resident: redeem OTP → bearer token
POST   /auth/login                          officer/vendor: password + TOTP → session
GET    /me                                  principal, roles, society membership
GET    /me/home                             mobile aggregate
GET    /me/bills                            consolidated bills hub
GET    /me/approvals                        committee approvals inbox

POST   /operator/societies                  operator: create society
POST   /societies/:sid/flats/import         committee: flat register CSV
POST   /societies/:sid/occupancies/claim    resident: claim a flat
POST   /occupancies/:oid/ratify             committee: ratify or reject

GET    /societies/:sid/vendors              directory
POST   /societies/:sid/vendors              committee: onboard vendor
POST   /vendors/:vid/rate                   post-job rating
POST   /vendor/pricing-cards                vendor: publish card version

GET    /societies/:sid/requests             open service requests
POST   /societies/:sid/requests             resident or committee: raise request
POST   /requests/:rid/join                  resident: join
POST   /requests/:rid/assign                committee: assign vendor
POST   /requests/:rid/confirm               vendor: confirm → card freeze

POST   /societies/:sid/offers               committee: open offer
POST   /offers/:oid/commit                  resident: commit

POST   /bookings/:bid/job-cards/:jcid/sign-off
POST   /bookings/:bid/charge-sheets         vendor: submit sheet
POST   /charge-sheets/:csid/acknowledge     resident: acknowledge or dispute

POST   /payouts/:pid/approve                committee: record approval (ladder)
POST   /payments/orders                     aggregator order create
POST   /payments/webhook                    aggregator webhook

POST   /societies/:sid/statements           treasurer: statement ingestion
GET    /societies/:sid/collections          committee: collection status, arrears
POST   /societies/:sid/fixed-deposits       treasurer: propose placement

POST   /societies/:sid/billing-cycles       committee: start electricity/water cycle
GET    /billing-cycles/:cid                 stage, flags, reconciliation variance

POST   /societies/:sid/events               committee: create event
POST   /events/:eid/register                resident: opt in

GET    /jobs                                notice board list
POST   /jobs                                create post (company email verification for hiring)

POST   /disputes                            open dispute
POST   /disputes/:did/resolve               committee adjudication

GET    /audit                               committee: audit log view
GET    /audit/verify                        any resident: recompute chain, report first divergence
GET    /notifications/me
```

List endpoints use cursor pagination and `ETag` / `If-None-Match`; every endpoint emits server-timing headers.

### 4.5 Backend cross-cutting patterns

- **`AuthGuard`** accepts session cookie or bearer token against the same session store.
- **`SocietyScopeGuard`** — every route with `:sid` verifies the principal has an active occupancy or role in that society; operators bypass.
- **`RolesGuard`** and principal guards — `@Roles(COMMITTEE, TREASURER)`, `@ResidentOnly()`, `@VendorOnly()`, `@OperatorOnly()`.
- **Unit-of-work** — Prisma transactions wrap every multi-write action (posting + state change + audit).
- **Idempotency keys** on payment, webhook and journal endpoints — required for the mobile offline mutation queue.
- **Compliance invariants** (I2 no platform account, I4 interest never to a flat, I5 no clinical fields, I6 derived balances, I7 proportionate authorisation, I8 no voting entity) each carry an explicit test.
- **Performance budget** — p95 > 500 ms on a read endpoint is a bug, not a tuning note.

---

## 5. Clients

Full phase plan, screen-to-endpoint contracts and performance substrate are in [FRONTEND_PLAN.md](FRONTEND_PLAN.md); this section fixes only the structure.

### 5.1 Resident app — `apps/mobile/` *(React Native + Expo)*

```
apps/mobile/
├── app/                          # Expo Router
│   ├── (auth)/                   # phone OTP, flat claim, awaiting-ratification
│   ├── (tabs)/
│   │   ├── home/                 # GET /me/home
│   │   ├── bills/                # bills hub, bill detail with computation trace, pay
│   │   ├── requests/             # raise, browse, join, request detail, charge sheet
│   │   ├── events/               # browse, opt in
│   │   └── more/                 # vendors, notice board, camps, donations, audit verify, profile
│   └── (committee)/approvals/    # light approvals inbox for committee members only
├── lib/                          # api client binding, secure storage, query persistence, push
└── package.json
```

- Persisted read cache; cold start never blocks on auth.
- Optimistic mutations with rollback on join, opt-in, acknowledgement, rating; offline mutation queue replayed with idempotency keys.
- Push, never poll.

### 5.2 Management web — `apps/web/` *(Next.js App Router)*

```
apps/web/
├── app/
│   ├── (auth)/                   # password + 2FA
│   ├── (committee)/              # ratification, flat import, requests + vendor assignment,
│   │                             # billing cycles, collections, treasury, approvals,
│   │                             # events, disputes, notice moderation, audit
│   ├── (vendor)/                 # pricing cards, engagement queue, charge sheets, profile
│   └── (operator)/               # societies, first officer, vendor audit tier
├── components/
├── lib/
└── package.json
```

Role-based server-side redirection happens in each group's `layout.tsx`.

---

## 6. Simulation — `simulation/` *(Python, offline)*

### 6.1 Directory layout

```
simulation/
├── pyproject.toml
├── README.md
├── sim/
│   ├── config.py                     # parameters (N flats, horizon, distributions, tariffs)
│   ├── synthetic/
│   │   ├── society.py                # generates 90-flat society with area factors
│   │   ├── residents.py              # occupancy and payment-behaviour distribution
│   │   ├── vendors.py                # vendor pool with categories, radii and pricing cards
│   │   ├── consumption.py            # per-flat and common-area load profiles
│   │   └── water.py                  # seasonal source mix and tanker prices
│   ├── engine/
│   │   ├── clock.py                  # discrete-day simulation loop
│   │   ├── electricity.py            # HT bulk vs individual LT billing, apportionment
│   │   ├── requests.py               # pooled-request formation against category thresholds
│   │   ├── collections.py            # payment behaviour, arrears ageing, late fees
│   │   ├── treasury.py               # corpus sweep, FD ladder, seasonal calls
│   │   └── ledger.py                 # simple double-entry ledger mirroring backend
│   ├── analysis/
│   │   ├── sensitivity.py            # sweeps over parameters
│   │   ├── monte_carlo.py            # N-run averaging + confidence bands
│   │   ├── functional.py             # billing / apportionment / idempotency / card-binding checks
│   │   └── report.py                 # writes JSON/CSV + matplotlib PNGs
│   └── cli.py                        # entrypoint: `python -m sim run --scenario X`
├── notebooks/
├── data/
│   ├── seed/                         # deterministic seed files
│   └── scenarios/                    # named parameter sets
├── outputs/                          # generated artefacts
└── tests/
```

### 6.2 Simulation contract

- Every run is deterministic given a seed; seed, parameters and timestamp written with every run.
- Every run writes a versioned JSON report plus CSV and plots to `outputs/`.
- Runs are triggered manually (`python -m sim run`) — never by an HTTP call. The reporting surface in the clients is deferred.

### 6.3 Scenarios

1. **Baseline** — 90 flats, 12 months, Monte Carlo to stable intervals.
2. **Bulk HT vs individual LT electricity** — the principal economic result.
3. **Electricity sensitivity** — tariff differential, common-area load fraction, regulatory cap on recoverable margin.
4. **Pooled-request aggregation** — saving by participation rate and category threshold against published card rates; isolates the volume effect since vendors do not bid.
5. **Collections** — collection-rate distribution and arrears ageing under varying payment behaviour.
6. **Water volatility** — cost under seasonal tanker dependency.
7. **Corpus sweep** — yield against liquidity risk; frequency with which a laddered profile fails a seasonal call.

### 6.4 Functional-accuracy evaluation

Asserted against the synthetic society and appended to the report under the `functional` key:

- Billing correctness at slab boundaries.
- Apportionment to rounding tolerance (residue allocated deterministically; totals reconcile to the bulk figure).
- Idempotency under replayed postings and resumed pipeline stages.
- Pricing-card binding — every participating flat in a pool is charged against the identical frozen version.
- Access-control matrix asserted exhaustively.

---

## 7. Shared — `shared/`

```
shared/
├── openapi.json                       # generated from NestJS decorators
├── types/                             # generated from openapi.json
└── constants/
    ├── roles.ts
    ├── categories.ts                  # service categories (thresholds are society config)
    ├── statuses.ts
    └── error-codes.ts
```

Regeneration runs on every backend contract change; `packages/api-client` is generated from `shared/openapi.json`; CI fails on drift.

---

## 8. Environment and configuration

### 8.1 `.env.example` (root, grouped by phase)

```
# Foundation
NODE_ENV=development
API_PORT=4000
API_CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/society_fintech?schema=public

# Auth
SESSION_COOKIE_NAME=sid
SESSION_TTL_DAYS=30
SMS_PROVIDER=stub                  # phone OTP delivery
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=no-reply@societyfintech.local

# Vendors
GSTIN_API_ENABLED=false            # offline stub by default

# Payments (sandbox only)
RAZORPAY_ENABLED=false             # deterministic stub by default
RAZORPAY_KEY_ID=rzp_test_stub
RAZORPAY_KEY_SECRET=stub_secret
RAZORPAY_WEBHOOK_SECRET=stub_webhook

# Worker tier
REDIS_URL=redis://localhost:6379

# Clients
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

### 8.2 `docker-compose.yml` (dev)

```
postgres:16-alpine    # database
maildev                # SMTP inbox at http://localhost:1080
redis                  # worker queue (added with the billing phase)
```

### 8.3 One-command dev

```
npm install
docker compose up -d
npm run prisma:migrate
npm run prisma:seed
npm run dev:backend
```

Clients start from their own workspaces once they exist. Optionally: `python -m sim run --scenario baseline` from `simulation/` to populate `outputs/`.

---

## 9. Testing strategy

- **Backend:** vitest unit tests for ledger conservation, approval-ladder counting, apportionment, tariff slabs, variance computation and dispute triage (all financial-logic critical); e2e per module against real PostgreSQL, never a mock. Each compliance invariant has an explicit test.
- **Web:** one Playwright happy path per phase.
- **Mobile:** one Maestro flow per phase; every screen tested at 375 px; lists tested with 0, 1 and 200 items.
- **Simulation:** pytest for engine determinism and functional-accuracy checks.
- **End-to-end demo:** resident raises a request → neighbours join → committee assigns vendor → vendor confirms (card frozen) → payment via sandbox → sign-off → charge sheet with a flagged line → acknowledgement → settlement through the approval ladder → audit chain verifies.

---

## 10. What is next

Sequencing is in [BACKEND_PLAN.md](BACKEND_PLAN.md) (Phases 6–13) and [FRONTEND_PLAN.md](FRONTEND_PLAN.md) (F0–F9). Identity generalisation (Phase 6) comes first because it blocks the vendor portal, the operator console and every client surface.

---

## 11. Anything I'd flag before you accept this

- **Surface proliferation.** Four client surfaces (resident app; committee, vendor and operator web) is the largest delivery risk. The shared generated API client and shared design tokens are the mitigation; they are not optional.
- **The worker tier is a new moving part.** Billing runs, verification and balance-cache assertion justify it; nothing else should be pushed onto it by default.
- Python for simulation is a real value-add here (matplotlib + pandas), but it does mean two languages. Pure-TypeScript alternative: `simple-statistics` and `plotly.js` inside a small Node script. Cleaner if you'd rather stay monolingual.
- 90 flats is small enough that simulations run in milliseconds. The 400-flat billing target exists to prove the pipeline scales; `simulation/config.py` parameterises flat count for larger runs.
