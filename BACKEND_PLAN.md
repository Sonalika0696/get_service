# Backend Implementation Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Sequenced, incremental, single-feature-first. Each phase leaves the backend in a **runnable, testable state**.

Delivery principle: **the base is usable at Phase 1** (auth + one feature). Every phase after adds one feature and does not break earlier ones. No time boundation — phases move on quality, not clock.

Progress is tracked in [SUPERVISOR.md](SUPERVISOR.md).

---

## Phase 0 — Foundation *(pre-feature; nothing user-visible yet)*

**Goal:** the backend runs, connects to Postgres, has one seeded society, one committee member, and one resident. No features yet — only the platform for them.

- [ ] Repo scaffold: `backend/` NestJS app, ESLint + Prettier, tsconfig, package.json
- [ ] `docker-compose.yml` at repo root: Postgres 16 + Maildev
- [ ] Prisma set up; initial migration for base entities: `User`, `Society` (with `audit_tail_hash`), `Flat` (with `ownership_share` default 1.0), `Occupancy` (`role` enum `OWNER_OCCUPIER | OWNER_ABSENTEE | TENANT`, `delegated_to_user_id` nullable), `Role`
- [ ] `config/` module with Zod-validated env
- [ ] `common/` primitives: logger, error filter, validation pipe, `Clock` service
- [ ] `AuditLogInterceptor` writing to `AuditLog` — **hash-chained** (`previous_hash` + `entry_hash = SHA-256(previous_hash || canonicalJson(payload))`); Postgres advisory lock on the society-scoped chain to guarantee serialised appends; `Society.audit_tail_hash` cached
- [ ] `audit/verify` service: recomputes forward from genesis; returns the first divergent row (or `null`)
- [ ] Health check route: `GET /health` returns `{ok: true, db: "up"}`
- [ ] Seed script: 1 society ("Test Society"), 90 flats, 1 committee member, 2 owner-occupiers, 1 owner-absentee (with tenant delegation), 2 tenants (no KYC yet — placeholder identities)

**Definition of done:** `pnpm --filter backend start:dev` runs. `curl /health` returns ok. `SELECT count(*) FROM "Flat"` returns 90.

---

## Phase 1 — Auth and Job Blog *(first usable feature end-to-end)*

**Why Job Blog first:** smallest complete feature. No payments, no vendors, no escrow — proves the stack works end-to-end with real domain logic. High user value on its own.

**Goal:** a resident can log in and post a job. Another resident can browse it. Committee can moderate.

- [ ] `auth/` module: signup, email OTP, session (JWT in httpOnly cookie), logout
- [ ] `AuthGuard`, `SocietyScopeGuard`, `RolesGuard`
- [ ] `@CurrentUser`, `@Roles`, `@SocietyScope` decorators
- [ ] `users/` module: profile read/update
- [ ] `job-blog/` module:
  - Post CRUD (create, list, get, soft-delete)
  - Kind: `HIRING` or `SEEKING`
  - Hiring post requires company email → verification link → status flip
  - Rate limiter: 1 post / resident / month (society-configurable)
  - Committee `flag/remove` action
  - Auto-archive after 60 days
- [ ] `notifications/` module (minimal): email dispatch via Maildev
- [ ] E2E test: signup → OTP → verify → create hiring post → company email verify → post visible → committee flag → post hidden

**Definition of done:** a fresh developer clones the repo, runs the one-command dev flow, signs up, and posts a job.

---

## Phase 2 — Vendor Marketplace

**Goal:** committee onboards vendors; residents browse a directory; residents can rate a vendor after a job (job rating stub — real job flow comes in Phase 4).

- [ ] `vendors/` module:
  - Vendor entity, geolocation, service radius, categories, `gstin`, `gstin_verified_at`
  - Verification tier state machine: `UNVERIFIED → SOCIETY_ATTESTED → PLATFORM_AUDITED`
  - Access request records (resident-vendor consent events)
  - Ratings table + aggregate maintained lazily
- [ ] `infra/gstinapi/` client: free-tier GSTIN lookup; retries + timeouts; feature-flagged so tests can stub it
- [ ] Vendor onboarding: on committee approval, if GSTIN provided → call `gstinapi.in`; if the response says "Active", auto-promote to `SOCIETY_ATTESTED` and stamp `gstin_verified_at`; lookup failures logged, non-fatal
- [ ] `kyc/` module (light): document upload stub (local disk in dev)
- [ ] Endpoints: list vendors, vendor detail, committee onboard/approve, resident submit rating (stub until Phase 4 wires real jobs)
- [ ] E2E test: committee onboards a vendor with a valid test-mode GSTIN → tier auto-flips to `SOCIETY_ATTESTED` → resident sees it in directory → resident rates it (stub) → vendor detail shows aggregate rating

