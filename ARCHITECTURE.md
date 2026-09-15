# Architecture — Society FinTech Platform v0.1

Companion to [PRODUCT_PLAN.md](PRODUCT_PLAN.md) and [DESIGN.md](DESIGN.md). This document commits to a stack, a repository layout, and a code split between backend and frontend.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Frontend surface | Responsive web only |
| Payment aggregator | **Razorpay sandbox** (test-mode, no real money) |
| Synthetic society scale | **90 flats** (default; parameterised) |
| Simulation horizon | **3 months** (default) |
| Dispute resolution | **Automated triage → committee final call** |

Time boundation: none — completeness over speed.

---

## 2. Stack (proposed, still open to challenge)

Chosen for: strong TypeScript typing across the stack; a real, boring, production-grade backend framework; Python where it earns its keep (the lending simulation).

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query | Responsive, batteries-included, great DX, works with Razorpay Checkout. |
| **Backend API** | NestJS + TypeScript + Prisma ORM | Modular, opinionated, testable, works cleanly with the domain slicing this project needs. |
| **Database** | PostgreSQL 16 | Transactions and row-level scoping the multi-society model needs. Immutable ledger tables use append-only patterns. |
| **Payments** | Razorpay Node SDK (test-mode keys only) | Directly supported; sandbox-first is exactly the design. |
| **Auth** | Session-based (`iron-session` on the frontend; JWT-in-httpOnly-cookie on the API) with OTP-via-email verification for KYC | Simple, no third-party auth vendor lock-in for a dissertation. |
| **Lending simulation** | Python 3.13 + NumPy + pandas + matplotlib, offline harness | Monte Carlo, sensitivity analysis, and reporting are Python's home turf. |
| **Simulation surfacing** | Simulation writes JSON/CSV artefacts to `simulation/outputs/`; frontend reads them via a read-only API endpoint | Keeps the sim out of the request path; a run isn't triggered by a user click. |
| **Shared types** | OpenAPI spec generated from NestJS, TypeScript types generated for the frontend | Single source of truth for contracts. |
| **Local dev** | `docker-compose` (Postgres + optional Maildev for OTP inspection) | One command up. |
| **Testing** | Jest for backend + frontend; pytest for simulation; Playwright for one end-to-end demo flow | Coverage where it earns its place; not everywhere. |

If any of these choices is wrong for your setup — say so and we adjust before we scaffold.

---

## 3. Repository layout (top level)

```
society-fintech/
├── README.md
├── docker-compose.yml
├── .env.example
├── package.json                 # workspaces root (frontend + backend)
├── pnpm-workspace.yaml          # (or npm workspaces)
├── frontend/                    # Next.js app  — §5
├── backend/                     # NestJS API   — §4
├── simulation/                  # Python sim   — §6
├── shared/                      # OpenAPI + generated types — §7
├── docs/                        # PRODUCT_PLAN.md, DESIGN.md, CRITIQUE.md, ARCHITECTURE.md
└── scripts/                     # dev, seed, migrate, demo
```

Two deployables (`frontend/` and `backend/`) plus one offline harness (`simulation/`).
Type-safety across the wire via `shared/`.

---

## 4. Backend — `backend/` *(NestJS API)*

### 4.1 Directory layout

