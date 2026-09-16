# Software Design Document — GateX (V2.0)

**Companion to:** [PRODUCT_PLAN.md](PRODUCT_PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [BACKEND_PLAN.md](BACKEND_PLAN.md), [FRONTEND_PLAN.md](FRONTEND_PLAN.md).
**Scope:** V2.0 revised scope (non-credit, no fund-holding, no stored value). Synthetic-data evaluation only.

---

## 1. Introduction

### 1.1 Purpose
This document specifies the software design of **GateX** — a financial-operations platform for Indian residential societies. It defines the architecture, the stack, the data model, the APIs, the module design, the security and audit model, the external integrations, and the deployment and evaluation plan.

### 1.2 Scope of this revision
Version 1.0 specified a micro-lending module funded from the society corpus, a job-referral engine with cash incentives, and a cash-convertible wallet. **All have been removed.** The platform performs no credit intermediation, holds no customer funds in its own name, issues no stored value, and promises no return to any resident on society funds. §2.2 states the compliance invariants that enforce these properties, and every subsequent design decision is traceable to them.

### 1.3 Design goals
- **Verifiability.** Any resident can independently confirm that the charge levied on their flat follows from published readings and a published formula. Trust is by evidence, not assertion.
- **Compliance by construction.** The data model provides no representation for a regulated activity — no loan entity, no stored-value balance, no platform-held float.
- **Configuration over code.** Tariff slabs, approval thresholds, apportionment bases, late-fee policy and quorum rules are data. A tariff revision or a bye-law amendment is a configuration change.
- **Auditability without disclosure.** The audit chain proves integrity to any observer; the consent ledger governs who may see what.
- **Reconstructability.** Every balance is derived from an immutable journal. No aggregate is stored and mutated in place.

---

## 2. Architecture

### 2.1 Overall shape
A **modular monolith** with a single relational database, exposed to two clients (a native mobile app and a Next.js web app) through a REST API, backed by a Redis-based worker tier for long-running jobs. A monolith is appropriate: the transactional coupling between billing, ledger and audit is tight; the deployment unit is one society; and distributed transactions across service boundaries would add risk without benefit at this scale. Module boundaries are enforced in code through NestJS modules with explicit interfaces so extraction to services remains possible if it ever becomes warranted.

| Tier | Responsibility |
|---|---|
| **Resident client** (React Native + Expo) | Resident interface. Push-driven; installs on Android without an app store. |
| **Management web** (Next.js) | Committee, vendor and platform-operator interfaces. Data-dense desk work. |
| **API** (NestJS) | Stateless REST over HTTPS. Session auth, role and consent enforcement at the boundary, request validation, idempotency handling. |
| **Domain modules** | Identity, vendors, billing, procurement, collections, treasury, ledger, governance. Each owns its tables; cross-module access goes through interfaces, never through another module's tables. |
| **Ledger and audit** | Double-entry posting and the hash chain. Append-only. Every other module writes through this layer, never around it. |
| **Workers** (Redis queue) | Billing runs, statement ingestion and matching, notification dispatch, sweep proposals, chain-verification sweeps. Idempotent, safely retriable. |
| **Data** | PostgreSQL 16. Relational core with JSONB for tariff schedules and pricing cards. |
| **Integration gateway** | Every external dependency behind an adapter interface with a defined fallback. No module calls an external service directly. |

### 2.2 Compliance invariants (enforced at the schema and service layer)

| ID | Invariant | Enforcement |
|---|---|---|
| **I1** | No credit instrument exists. | No loan, advance, interest-accrual or repayment-schedule entity in the schema. Instalment plans reference an existing receivable and cannot create one. |
| **I2** | The platform holds no funds. | No platform-owned account exists in the chart of accounts. Every cash account belongs to the society or is external. |
| **I3** | Third-party bills route through an authorised rail. | Bill payment adapters accept only a BBPS-routed provider or a redirect to the biller. No direct collect-and-remit path in code. |
| **I4** | No yield is assigned to a resident. | Treasury interest posts only to society income accounts. The posting layer rejects any journal crediting interest to a flat. |
| **I5** | No health data is stored. | The health-camp schema holds registration identity and slot only. No free-text clinical field anywhere in the model. |
| **I6** | Every balance is derived. | Balances are computed from journal entries by query. No stored balance column is writable by application code. |
| **I7** | Privileged actions are dual-authorised. | Payout and corpus movement require two distinct approver identities; the service rejects same-identity approval. |
| **I8** | No resident voting entity. | No `Vote`, `Poll` or `WeightMode` entity in V2.0 — governance is the committee approval ladder. |

Each invariant carries an explicit test in the test suite.

### 2.3 Technology stack

| Layer | Choice | Rationale |
|---|---|---|
| **Resident client** | React Native + Expo (SDK) + TypeScript, Expo Router, TanStack Query persisted to MMKV | Residents respond to events (pool threshold reached, vendor confirmed, bill published) — a notification-driven pattern a web client serves poorly. Push, secure credential storage and background revalidation are first-class. |
| **Management client** | Next.js (App Router) + TypeScript + Tailwind CSS + TanStack Query | One framework serving three role-scoped interfaces (committee, vendor, operator); data-dense desk work — billing runs, reconciliation, approval ladders, audit review. |
| **Backend framework** | NestJS + TypeScript (ESM) | Module system maps directly onto the domain boundaries; dependency injection makes the integration-gateway pattern natural; shared language with the frontend reduces context switching. |
| **ORM** | Prisma with `@prisma/adapter-pg` | Typed schema, reviewable migrations, generated client keeps the ledger's constraints visible in code. |
| **Database** | PostgreSQL 16 | Transactional integrity for double-entry posting; JSONB for tariff and pricing-card documents; window functions for ageing and apportionment; advisory locks for audit-chain serialisation. |
| **Worker tier** | Redis-backed job queue (BullMQ-style) | Billing runs and statement ingestion are long-running and must be retriable. |
| **Payments** | Razorpay Node SDK (test-mode keys; deterministic stub by default) | Collection through an RBI-authorised aggregator; HMAC webhook verification is real even when stubbed. |
| **Auth (resident)** | Phone OTP → bearer token in secure storage | Aligned with Indian consumer expectation; no mandatory government identifier. |
| **Auth (officer/vendor)** | Password + mandatory TOTP 2FA → session cookie | Both roles can move money or bind prices. |
| **Session store** | DB-backed `Session` table | Force-revoke works for privileged accounts; one store behind both cookie and bearer. |
| **Simulation** | Python 3.13 + NumPy + pandas + Matplotlib, offline harness | Monte Carlo, sensitivity analysis and reporting are Python's home turf. Deliberately separate from the application runtime. |
| **Shared types** | `shared/openapi.json` generated from NestJS decorators; typed client consumed by both apps | Single source of truth for contracts across two clients; CI fails on drift. |
| **Package manager** | npm workspaces | Already in use at the repo root. |
| **Local dev** | Docker Compose (Postgres + Maildev + Redis) | One command up. |
| **Testing** | Backend: vitest unit + e2e against real Postgres; Web: Playwright; Mobile: Maestro; Simulation: pytest | Coverage where it earns its place; e2e never against a mock database. |

---

## 3. Repository Layout

```
gatex/
├── README.md
├── docker-compose.yml
├── .env.example
├── package.json                 # npm workspaces root
├── backend/                     # NestJS API + worker
├── apps/
│   ├── mobile/                  # Expo resident app
│   └── web/                     # Next.js management app
├── packages/
│   ├── api-client/              # generated typed client
│   └── tokens/                  # shared design tokens (Tailwind + RN theme)
├── simulation/                  # Python Monte Carlo harness
├── shared/                      # OpenAPI + shared constants
└── scripts/                     # dev, seed, migrate, demo
```

Three deployables (`backend/`, `apps/mobile/`, `apps/web/`), one worker process built from `backend/`, and one offline analytical harness (`simulation/`). Type-safety across the wire via `shared/` and `packages/api-client/`.

---

## 4. Backend Design

### 4.1 Module map (NestJS)

```
backend/src/modules/
├── auth/                # phone OTP, password + TOTP, sessions, bearer tokens
├── users/               # principal kinds RESIDENT | VENDOR | OPERATOR
├── societies/           # M1: society, flat register CSV import, config
├── occupancy/           # M2: occupancy, ratification queue, delegation, consent
├── operator/            # platform operator console
├── vendors/             # M4: directory, VendorSocietyLink, ratings
├── pricing-cards/       # M4: versioned immutable cards
├── charge-sheets/       # M4: itemised sheets, variance computation
├── service-requests/    # M7: resident-initiated pooled requests
├── bulk-buy/            # M7: committee-origin offers, bookings, milestones
├── payments/            # aggregator orders, webhook, idempotency
├── ledger/              # M13: double-entry ledger, sub-ledgers
├── collections/         # M12: virtual accounts, statement ingestion, arrears
├── bills/               # M11: consolidated bills hub read model
├── electricity/         # M5: meters, readings, tariffs, cycles, apportionment
├── water/               # M6: sources, cost pool, blended rate
├── events/              # M8: committee-created events, refunds
├── camps/               # M9: health camps (no clinical fields — I5)
├── donations/           # M10: internal + pass-through campaigns
├── treasury/            # M12: fixed deposits, sweep rule, maturity ladder
├── approvals/           # M14: three-rung approval ladder
├── disputes/            # M14: dispute cases, triage, adjudication
├── job-blog/            # non-financial notice board + moderation
├── notifications/       # push / SMS / email, preferences, quiet hours
└── audit/               # M13: hash-chained audit log + verification
```

### 4.2 Module responsibilities (headline)

- **`auth/`, `users/`** — Residents authenticate by phone OTP (6-digit, 10-min expiry, 60-sec resend, rate-limited) issuing a bearer token. Officers and vendors authenticate by password + mandatory TOTP issuing a cookie session with short idle expiry. `CurrentUserContext` is a discriminated union: `RESIDENT | VENDOR | OPERATOR`; `societyId` and `occupancyRole` exist only on the resident branch.
- **`societies/`, `occupancy/`, `operator/`** *(M1, M2)* — Society is the tenant boundary. Flat register CSV import validates that area factors sum to unity within tolerance. Occupancy: `OWNER_OCCUPIER | OWNER_ABSENTEE | TENANT`. Ratification queue closes the phantom-resident vector. Delegation is scoped and revocable; financial capability is excluded at the type level. ConsentGrant is enforced at query time. Committee roles are `COMMITTEE | TREASURER | DEPUTY_TREASURER`.
- **`vendors/`, `pricing-cards/`, `charge-sheets/`** *(M4)* — One `Vendor` identity + `VendorSocietyLink` per society; one rating aggregate. Tier state machine `UNVERIFIED → SOCIETY_ATTESTED → PLATFORM_AUDITED`; GSTIN lookup auto-promotes an Active GSTIN. `PricingCard` immutable once published; revisions create new versions. `ChargeSheet` matched line-by-line against the frozen card; out-of-card lines flagged for acknowledgement or dispute.
- **`service-requests/`** *(M7 — core loop)* — `ServiceRequest.origin` = `RESIDENT | COMMITTEE`; threshold frozen from category configuration at creation; below threshold → lapse and refund. Committee assigns vendor (no bidding) → vendor confirms → **card freeze** against the pool, audit-chained. Threshold evaluation serialised with a Postgres advisory lock.
- **`bulk-buy/`** — Committee-origin offers with `discountLadder: Json`; on fire, the applied tier is snapshotted onto each `JobCard`. `Booking → JobCard[] → escrow → sign-off → Payout`. `JobCard.tier` = `SMALL | LARGE`; LARGE uses milestone settlement with defect-liability retention.
- **`payments/`** — Aggregator order creation, capture, refund; HMAC webhook verification; idempotency keys. Every payment event posts to the ledger.
- **`ledger/`, `collections/`, `treasury/`** *(M12, M13)* — Append-only journal with conservation invariant. `Account.kind` covers society-owned sub-ledgers and external counterparties only. `Account.balance` is a cache written only by the posting layer; a scheduled worker asserts it equals the derived balance (I6). Cross-pocket movement requires an explicit dual-authorised journal. `VirtualAccount` per flat is an attribution key only (no role in auth). Statement ingestion matches by virtual account; unmatched credits queue for treasurer review. `FixedDeposit` with sweep rule, operating-float floor, minimum tenor and maturity ladder; interest posts to society income only (I4).
- **`bills/`** *(M11)* — `GET /me/bills` composes maintenance, utilities, procurement contributions and event charges in one query. `GET /me/home` is the mobile aggregate. Every line carries computation basis and evidence link.
- **`electricity/`, `water/`** *(M5, M6)* — Meters, immutable readings audit-chained at capture (corrections post reversing readings), versioned `TariffSchedule` (JSONB), `BillingCycle` with one-way stage transitions, `FlatBill.computationTrace`. Worker pipeline: ingest → validate → compute → apportion → reconcile → publish, each stage idempotent and resumable. A flagged meter halts the cycle. Individually metered configuration bypasses apportionment and routes through the BBPS adapter. Water sums three sources (municipal / tanker / borewell) into a blended per-kilolitre rate.
- **`events/`, `camps/`, `donations/`** *(M8, M9, M10)* — Events created by committee only; refund policy fixed at creation; automatic waitlist promotion. Health camps store `provider`, `slot`, `flat`, `user` and nothing clinical (I5). Donations split into internal welfare (dual-authorised) and external pass-through (participation record only).
- **`approvals/`, `disputes/`** *(M14)* — `PayoutAuthorisation` generalised to N approvers; required count derived from amount against `ApprovalPolicy` (lower_threshold, upper_threshold, majority_fraction). Rung 1: single officer. Rung 2: two distinct identities. Rung 3: configurable committee majority. Same-identity approval rejected. Rule-based dispute triage recommends resolution; committee accepts or overrides.
- **`job-blog/`** — Post CRUD, company-email verification via signed-token link, rate limiter (1 post / resident / month, society-configurable), committee moderation. Non-financial.
- **`notifications/`** — Push to resident app, email and SMS fallback; per-resident preferences and quiet hours; committee-only emergency broadcast, logged.
- **`audit/`** *(M13)* — One append-only table. `entryHash = SHA-256(previousHash || canonicalJson({ts, societyId, actorId, action, subjectType, subjectId, payload}))`. Genesis `previousHash = 0x00...00`. Society-scoped advisory lock on write so no two rows share a `previousHash`. Tail hash cached for O(1) reads. `GET /audit/verify` is callable by any resident and returns "intact" or the first divergent row.

### 4.3 Cross-cutting patterns

- **`AuthGuard`** — accepts session cookie or bearer token against the same session store.
- **`SocietyScopeGuard`** — every route with `:sid` verifies the principal has an active occupancy or role in that society; operators bypass.
- **`RolesGuard`** and principal guards — `@Roles(COMMITTEE, TREASURER)`, `@ResidentOnly()`, `@VendorOnly()`, `@OperatorOnly()`.
- **`AuditLogInterceptor`** — writes an audit row for every state-changing action.
- **`ConsentLedgerInterceptor`** — enforces consent at query time; a revoked grant removes access immediately, not just from the UI.
- **Unit-of-work** — every multi-write action wraps in a Prisma transaction (posting + state change + audit).
- **Idempotency keys** — required on payment, webhook and journal endpoints; supports the mobile offline mutation queue.
- **Performance budget** — p95 > 500 ms on a read endpoint is a bug.

---

## 5. Data Model

### 5.1 Identity and trust graph
Identity is anchored to the **flat** — the central modelling decision. Rights attach to property; people come and go; the same person may hold different rights in different flats.

| Entity | Key attributes | Notes |
|---|---|---|
| `Society` | id, name, address, geolocation, config, audit_tail_hash | One per deployment. Config holds thresholds, cycle dates, majority fraction. |
| `Flat` | id, society_id, unit_no, area_factor, maintenance_amount | Area factor validated to sum to unity across the society. |
| `User` | id, phone, name, email, status, principal_kind, password_hash?, totp_secret? | Phone is the resident credential. No mandatory government identifier. |
| `Occupancy` | flat_id, user_id, role, status, ratified_by, tenure_started_at, tenure_ended_at | Role: `OWNER_OCCUPIER | OWNER_ABSENTEE | TENANT`. One active owner occupancy, zero-or-more tenant occupancies per flat. |
| `Role` | user_id, society_id, kind | `COMMITTEE | TREASURER | DEPUTY_TREASURER`. Separate from occupancy so tenants cannot inherit committee powers. |
| `Delegation` | occupancy_id, delegate_user_id, scope, revoked_at | Scoped, explicit, revocable. Financial capability excluded at the type level. |
| `ConsentGrant` | user_id, purpose, grantee, granted_at, revoked_at | Enforced at query time. Revocation is immediate. |

### 5.2 Vendors and pricing

| Entity | Key attributes | Notes |
|---|---|---|
| `Vendor` | name, geolocation, radius_km, verification_tier, gstin, gstin_verified_at, trade_licence | Tier: `UNVERIFIED | SOCIETY_ATTESTED | PLATFORM_AUDITED`. Rule-driven promotion, logged. |
| `VendorSocietyLink` | vendor_id, society_id, status | Same vendor identity across many societies. |
| `VendorRating` | vendor_id, job_card_id, rating, comment, source | One rating aggregate across societies. |
| `PricingCard` | vendor_id, category, version, effective_from, superseded_at, gst_rate | Immutable once published. Revision = new version. |
| `PricingLine` | card_id, label, basis, rate, minimum, conditions | Basis: `PER_VISIT | PER_HOUR | PER_UNIT | PERCENTAGE`. Visit charge is a first-class line. |
| `ChargeSheet` | booking_id, frozen_card_id, status | Submitted after visit. |
| `ChargeLine` | sheet_id, pricing_line_id?, amount, variance, flagged | Out-of-card lines auto-flagged. |

### 5.3 Utilities

| Entity | Key attributes | Notes |
|---|---|---|
| `Meter` | flat_id?, society_id, kind, serial, multiplier, installed_at, retired_at | Null flat_id = society-level bulk or common meter. |
| `Reading` | meter_id, value, captured_at, reverses_reading_id? | Immutable. Corrections post a reversing reading. |
| `TariffSchedule` | society_id, utility, effective_from, slabs (JSONB), fixed_charges, duty_cess | JSONB; historical bills reproducible. |
| `BillingCycle` | society_id, utility, period, stage, status, bulk_invoice_amount, variance | Stages: open → readings closed → computed → published → settled. |
| `FlatBill` | cycle_id, flat_id, amount, basis, computation_trace (JSONB) | Trace records the formula and inputs used. |
| `WaterSource` | cycle_id, kind, volume, cost | Municipal / tanker / borewell. |

### 5.4 Ledger, collections and treasury

| Entity | Key attributes | Notes |
|---|---|---|
| `Account` | society_id, code, kind, balance_cache | Kinds: `MAINTENANCE | ELECTRICITY | WATER | PROCUREMENT_ESCROW | EVENTS | WELFARE | SINKING | CORPUS | EXTERNAL`. **No platform-owned account** (I2). |
| `LedgerEntry` | ts, idempotency_key, reason_code, linked_entity_type, linked_entity_id | Header. Idempotency key makes posting retry-safe. |
| `LedgerLine` | entry_id, account_id, debit, credit, flat_id?, counterparty | Balance constraint enforced at commit. |
| `Payment` | flat_id, aggregator_order_id, amount, status | |
| `Payout` | source_type, source_id, amount, status | |
| `PayoutAuthorisation` | payout_id, approver_id, decision, ts | Two distinct identities required at Rung 2. |
| `ApprovalPolicy` | society_id, lower_threshold, upper_threshold, majority_fraction | Per-society config. |
| `VirtualAccount` | flat_id, account_number, issued_at, active | Attribution key. |
| `BankStatementLine` | value_date, amount, reference, virtual_account, matched_entry, status | Unmatched → treasurer review. |
| `FixedDeposit` | society_id, principal, rate, placed_at, maturity, initiated_by, approved_by, status | Two distinct identities. |
| `AuditLog` | sequence, ts, society_id, actor_id, action, subject_type, subject_id, payload_json, previous_hash BYTEA, entry_hash BYTEA | Hash-chained. |

### 5.5 Community

| Entity | Key attributes | Notes |
|---|---|---|
| `ServiceRequest` | society_id, raised_by_flat_id?, origin, category, description, window, threshold, status | Threshold frozen at creation. |
| `Participation` | request_id, flat_id, joined_at, contribution, status | Opt-in record. No weight. |
| `Offer` | society_id, vendor_id, category, unit_price, discount_ladder (JSON), min_commitments, deadline, recurrence | Committee-origin. |
| `Commitment` | offer_id, flat_id, amount, status | |
| `Booking` | source_type, source_id, vendor_id, society_id, frozen_card_id, status, tier | Card frozen at confirmation. |
| `JobCard` | booking_id, flat_id, scope, unit_price, applied_discount_pct, status, signed_off_at | Atomic unit of work. |
| `Milestone` | booking_id, pct, status, retention_release_at | LARGE jobs only. |
| `Event` | society_id, title, capacity, per_flat_charge, window, refund_policy, status | Refund policy fixed at creation. |
| `Registration` | event_id, flat_id, status, waitlist_position | Automatic promotion. |
| `HealthCamp` | society_id, provider, slots | **No clinical fields** (I5). |
| `CampRegistration` | camp_id, flat_id, user_id, slot | |
| `DonationCampaign` | society_id, kind, target, recipient_organisation | Internal welfare or external pass-through. |
| `Contribution` | campaign_id, flat_id, amount, anonymous_to_residents, external_reference | Anonymity for resident view only; auditor sees contributor. |
| `JobBlogPost` | poster_id, kind, title, body, company_email_verified, expires_at | Non-financial. |
| `Dispute` | case_type, opener_id, subject_type, subject_id, status, triage_recommendation, resolution | |
| `Notification` | user_id, category, payload, seen_at | |

**Append-only tables:** `AuditLog`, `LedgerLine`, `Reading`, published `PricingCard`/`PricingLine`. Corrections are new rows. **No** `Vote`, loan, voucher or platform-owned account entity in the schema.

---

## 6. API Surface

REST + OpenAPI. Route prefix `/api/v1` (`GET /health` excluded). List endpoints use cursor pagination and `ETag` / `If-None-Match`; every endpoint emits server-timing headers.

### 6.1 Headline routes

```
# Auth & session
POST   /auth/otp                            resident: request phone OTP
POST   /auth/verify                         resident: redeem OTP → bearer token
POST   /auth/login                          officer/vendor: password + TOTP → session
GET    /me                                  principal, roles, society membership
GET    /me/home                             mobile aggregate
GET    /me/bills                            consolidated bills hub
GET    /me/approvals                        committee approvals inbox

# Onboarding
POST   /operator/societies                  operator: create society
POST   /societies/:sid/flats/import         committee: flat register CSV
POST   /societies/:sid/occupancies/claim    resident: claim a flat
POST   /occupancies/:oid/ratify             committee: ratify or reject

# Vendor directory & cards
GET    /societies/:sid/vendors              directory
POST   /societies/:sid/vendors              committee: onboard vendor
POST   /vendors/:vid/rate                   post-job rating
POST   /vendor/pricing-cards                vendor: publish card version
GET    /vendors/:vid/pricing-cards/:version

# Pooled requests
GET    /societies/:sid/requests
POST   /societies/:sid/requests             resident or committee: raise
POST   /requests/:rid/join
POST   /requests/:rid/assign                committee: assign vendor
POST   /requests/:rid/confirm               vendor: confirm → card freeze

# Committee-origin offers
POST   /societies/:sid/offers
POST   /offers/:oid/commit

# Job cards & charge sheets
POST   /bookings/:bid/job-cards/:jcid/sign-off
POST   /bookings/:bid/charge-sheets         vendor
POST   /charge-sheets/:csid/acknowledge     resident: acknowledge or dispute

# Payments & payouts
POST   /payments/orders                     aggregator order create
POST   /payments/webhook                    aggregator HMAC-verified webhook
POST   /payouts/:pid/approve                committee: record approval (ladder)

# Collections & treasury
POST   /societies/:sid/statements           treasurer: statement ingestion
GET    /societies/:sid/collections
POST   /societies/:sid/fixed-deposits

# Billing cycles
POST   /societies/:sid/billing-cycles       committee: start cycle
GET    /billing-cycles/:cid                 stage, flags, reconciliation variance

# Community
POST   /societies/:sid/events
POST   /events/:eid/register
GET    /jobs                                notice board
POST   /jobs                                create post (company-email verified)

# Disputes & audit
POST   /disputes
POST   /disputes/:did/resolve
GET    /audit                               committee view
GET    /audit/verify                        any resident: recompute chain

# Notifications
GET    /notifications/me
```

### 6.2 Contract discipline
- `shared/openapi.json` is generated from NestJS decorators.
- `packages/api-client` is generated from `shared/openapi.json`.
- Both clients consume the generated client.
- CI fails on drift between the running server and the checked-in OpenAPI file.

---

## 7. Module Design (Behaviour)

### 7.1 M1–M2 Onboarding and trust graph
Society onboarding imports the flat register from CSV, validates area factors sum to unity within tolerance, verifies the bank account by micro-transfer, and enrols committee officers with 2FA before any payment capability is enabled. Resident onboarding authenticates by phone OTP, requires committee ratification against the flat register, and records occupancy type explicitly. Delegation from an absentee owner is scoped to named operational capabilities; financial authorisation is excluded at the type level, so an over-broad delegation cannot be expressed.

### 7.2 M3 Committee console
Role-based access is evaluated at the API boundary from the `Role` table, never inferred from occupancy. Dual authorisation is a two-phase state machine: an initiating officer creates a pending instruction; a second officer with a distinct identity approves; only then does the payout or corpus movement execute. Approval routing compares the amount against configured thresholds and escalates above the upper threshold to a majority requirement.

### 7.3 M4 Vendor portal, pricing cards, charge sheets
The transparency mechanism, in strict sequence:
1. Vendor publishes a pricing card per category. Immutable on publication; revisions create a new version; the superseded version remains readable.
2. A pooled request is raised. It appears in the vendor's authenticated queue after committee assignment.
3. Vendor confirms and proposes a slot. **The platform freezes the current card version against the pool** and writes the freeze to the audit chain.
4. The frozen card renders in every participant's bills view before the visit.
5. After the visit the vendor submits an itemised charge sheet. The service matches each line to the frozen card and computes variance per line and in total.
6. Lines within the card require no action. Lines outside it are flagged and require resident acknowledgement; on dispute the matter routes to committee adjudication with both the frozen card and the submitted sheet as evidence.
7. Settlement to the vendor occurs from the relevant sub-ledger after acknowledgement, under dual authorisation.

Because the card version is frozen at confirmation rather than read at settlement, a vendor cannot revise prices between booking and completion and have the revision apply to work already accepted.

### 7.4 M5 Electricity billing
Worker-tier pipeline; each stage idempotent and resumable:

| Stage | Operation |
|---|---|
| 1. Ingest | Accept sub-meter readings by manual entry or CSV. Each reading is written to the audit chain at capture. |
| 2. Validate | Derive consumption vs prior reading. Flag negative consumption, stalled meters, rollover, values outside historical bounds. Flagged meters halt the cycle. |
| 3. Compute | Apply the tariff schedule in force; slab-wise breakdown with fixed charges, duty and cess. |
| 4. Apportion | Common-area = bulk − Σ sub-meters, distributed by area factor with deterministic rounding-residue allocation. |
| 5. Reconcile | Compare sum of flat bills + apportioned common charge against licensee bulk invoice. **Publish the variance, do not absorb it.** |
| 6. Publish | Post journal entries raising receivables, render bills with `computationTrace`, notify residents. |

Individually metered configuration bypasses stages 2–5: consumer number stored, bill retrieved, presented, and routed through the BBPS adapter. No society receivable arises.

### 7.5 M6 Water billing
Same pipeline; the costing stage sums three sources (municipal supply metered at inlet; tanker deliveries at delivered price; borewell at operating cost) into a blended per-kilolitre rate. Partial sub-meter deployment supported — metered flats billed on measurement, unmetered flats on a fallback (occupancy count or area factor). Basis recorded per bill; cross-subsidy reported to the committee.

### 7.6 M7 Pooled procurement
Two entry points converge on the same engagement and settlement path:
- **Resident-initiated:** raise → neighbours join → threshold met → committee sources vendor → vendor confirms → card freeze.
- **Committee-initiated offer:** committee opens → residents commit → threshold met → offer fires with the applicable discount tier snapshotted onto each job card.

Common: contributions post to a ring-fenced `PROCUREMENT_ESCROW` sub-ledger; society holds funds as agent for members under bye-laws. Threshold below viability at closing → lapse and return contributions. Large jobs (above society-set threshold) settle in milestones (e.g. 30/40/30) with defect-liability retention. Release follows sign-off, under dual authorisation, less any dispute hold-back.

### 7.7 M8–M10 Events, camps, donations
Events created by committee only; refund policy fixed at creation; waitlist promotion automatic; post-event surplus disposed of by pre-set rule. Health camps: schema holds registration identity and slot only — I5 enforced by the absence of any clinical field. Donations: internal welfare under dual authorisation; external campaigns redirect the resident to the recipient's own gateway (platform never receives the funds, so no pass-through custody).

### 7.8 M11 Bills and payments hub
Composes obligations from every module into one view per flat, ordered by due date. Each line carries its computation basis and evidence link — the meter reading, the apportionment formula, the pooled request, the registration, or the frozen pricing card. Payment routes by obligation type: society dues to the flat's virtual account or by UPI collect; third-party utility bills through BBPS. The interface labels which rail applies, because the distinction is not cosmetic.

### 7.9 M12 Collections, reconciliation, treasury
Inbound collection uses virtual account numbers issued by the society's bank, one per flat, sweeping into a single master account. Attribution is deterministic and the reconciliation ambiguity that arises when many residents pay identical amounts with poor references disappears. A worker ingests the bank statement, matches credits by virtual account, and posts journals. Unmatched credits queue for treasurer review.

The master account is partitioned into sub-ledgers (maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus). Sub-ledger balances reconcile to the bank balance by construction. Corpus treasury applies a sweep rule holding an operating-float floor and a minimum tenor; laddered placements distribute maturities across the year against known seasonal calls. Interest posts to society income only (I4).

### 7.10 M13 Ledger and audit chain
Every financial event posts as a balanced double-entry journal with an idempotency key. Balance constraint enforced at commit. Balances derived by query from journal lines; no stored balance is writable by application code (I6).

The audit chain appends a record for every journal entry and for consequential non-financial actions: meter readings, approvals, consent changes, pricing-card publication, card freezing at booking confirmation, delegation grants and revocations. Each record stores a digest over its payload together with the digest of its predecessor. Altering any historical record invalidates every subsequent digest. `GET /audit/verify` walks the chain and reports the first divergence; a scheduled worker performs the same walk and alerts on failure.

### 7.11 M14 Approvals and disputes
`PayoutAuthorisation` generalised to N approvers with count derived from amount vs `ApprovalPolicy`:
- **Rung 1** (below lower threshold): single officer.
- **Rung 2** (above lower threshold): two distinct approver identities.
- **Rung 3** (above upper threshold): configurable majority of the committee roster.

Same-identity approval and initiator-repeat are rejected at the service layer. Disputes: automated triage recommends a resolution by category and amount; committee accepts or overrides. Both decisions write to the audit chain.

---

## 8. Security and Privacy

### 8.1 Authentication and authorisation
- **Residents:** phone OTP → bearer token stored in secure device storage.
- **Committee officers and vendors:** password + mandatory TOTP → session cookie. Both roles can move money or bind prices.
- Server-side sessions with short idle expiry on privileged roles.
- Authorisation evaluated at the API boundary from `Role` + `Occupancy` tables. **Client-side role checks are presentational only** and never load-bearing.
- Dual authorisation on payouts and corpus movement (I7).

### 8.2 Data protection (DPDP Act 2023 alignment)
- **Data minimisation** as a design rule. No mandatory government identifier for residents. No health data. Vendor access to resident contact details is granted per transaction and expires with the engagement.
- **Consent ledger** enforced at query time — revocation is immediate.
- **Sub-meter readings** treated as personal data (consumption patterns reveal occupancy and absence). Access restricted to the flat's own occupants and the treasurer; retention bounded by a configured period.
- Transport encryption throughout; encryption at rest for the database; secrets held outside the image.
- Synthetic data only through development and evaluation. No production dataset exists.

### 8.3 Threat model

| Threat | Mitigation |
|---|---|
| Retrospective alteration of a bill or approval | Hash-chained audit; verification open to every resident; scheduled automated verification. |
| Phantom resident self-registering against a flat | Committee ratification against the imported flat register before any account is activated. |
| Single officer diverting funds | Dual authorisation with distinct identities; every instruction and approval chained. |
| Vendor inflating charges after the work | Card frozen at booking confirmation; automatic line-level variance; resident acknowledgement required. |
| Duplicate posting from a retried webhook or bank line | Idempotency key on journal entries; statement lines deduplicated on bank reference. |
| Tenant acquiring owner rights through delegation | Financial and voting capabilities excluded from the delegable set at the type level. |
| Vendor harvesting resident contact data | Consent scoped per transaction and expiring with the engagement; enforced at query time. |
| Notice-board impersonation/scams | Real resident attribution + verified company email + rate-limit + committee moderation. |

---

## 9. External Integrations

Every external dependency sits behind an adapter interface with a defined fallback, so the absence of a commercial arrangement never blocks development or assessment.

| Dependency | Purpose | Fallback |
|---|---|---|
| Bank cash-management API | Virtual account issuance; statement retrieval | CSV statement import (sufficient for evaluation). |
| BBPS via a Customer BBPOU | Third-party utility bill presentment and payment | Simulated adapter returning representative bill structures. No live rail is used during the dissertation. |
| UPI collect (Razorpay sandbox) | Small-value society dues | Sandbox mode; virtual-account transfer is the primary path in any case. |
| GSTIN verification (`gstinapi.in`) | Vendor verification, tier promotion | Checksum validation + committee attestation where service is unavailable; offline stub by default. |
| SMS and email | Notifications | Console + database sink in development; Maildev SMTP relay in demonstration. |

**No live payment rail, no live BBPS connection and no real bank account is used at any point.** Every integration runs in simulated or sandbox mode, consistent with the synthetic-data-only commitment.

---

## 10. Non-Functional Requirements

| Attribute | Target | Basis |
|---|---|---|
| Scale | 400 flats, 800 accounts, 60 vendors per society | Upper bound of the target segment. |
| Billing run | Full cycle for 400 flats within 60 s | Must complete comfortably within a committee meeting. |
| Interactive response | p95 < 500 ms for read endpoints | Usable on mid-range Android over mobile data. |
| Ledger integrity | Zero unbalanced entries; zero chain divergences | Asserted by the test suite and the scheduled verification worker. |
| Availability | Best-effort single-node for the prototype | Production hardening is out of scope and stated as such. |
| Accessibility | WCAG 2.1 AA on resident-facing screens | Resident population includes elderly users. |
| Localisation | English with translation layer in place | Regional-language support designed for, not populated. |

---

## 11. Deployment

### 11.1 Local dev (one command)

```bash
npm install
docker compose up -d
npm run prisma:migrate
npm run prisma:seed
npm run dev:backend
```

Clients start from their own workspaces. Optionally `python -m sim run --scenario baseline` from `simulation/`.

### 11.2 `docker-compose.yml` services
- `postgres:16-alpine` — database.
- `maildev` — SMTP inbox at `http://localhost:1080`.
- `redis` — worker queue.

### 11.3 `.env.example` (grouped)

```
# Foundation
NODE_ENV=development
API_PORT=4000
API_CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/society_fintech?schema=public

# Auth
SESSION_COOKIE_NAME=sid
SESSION_TTL_DAYS=30
SMS_PROVIDER=stub
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=no-reply@societyfintech.local

# Vendors
GSTIN_API_ENABLED=false

# Payments (sandbox only)
RAZORPAY_ENABLED=false
RAZORPAY_KEY_ID=rzp_test_stub
RAZORPAY_KEY_SECRET=stub_secret
RAZORPAY_WEBHOOK_SECRET=stub_webhook

# Worker tier
REDIS_URL=redis://localhost:6379

# Clients
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

### 11.4 Seed
A single `prisma:seed` command populates the 90-flat synthetic reference society: managing committee, owner-occupiers, an absentee owner with an active tenant delegation, tenants, vendors with published pricing cards, twelve months of meter readings, and a representative history of events, camps and contributions. **No external credentials required** — a deliberate requirement for assessment.

---

## 12. Client Structure

### 12.1 Resident app — `apps/mobile/` (React Native + Expo)

```
apps/mobile/app/                  # Expo Router
├── (auth)/                       # phone OTP, flat claim, awaiting-ratification
├── (tabs)/
│   ├── home/                     # GET /me/home
│   ├── bills/                    # bills hub, bill detail with trace, pay
│   ├── requests/                 # raise, browse, join, request detail
│   ├── events/                   # browse, opt in
│   └── more/                     # vendors, notice board, camps, donations, audit verify
└── (committee)/approvals/        # light approvals inbox for committee members only
```

- Persisted read cache (MMKV). Cold start never blocks on auth.
- Optimistic mutations with rollback on join, opt-in, acknowledgement, rating.
- Offline mutation queue replayed with idempotency keys.
- Push, never poll.

### 12.2 Management web — `apps/web/` (Next.js App Router)

```
apps/web/app/
├── (auth)/                       # password + 2FA
├── (committee)/                  # ratification, flat import, requests + assignment,
│                                 # billing cycles, collections, treasury, approvals,
│                                 # events, disputes, notice moderation, audit
├── (vendor)/                     # pricing cards, engagement queue, charge sheets, profile
└── (operator)/                   # societies, first officer, vendor audit tier
```

Role-based server-side redirection happens in each group's `layout.tsx`.

---

## 13. Simulation Harness — `simulation/`

Offline Python 3.13 + NumPy + pandas + Matplotlib. Deliberately separate from the application runtime.

```
simulation/sim/
├── config.py                     # parameters
├── synthetic/                    # society, residents, vendors, consumption, water
├── engine/                       # clock, electricity, requests, collections, treasury, ledger
├── analysis/                     # sensitivity, monte_carlo, functional, report
└── cli.py                        # `python -m sim run --scenario X`
```

**Contract:** every run deterministic given a seed; seed, parameters and timestamp written with every run; every run writes a versioned JSON report plus CSV and Matplotlib PNGs to `outputs/`. Runs are triggered manually — never by an HTTP call.

**Scenarios:**
1. Baseline (90 flats, 12 months, Monte Carlo to stable intervals).
2. Bulk HT vs individual LT electricity — principal economic result.
3. Electricity sensitivity — tariff differential, common-area load fraction, regulatory cap.
4. Pooled-request aggregation — saving by participation rate and category threshold vs published card rates.
5. Collections — collection-rate distribution and arrears ageing.
6. Water volatility — cost under seasonal tanker dependency.
7. Corpus sweep — yield vs liquidity risk.

---

## 14. Testing Strategy

- **Backend:** vitest unit tests for ledger conservation, approval-ladder counting, apportionment, tariff slabs, variance computation, dispute triage. e2e per module against real PostgreSQL, never a mock. **Every compliance invariant has an explicit test.**
- **Web:** one Playwright happy path per phase.
- **Mobile:** one Maestro flow per phase; every screen tested at 375 px; lists tested with 0, 1 and 200 items.
- **Simulation:** pytest for engine determinism and functional-accuracy checks.
- **End-to-end demo:** resident raises a request → neighbours join → committee assigns vendor → vendor confirms (card frozen) → payment via sandbox → sign-off → charge sheet with a flagged line → acknowledgement → settlement through the approval ladder → audit chain verifies.

---

## 15. Evaluation Plan

Entirely computational. No human-participant study, no usability testing, no live deployment.

### 15.1 Functional accuracy
- Billing correctness against hand-computed reference cases across tariff-slab boundaries.
- Apportionment: derived common-area charges sum to residual; distribution matches area factors to rounding tolerance; rounding residue allocated deterministically.
- Ledger integrity: every posted entry balances; derived balances reconcile to the sum of sub-ledgers; the bank balance reconciles to the sum of sub-ledger balances.
- Audit chain: verification passes on an unmodified chain and detects a deliberately mutated historical record at the correct sequence position.
- Idempotency: replayed postings and duplicated statement lines produce no duplicate effect.
- Pricing-card binding: a card revised after confirmation does not alter frozen terms; variance detection flags every out-of-card line.
- Access-control matrix asserted exhaustively.

### 15.2 Economic simulation
Monte Carlo over the 90-flat reference society, twelve-month horizon:
- Bulk HT vs aggregate individual LT electricity cost.
- Sensitivity to tariff differential, common-area load fraction and any regulatory cap.
- Collection-rate distribution and arrears ageing.
- Water cost volatility under seasonal tanker dependency.
- Corpus sweep yield vs liquidity risk.

### 15.3 Qualitative
- Architectural evaluation of the compliance invariants: demonstration that each is enforced structurally rather than by convention, with the corresponding test.
- Comparative regulatory analysis of the credit perimeter vs the payments perimeter — the dissertation's principal analytical contribution.
- Walkthrough of representative scenarios: a disputed visit charge, a stalled meter, an unmatched bank credit, a lapsed bulk-buy pool, a revoked delegation.

### 15.4 Threats to validity
- Synthetic data is generated from assumptions about consumption and payment behaviour that are themselves unvalidated. Results are internally consistent but not externally calibrated.
- Tariff structures differ by state; the modelled saving is specific to the chosen reference regime.
- No usability claim is made — no usability study was conducted.
- The regulatory analysis reflects the position as researched and is not legal advice.

---

## 16. Implementation Status

Phases shipped through Phase 5:
- Foundation: NestJS app, Prisma schema, hash-chained audit log with passing end-to-end verification, synthetic seed.
- Phase 4A — append-only double-entry escrow ledger, e2e-verified.
- Phase 4B — Razorpay sandbox + payments module, e2e-verified.
- Phase 4C — bulk-buy Flow A (committee-origin offer → payout), e2e-verified.
- Phase 4D — large-job milestones + defect-liability retention.
- Phase 5 — bulk-buy Flow B (resident-initiated), e2e-verified.

Remaining modules are specified in this document and tracked in [BACKEND_PLAN.md](BACKEND_PLAN.md) (Phases 6–13) and [FRONTEND_PLAN.md](FRONTEND_PLAN.md) (F0–F9). Order: identity generalisation → electricity billing → collections and reconciliation → vendor portal and pricing cards → remaining collection modules → governance and notifications.