**Definition of done:** vendor directory is real and populated; committee tools work.

---

## Phase 3 — Poll engine (event polls first, no money)

**Goal:** a resident can create an event poll (Diwali dinner, shared cab). Neighbours join. No money flows yet — this is the pure poll mechanic used later by bulk-buy.

- [ ] `polls/` module:
  - Poll entity with `poll_type: ADVISORY | BINDING | EVENT | BULK_BUY_RESIDENT`
  - `weight_mode: UNIFORM | OWNERSHIP_WEIGHTED` (only meaningful for BINDING)
  - `quorum_pct`, `passing_pct`, `closes_at` per poll (defaults: 60% / simple majority)
  - `Vote { poll_id, voter_hash, choice, weight }` — voter hash so aggregate results are readable but individual votes are anonymous outside the audit committee
  - Commitments table (bulk-buy poll variant only)
  - Min-commitments + deadline auto-fire / auto-cancel
  - Poll creator can close early
  - **Guards:** binding polls reject votes from `TENANT`; ownership-weighted votes multiply by `Flat.ownership_share`; a flat with both `OWNER_ABSENTEE` and `TENANT` counts only the owner's vote on binding polls
- [ ] Notification hooks: on join, on fire, on expiry, on close
- [ ] E2E tests:
  - Advisory: resident creates advisory poll → tenant + owner both vote → poll closes → outcome recorded (each vote weight 1)
  - Binding + weighted: committee creates binding poll → tenant vote rejected → owner-occupier + owner-absentee vote → outcome computed with ownership_share weights
  - Event: resident creates event poll → neighbour joins → poll fires → notifications sent

**Definition of done:** the poll engine is reusable and will slot into bulk-buy Flow B without rework.

---

## Phase 4 — Bulk-Buy Flow A + Razorpay + Escrow Ledger

**Goal:** a vendor publishes a minimum-booking offer; residents commit and pay; escrow holds funds in the society sub-account; on completion, treasurer + system co-authorise payout.

This is the biggest phase. Split into 4A–4D internal milestones.

### 4A — Ledger foundation
- [ ] `ledger/` module: `Account`, `LedgerEntry` (append-only), sub-account kinds
- [ ] Unit-of-work helper wrapping Prisma transactions
- [ ] Idempotency-key middleware
- [ ] Nightly reconciliation stub (runs but no real bank data yet)

### 4B — Razorpay sandbox integration
- [ ] `infra/razorpay/`: client wrapper (test-mode keys only)
- [ ] `payments/` module: order create, capture, refund
- [ ] Webhook route with signed-payload verification and idempotency
- [ ] Every payment event → ledger entry