```
backend/
├── prisma/
│   ├── schema.prisma            # single source of truth for the data model
│   ├── migrations/              # versioned migrations
│   └── seed/
│       ├── seed.ts              # deterministic dev seed
│       └── synthetic-society.ts # 90-flat dataset generator (calls Python via CLI if needed)
├── src/
│   ├── main.ts                  # bootstrap
│   ├── app.module.ts
│   ├── config/                  # env schema, feature flags
│   ├── common/
│   │   ├── decorators/          # @Roles, @CurrentUser, @SocietyScope
│   │   ├── guards/              # AuthGuard, RolesGuard, SocietyScopeGuard
│   │   ├── interceptors/        # AuditLogInterceptor, ConsentLedgerInterceptor
│   │   ├── pipes/               # DTO validation
│   │   ├── filters/             # domain-error → HTTP mapping
│   │   ├── dto/                 # shared DTOs
│   │   └── util/
│   ├── infra/
│   │   ├── prisma/              # PrismaService, unit-of-work helpers
│   │   ├── razorpay/            # Razorpay client wrapper (sandbox-only)
│   │   ├── mailer/              # OTP + notifications
│   │   ├── sms/                 # optional gateway abstraction
│   │   └── clock/               # injectable Clock for deterministic tests
│   └── modules/
│       ├── auth/                # signup, login, OTP, session
│       ├── users/               # user + profile + KYC tier
│       ├── societies/           # society, committee, treasurer roles
│       ├── flats/               # flat + occupancy (owner / tenant, tenure)
│       ├── kyc/                 # verification workflow
│       ├── vendors/             # geotagged directory, ratings, access requests
│       ├── bulk-buy/            # offers (Flow A) + polls (Flow B) + job cards + commitments
│       ├── payments/            # Razorpay sandbox integration + webhook handling
│       ├── ledger/              # double-entry escrow ledger + sub-accounts + reconciliation
│       ├── vouchers/            # voucher wallet + redemption inside bulk-buy
│       ├── lending/             # SIMULATED — reads sim outputs; loan CRUD is UI-only, marked non-production
│       ├── job-blog/            # posts + company-email verification + moderation
│       ├── polls/               # event polls (shared engine with bulk-buy polls)
│       ├── governance/          # proposals, votes, dispute cases
│       ├── disputes/            # dispute ladder + automated triage
│       ├── notifications/       # in-app + SMS + email dispatch
│       ├── audit/               # immutable audit-log service
│       └── admin/               # committee + treasurer admin surface
├── test/
│   ├── e2e/                     # end-to-end API tests per module
│   └── fixtures/                # canned data
├── nest-cli.json
├── package.json
├── tsconfig.json
└── openapi.gen.ts               # regenerates shared/openapi.json
```

### 4.2 Module responsibilities

**`auth/`**
- Email OTP signup + login.
- Session (JWT in httpOnly cookie).
- Password not used in v1 (magic-link/OTP only).

**`users/`, `flats/`, `societies/`**
- Society is the tenant boundary; every other module scopes to it.
- Occupancy record: `flat`, `user`, `role: OWNER | TENANT`, `tenure_started_at`.
- Committee and treasurer roles are society-level assignments on top of an occupancy.

**`kyc/`**
- Two tiers: standard (owner/vendor) and light (tenant).
- Document upload stub — for the dissertation, storage is local disk / S3-compatible.

**`vendors/`**
- Geolocation + service radius + categories.
- Verification tier state machine.
- Access-request per transaction (a poll join implies consent).
- Rating aggregate maintained lazily on every signed-off job card.

**`bulk-buy/`** *(the biggest module)*
- One entity model covers both flows:
  - `Offer`: vendor-initiated. Fields: min_commitments `N`, deadline `T`.
  - `Poll`: resident-initiated. Fields: tagged vendor, proposed slot, vendor-confirmed minimum.
  - Both fire the same `Booking → JobCard[] → Escrow → Payout` sequence.
- Weekly-recurring subscription is a variant of Offer with `recurring: WEEKLY`.
- Two-tier flow: `JobCard.tier: SMALL | LARGE` — LARGE uses milestone payouts and defect-liability retention.

**`payments/`**
- Razorpay client abstraction (only test-mode keys wired in v1).
- Order creation, payment capture, refund.
- Webhook handler with idempotent signature verification.
- Every payment event writes to the ledger.

**`ledger/`**
- Append-only `LedgerEntry` table; every row has `debit_account`, `credit_account`, `amount`, `reason_code`, `linked_entity`.
- `Account` records for: society-master, bulk-buy-holding, voucher-pool, dispute-hold, lending-pool (simulated), platform-commission-sink.
- Reconciliation service pulls Razorpay's daily settlement report and matches against ledger.
- Payout requires two authorisations (system + treasurer); a payout not yet dual-signed sits in a `pending` state.

**`vouchers/`**
- Voucher wallet per user.
- Issued on lending-repayment (simulated) or as promotional credit.
- Redeemable inside `bulk-buy` commitments as a partial payment method.

**`lending/`** *(simulated, non-production, clearly flagged)*
- CRUD for loan requests + agreements + repayment schedule.
- Reads simulation outputs from `simulation/outputs/` for aggregate views.
- A prominent in-product banner: *"Simulation only — no real money moves."*
- Enforces the hard rules in code: owner-only, 2× monthly maintenance cap, 90-day tenor, society-level monthly volume cap.
- Three repayment paths implemented as strategies: `MaintenanceAdjustmentStrategy`, `VendorVoucherStrategy`, `BankTransferStrategy`.

**`job-blog/`**
- Post CRUD.
- Company email verification via signed token link.
- Rate limiter: 1 post / resident / month, society-configurable.
- Committee moderation actions.

**`polls/`**
- Event-poll engine, shared with bulk-buy poll (same base entity, different money-flow rules).

**`governance/`** and **`disputes/`**
- Proposal + vote workflow.
- Dispute case with a defined ladder per case type.
- **Automated triage:** rule engine categorises a new dispute (missed SLA, quality issue, payment mismatch, etc.), recommends a resolution (refund X%, re-do job, etc.), and routes to committee for final approval. Committee can accept or override the recommendation.

**`notifications/`**
- Category-based dispatch; per-user opt-outs.
- Pluggable channels (email dev, SMS stub, in-app).

**`audit/`**
- One append-only table. Every state change writes here via `AuditLogInterceptor`.
- Consent ledger is a sub-view of audit filtered to `type = CONSENT`.

**`admin/`**
- Endpoints backing committee and treasurer dashboards.
- Never exposes individual balances of other residents; only aggregates.

### 4.3 Prisma data model (headline entities)

```
User(id, name, email, phone, kyc_tier, created_at)
Society(id, name, address, geolocation, config)
Flat(id, society_id, unit_no, maintenance_amount)
Occupancy(id, flat_id, user_id, role[OWNER|TENANT], tenure_started_at, tenure_ended_at)
Role(id, society_id, user_id, kind[COMMITTEE|TREASURER|DEPUTY_TREASURER])

Vendor(id, name, geolocation, radius_km, verification_tier, contact)
VendorCategory(vendor_id, category)
VendorRating(id, vendor_id, job_card_id, rating, comment, source[RESIDENT|COMMITTEE])
VendorAccessRequest(id, vendor_id, resident_id, purpose, granted_at, revoked_at)

Offer(id, vendor_id, society_id, category, unit_price, discount_pct, min_commitments, deadline, recurring)
Poll(id, society_id, creator_id, tagged_vendor_id, category, proposed_slot, min_commitments, deadline, kind[BULK_BUY|EVENT])
Commitment(id, offer_id?, poll_id?, user_id, amount, status)
Booking(id, source_type, source_id, vendor_id, society_id, status, tier[SMALL|LARGE])
JobCard(id, booking_id, resident_id, scope, price, sla, status, signed_off_at)

Account(id, society_id, kind[SOCIETY_MASTER|BULK_BUY|VOUCHER|DISPUTE|LENDING_SIM|COMMISSION_SINK])
LedgerEntry(id, ts, debit_account_id, credit_account_id, amount, reason_code, linked_entity_type, linked_entity_id)
Payout(id, booking_id, amount, status, authorisations[])
Voucher(id, wallet_user_id, amount, source, expires_at, redeemed_at)

LoanRequest(id, borrower_id, amount, purpose, status)      -- SIM
LoanAgreement(id, request_id, lender_id, tenor_days, repayment_mode, terms) -- SIM
RepaymentSchedule(id, loan_id, due_date, amount, status)   -- SIM
MaintenanceAdjustment(id, loan_id, user_id, month, delta)  -- SIM

JobBlogPost(id, poster_id, kind[HIRING|SEEKING], title, body, company_email_verified, expires_at)
Proposal(id, society_id, kind, body, status)
Vote(id, proposal_id, user_id, choice)
Dispute(id, case_type, opener_id, subject_type, subject_id, status, triage_recommendation, resolution)

AuditLog(id, ts, actor_id, action, subject_type, subject_id, payload_json)
Notification(id, user_id, category, payload, seen_at)
```

Every entity except `AuditLog` and `LedgerEntry` is mutable; those two are append-only.

### 4.4 API surface (headline routes)

REST + OpenAPI. Route prefix `/api/v1`.