### 4C — Bulk-buy Flow A
- [ ] `bulk-buy/` module: `Offer` entity with `discount_ladder: Json` (e.g. `[{minN: 5, pct: 5}, {minN: 10, pct: 10}]`), `min_commitments` (equal to ladder's lowest `minN`), `deadline`
- [ ] DTO validation: ladder is non-empty, `minN` strictly increasing, `pct` monotonic, no duplicates
- [ ] Vendor create offer → resident opt-in → commitment record; live tier computed from ladder + commitment count
- [ ] Auto-fire on N reached → **applied tier = ladder entry with highest `minN ≤ commitments_count`** → escrow-in for each commitment via Razorpay
- [ ] `Booking → JobCard[]` created on fire; each `JobCard.applied_discount_pct` snapshotted at fire time (later joiners cannot retroactively change price)
- [ ] Per-flat sign-off endpoint
- [ ] Payout authorisation flow: system-auth (rule-check pass) + treasurer manual → single Razorpay refund/payout in sandbox → ledger entries

### 4D — Two-tier flow for large jobs
- [ ] JobCard.tier `SMALL | LARGE`
- [ ] Milestone-based payout for LARGE
- [ ] Defect-liability retention

**Definition of done:** vendor posts offer → residents pay via Razorpay test cards → funds sit in escrow → sign-off → treasurer co-authorises → payout completes → ledger reconciles.

---

## Phase 5 — Bulk-Buy Flow B (resident-initiated polls)

**Goal:** any resident can tag a vendor and open a poll; if the vendor's minimum is met, it fires exactly like Flow A.

- [ ] `bulk-buy/` extension: `Poll` reuses the Phase 3 poll engine, adds `tagged_vendor_id` and `vendor_confirmed_minimum`
- [ ] Vendor confirms/declines a tag request
- [ ] On fire: reuse Flow A's booking/escrow path
- [ ] Weekly-recurring variant of Offer (`recurring: WEEKLY`) for staples

**Definition of done:** a resident with no offer visible to them can pull a bulk-buy into existence by tagging a vendor.

---

## Phase 6 — Vouchers

**Goal:** voucher wallet exists; used as a partial payment method in bulk-buy commitments; issued as promo (and later, in Phase 9, as lending repayment output).

- [ ] `vouchers/` module: wallet, `Voucher` records with expiry
- [ ] Bulk-buy commitment supports partial voucher redemption
- [ ] Endpoints: read wallet, redemption is internal
- [ ] Ledger entries: `commission_sink → voucher_pool` on issue; `voucher_pool → society_bulk_buy` on redemption

**Definition of done:** a resident can pay a bulk-buy commitment partly with vouchers, partly with Razorpay.

---

## Phase 7 — Governance and Disputes (with automated triage)

**Goal:** dispute cases flow through automated triage into committee approval; governance proposals + votes.

- [ ] `governance/` module: `Proposal`, `Vote`
- [ ] `disputes/` module:
  - `Dispute` entity with case type
  - **Automated triage rule engine**: categorises dispute (missed SLA, quality, payment mismatch, no-show), recommends resolution (refund X%, re-do, partial payout), routes to committee
  - Committee accept/override endpoint
  - Ledger entries on resolution (refund from `dispute_hold`, partial payout, etc.)
- [ ] Dispute-hold sub-account movement on dispute open

**Definition of done:** a disputed job goes into a hold, triage runs, committee resolves, funds move correctly.

---

## Phase 8 — Simulation harness *(Python, offline)*

**Goal:** the lending research module produces artefacts the frontend can render. Runs offline via CLI; not part of the request path.

- [ ] `simulation/` Python package with `pyproject.toml`
- [ ] `synthetic/` society generator (90 flats parameterised) — emits ground-truth labels for pool-formation and vendor-recommendation alongside the requests
- [ ] `engine/` discrete-day loop for 3 months
- [ ] `strategies/` for the three repayment paths
- [ ] `analysis/sensitivity.py` + `analysis/monte_carlo.py` — parameter sweeps + N-run averaging
- [ ] `analysis/functional.py` — runs the aggregation engine and recommender over the synthetic requests, computes **precision / recall / F1** for pool-formation and for vendor-recommendation at trust thresholds `{0.3, 0.4, 0.5, 0.6, 0.7}`; results appended under `report.json.functional`
- [ ] `cli.py`: `python -m sim run --scenario baseline` writes `outputs/report.json` (with `functional`, `sensitivity`, `monte_carlo` sections) and PNGs
- [ ] Six shipped scenarios (baseline, low opt-in, high default, all-maintenance, all-voucher, mixed)
- [ ] pytest coverage on engine determinism + strategy invariants + functional-metric monotonicity (recall shouldn't grow when the threshold rises)

**Definition of done:** a run of `python -m sim run --scenario baseline` writes reproducible artefacts to `outputs/`.

---

## Phase 9 — Lending UI backing (reads simulation outputs)

**Goal:** the backend exposes lending views built on simulation outputs. Not a live product; a research surface.

- [ ] `lending/` module:
  - `LoanRequest`, `LoanAgreement`, `RepaymentSchedule`, `MaintenanceAdjustment` entities
  - **Hard rules enforced in code**: owner-only, 2× monthly maintenance cap, 90-day tenor, society-level monthly volume cap
  - Read-endpoints for lending dashboards backed by `simulation/outputs/report.json`
  - Write-endpoints (`request`, `agreement`) accept records to the UI but flag them `simulation_only=true`
- [ ] Explicit non-production banner returned in every lending response payload for the frontend to surface

**Definition of done:** simulated lending UI is fully backed; hard rules can be shown enforcing correctly on synthetic actions.

---

## Phase 10 — Admin, reports, polish

**Goal:** committee + treasurer surfaces are complete; AGM statement generatable; audit views ready.

- [ ] `admin/` endpoints: aggregates only, never individual balances
- [ ] Monthly financial statement generator (society-level)
- [ ] Audit-log query endpoint with filters
- [ ] `GET /audit/verify` endpoint surfaced to committee: recomputes the chain and reports either "chain intact through row N with tail hash …" or "first divergence at row K"
- [ ] Reconciliation dashboard: ledger vs Razorpay daily settlement report

**Definition of done:** everything a committee needs is exposed. Nothing residents shouldn't see is exposed.

---

## Standing tasks (every phase)

- Add e2e test for the phase's happy path.
- Regenerate OpenAPI + shared types after every API change.
- Update `SUPERVISOR.md` as each item completes.
- Keep migrations reversible.
- Every new endpoint has explicit `@Roles(...)` and `@SocietyScope()` where applicable.