```
POST   /auth/signup                         email + basic profile
POST   /auth/otp                            request OTP
POST   /auth/verify                         redeem OTP → session

GET    /me                                  profile + roles + society membership

GET    /societies/:sid                      society view
POST   /societies/:sid/flats                admin: add flat
POST   /societies/:sid/occupancies          committee: assign resident to flat

GET    /societies/:sid/vendors              directory
POST   /societies/:sid/vendors              committee: onboard vendor
POST   /vendors/:vid/rate                   post-job rating

GET    /societies/:sid/offers               list Flow A offers
POST   /societies/:sid/offers               vendor: create Flow A offer
POST   /offers/:oid/commit                  resident: opt-in

GET    /societies/:sid/polls                list Flow B + event polls
POST   /societies/:sid/polls                resident: create poll (tag vendor)
POST   /polls/:pid/join                     resident: join

POST   /bookings/:bid/job-cards/:jcid/sign-off
POST   /bookings/:bid/payouts/authorise    system or treasurer

POST   /payments/orders                    Razorpay order create
POST   /payments/webhook                    Razorpay webhook

GET    /ledger/:sid                         committee: aggregates only
GET    /ledger/:sid/reconciliation          treasurer

GET    /vouchers/me                         wallet balance
POST   /vouchers/:vid/redeem                (used internally by bulk-buy)

# Simulated lending
GET    /lending/simulation/summary          reads simulation/outputs/*.json
POST   /lending/simulation/loan-request     records a request in the sim UI
POST   /lending/simulation/agreement        records an agreement in the sim UI

GET    /jobs                                job blog list
POST   /jobs                                create post (company email verification enforced)

POST   /disputes                            open dispute
GET    /disputes/:did                       triage recommendation + status
POST   /disputes/:did/resolve               committee decision

GET    /audit                               committee: audit log view
GET    /notifications/me
```

### 4.5 Backend cross-cutting patterns

- **`SocietyScopeGuard`** — every route with `:sid` verifies the current user has an active occupancy or role in that society.
- **`RolesGuard`** — `@Roles(OWNER)`, `@Roles(COMMITTEE, TREASURER)`, etc.
- **Unit-of-work** — Prisma transactions wrap every multi-write action (booking + escrow + audit).
- **Idempotency keys** on payment and webhook endpoints.
- **Feature flags** in `config/` for lending-simulation-visible, job-blog-enabled, etc.

---

## 5. Frontend — `frontend/` *(Next.js App Router)*

### 5.1 Directory layout

```
frontend/
├── app/
│   ├── layout.tsx                    # root layout, theme, providers
│   ├── globals.css
│   ├── page.tsx                      # landing (public)
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── verify/page.tsx
│   ├── (resident)/
│   │   ├── dashboard/page.tsx
│   │   ├── marketplace/
│   │   │   ├── page.tsx              # vendor directory
│   │   │   └── [vendorId]/page.tsx   # vendor record
│   │   ├── offers/
│   │   │   ├── page.tsx              # Flow A: live vendor offers
│   │   │   └── [offerId]/page.tsx
│   │   ├── polls/
│   │   │   ├── page.tsx              # Flow B + event polls
│   │   │   ├── new/page.tsx          # create poll, tag vendor
│   │   │   └── [pollId]/page.tsx
│   │   ├── jobs/
│   │   │   ├── page.tsx              # job blog
│   │   │   ├── new/page.tsx
│   │   │   └── [postId]/page.tsx
│   │   ├── wallet/page.tsx           # voucher balance + history
│   │   ├── lending/                  # gated: OWNER role only
│   │   │   ├── page.tsx              # borrower + lender views (SIMULATION banner)
│   │   │   ├── request/page.tsx
│   │   │   └── history/page.tsx
│   │   └── profile/page.tsx
│   ├── (committee)/
│   │   ├── admin/
│   │   │   ├── page.tsx              # committee dashboard
│   │   │   ├── vendors/page.tsx      # approve, moderate
│   │   │   ├── disputes/page.tsx     # triage list + resolution
│   │   │   ├── treasury/page.tsx     # reconciliation view
│   │   │   ├── governance/page.tsx   # proposals + votes
│   │   │   └── reports/page.tsx      # aggregates + AGM statement
│   ├── (vendor)/
│   │   ├── vendor/
│   │   │   ├── page.tsx              # vendor dashboard
│   │   │   ├── offers/page.tsx
│   │   │   ├── offers/new/page.tsx
│   │   │   ├── jobs/page.tsx         # committed jobs to fulfil
│   │   │   └── profile/page.tsx
│   ├── simulation/                   # DISSERTATION-ONLY route
│   │   ├── page.tsx                  # sensitivity analysis dashboard
│   │   ├── scenarios/page.tsx
│   │   └── report/page.tsx           # pull JSON/CSV from backend
│   └── api/                          # thin BFF proxies where useful (auth session refresh, Razorpay callbacks)
├── components/
│   ├── ui/                           # shadcn/ui primitives
│   ├── forms/
│   ├── data/                         # tables, cards
│   ├── layout/                       # AppShell, Sidebar, TopBar
│   ├── charts/                       # sensitivity plots
│   ├── razorpay/                     # Checkout wrapper
│   └── simulation/                   # simulation-specific widgets
├── lib/
│   ├── api/                          # generated typed client from OpenAPI
│   ├── auth/                         # session helpers
│   ├── razorpay/                     # frontend SDK wrapper
│   ├── util/
│   └── guards/                       # role gates for client-side routes
├── hooks/
│   ├── useCurrentUser.ts
│   ├── useSociety.ts
│   ├── usePoll.ts
│   ├── useOffer.ts
│   └── useSimulationReport.ts
├── styles/
├── public/
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### 5.2 Route groups

Using Next.js **route groups** (parentheses) so the URL stays clean while the layout differs per role:

- `(auth)` — full-bleed login/signup layout
- `(resident)` — standard app shell for owners and tenants
- `(committee)` — admin shell with sidebars
- `(vendor)` — vendor-facing shell
- `simulation` — separate top-level route for the dissertation-facing view

Role-based server-side redirection happens in each group's `layout.tsx`.

### 5.3 Client-side rules

- Every mutation goes through the typed API client generated from `shared/openapi.json`.
- Server components fetch data; client components handle interactivity (polls, forms, Razorpay).
- Wallet balance and voucher redemption are optimistic-updated with rollback.
- **Simulation banner** on every `/lending/*` route: prominent, non-dismissible in the demo build.

### 5.4 Simulation view

- Reads pre-computed simulation outputs from the backend (which reads them from `simulation/outputs/`).
- Charts: pool-health over time, default rate sensitivity, repayment-option comparison, sensitivity heatmaps.
- Uses Recharts (Tailwind-friendly, small).

---

## 6. Simulation — `simulation/` *(Python, offline)*

### 6.1 Directory layout

```
simulation/
├── pyproject.toml
├── README.md
├── sim/
│   ├── __init__.py
│   ├── config.py                     # parameters (N flats, horizon, distributions)
│   ├── synthetic/
│   │   ├── society.py                # generates 90-flat society
│   │   ├── residents.py              # persona distribution
│   │   ├── vendors.py                # vendor pool with categories + radii
│   │   ├── graph.py                  # trust graph edges
│   │   └── shocks.py                 # income shocks, medical events triggering loans
│   ├── engine/
│   │   ├── clock.py                  # discrete-day simulation loop
│   │   ├── bulk_buy.py               # runs offers + polls over the horizon
│   │   ├── lending.py                # loan request → match → repay → default
│   │   ├── maintenance.py            # monthly maintenance run + adjustments
│   │   └── ledger.py                 # simple double-entry ledger mirroring backend
│   ├── strategies/
│   │   ├── maintenance_adjustment.py # repayment as maintenance credit/debit
│   │   ├── voucher.py                # repayment as marketplace voucher
│   │   └── bank_transfer.py          # fallback
│   ├── analysis/
│   │   ├── sensitivity.py            # sweeps over parameters
│   │   ├── monte_carlo.py            # N-run averaging + confidence bands
│   │   └── report.py                 # writes JSON/CSV + matplotlib PNGs
│   └── cli.py                        # entrypoint: `python -m sim run --scenario X`
├── notebooks/
│   ├── 01_society_generation.ipynb
│   ├── 02_bulk_buy_walkthrough.ipynb
│   ├── 03_lending_baseline.ipynb
│   ├── 04_repayment_comparison.ipynb
│   └── 05_sensitivity_analysis.ipynb
├── data/
│   ├── seed/                         # deterministic seed files
│   └── scenarios/                    # named parameter sets
├── outputs/                          # generated artefacts (frontend reads these)
│   ├── report.json
│   ├── pool_health.csv
│   └── plots/*.png
└── tests/
    ├── test_engine.py
    ├── test_strategies.py
    └── test_sensitivity.py
```

### 6.2 Simulation contract

- Every run is deterministic given a seed.
- Every run writes to `outputs/` a versioned JSON with everything the frontend renders.
- The backend `lending/` module reads `outputs/report.json` for the dashboard.
- Runs are triggered manually during development (`python -m sim run`) — never by an HTTP call in v1.

### 6.3 Scenarios shipped in v1

1. **Baseline** — 90 flats, 3 months, 60% owner opt-in, 5% default.
2. **Low opt-in** — 30% opt-in.
3. **High default** — 15% default.
4. **All-maintenance-adjustment** — every loan repaid via maintenance strategy.
5. **All-voucher** — every loan repaid via voucher.
6. **Mixed** — realistic distribution across the three strategies.

---

## 7. Shared — `shared/`

```
shared/
├── openapi.json                       # generated from NestJS
├── types/
│   ├── index.d.ts                     # generated from openapi.json
│   └── domain.d.ts                    # hand-maintained domain enums that both sides use
└── constants/
    ├── roles.ts
    ├── categories.ts
    └── error-codes.ts
```

Regeneration:
- `pnpm --filter backend gen:openapi` produces `shared/openapi.json`
- `pnpm --filter frontend gen:types` consumes it into `shared/types/`

---

## 8. Environment and configuration

### 8.1 `.env.example` (root)

```
# Postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/society_fintech

# API
API_PORT=4000
API_JWT_SECRET=changeme
API_CORS_ORIGIN=http://localhost:3000

# Frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx

# Razorpay (backend, sandbox only)
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxx

# Mail (dev)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=no-reply@societyfintech.local

# Simulation
SIMULATION_OUTPUTS_DIR=../simulation/outputs
```

### 8.2 `docker-compose.yml` (dev)

```
postgres:16-alpine    # database
maildev                # SMTP inbox at http://localhost:1080
```

### 8.3 One-command dev

```
pnpm install
docker compose up -d
pnpm --filter backend prisma migrate dev
pnpm --filter backend seed
pnpm dev            # runs frontend + backend in parallel
```

Optionally: `python -m sim run --scenario baseline` from `simulation/` to populate `outputs/` before the frontend loads the `/simulation` route.

---

## 9. Testing strategy

- **Backend**: Jest, one e2e per module happy path; unit tests for the ledger and dispute-triage rule engine (both are financial-logic critical).
- **Frontend**: Jest + React Testing Library on the poll, offer, and lending flows.
- **Simulation**: pytest for engine determinism and strategy invariants.
- **End-to-end**: one Playwright script that walks the demo — resident joins a poll → poll fires → job cards created → sign-off → payout — with Razorpay's test-mode UPI.

---

## 10. What is next

Given the scope, the next document is `IMPLEMENTATION_PLAN.md`: a sequenced build plan (which module first, which route next, what to demo, in what order) so we don't try to build everything at once. Say the word and I'll write it.

---

## 11. Anything I'd flag before you accept this

- The stack is a proposal, not a mandate. If you want fewer moving parts (e.g. Next.js server actions instead of a separate NestJS backend), that's a valid one-service alternative; the code split then becomes internal folders inside one Next.js app. Ask if you want that variant.
- Python for simulation is a real value-add here (matplotlib + pandas), but it does mean two languages. Pure-TypeScript alternative: use `simple-statistics` and `plotly.js` inside a small Node script. Cleaner if you'd rather stay monolingual.
- 90 flats is small enough that simulations run in milliseconds — comfortable for interactive dashboards. Larger dissertations sometimes use 500-1000 flats; if you'd like the option, `simulation/config.py` will parameterise it.
