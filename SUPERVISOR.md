# Supervisor Progress Tracker

Single source of truth for **what's shipped, what's in flight, what's blocked**. Both backend and frontend map to the same phase numbers so progress is comparable at a glance.

**How to use this file:**
- Mark items `[x]` as they complete. Do not remove them.
- Add a one-line note under a phase if something is decided differently in flight.
- The **Phase Status** column is the headline the supervisor reads first.
- The **Demo bar** at the top says what a demo shows *right now*, if the project stops today.
- Refresh timestamps at the top of the file on each update.

Last updated: *2026-09-16 (Phase 2 backend complete + e2e-verified: vendor directory, GSTIN-gated tier promotion, ratings aggregate, access requests, KYC stub; Phase 1+2 frontend not started)*
Current active phase: *Phase 2 — Vendor Marketplace (backend 🟢 done & e2e-green; frontend ⚪ not started). Phase 3 backend next.*

---

## Demo bar *(what the project can show today)*

> `docker compose up -d` + `npm run prisma:migrate` + `npm run prisma:seed` + `npm run dev:backend` brings up the NestJS API. Over HTTP you can now sign up a resident, receive an OTP email (Maildev at :1080), verify it for a session cookie, post a job (SEEKING or HIRING), verify a hiring post's company email, browse the society's visible jobs, and — as a committee member — flag/remove a post (which writes a hash-chained audit row). Auth, rate limiting (1 post/resident/month), and the full Phase 1 flow are e2e-tested against real Postgres. A committee can also onboard vendors (with offline GSTIN verification that auto-promotes an Active GSTIN to `SOCIETY_ATTESTED`), residents can browse the society's vendor directory (category/name filters) and rate vendors (running aggregate). Still no frontend — this is all API-level (curl / the e2e suite).

Update this box on the last commit of every phase — it should read like a two-sentence pitch of what a supervisor would see if they opened the app right now.

---

## Legend

- Phase status: 🟢 done · 🟡 in progress · ⚪ not started · 🔴 blocked
- Track: **BE** = backend, **FE** = frontend, **SIM** = Python simulation harness
- Deliverable: the concrete thing that exists at end-of-phase
- DoD: definition of done (verbatim from the plan)

---

## Phase 0 — Foundation 🟡

**Deliverable:** repo runs; DB has a seeded 90-flat society; nothing user-facing.

| Track | Task | Status |
|---|---|---|
| BE | NestJS scaffold + tsconfig + ESLint | 🟢 *(oxlint, not ESLint — see decisions log)* |
| BE | `docker-compose.yml` (Postgres + Maildev) | 🟢 |
| BE | Prisma + initial migration (User, Society [+`audit_tail_hash`], Flat [+`ownership_share`], Occupancy [`OWNER_OCCUPIER | OWNER_ABSENTEE | TENANT` + `delegated_to_user_id`], Role) | 🟢 *(+ AuditLog in the same migration — dev DB volume wiped and migration regenerated clean rather than layered; see decisions log)* |
| BE | `config/` with Zod env validation | 🟢 |
| BE | `common/`: logger, error filter, validation pipe, Clock | 🟢 *(Clock lives in `infra/clock/` per ARCHITECTURE.md §4.1)* |
| BE | `AuditLogInterceptor` writing to append-only `AuditLog` | 🟢 *(wired globally; dormant until a route carries `@AuditLog(...)`, first used in Phase 1; now delegates to `AuditService` — see below)* |
| BE | `AuditLog` write path **hash-chained** (`previous_hash` + `entry_hash = SHA-256(prev || canonicalJson({ts, societyId, actorId, action, subjectType, subjectId, payload}))`); advisory-lock on society-scoped chain; `Society.audit_tail_hash` maintained | 🟢 *(`modules/audit/audit.service.ts`; e2e-proven: chain links genesis→N correctly, 15 concurrent appends to the same society stay non-colliding and verify intact — see decisions log for the hash-scope note)* |
| BE | `audit/verify` internal service (recomputes forward from genesis; reports first divergent row) — endpoint surfaced in Phase 10 | 🟢 *(`AuditService.verifyChain`; e2e test tampers a row via raw SQL and confirms it's caught, including a separate check that the cached `Society.auditTailHash` itself hasn't been tampered independently of the log rows)* |
| BE | Seed updated: 90 flats, 1 committee, 2 owner-occupiers, 1 owner-absentee (with tenant delegation), 2 tenants | 🟢 *(committee member counted as one of the 2 owner-occupiers, consistent with the original seed's convention; delegate tenant holds their own TENANT occupancy on the absentee owner's flat)* |
| BE | `GET /health` returns `{ok, db}` | 🟢 |
| FE | Next.js 16 scaffold, TS strict | ⚪ |
| FE | Tailwind + shadcn/ui primitives | ⚪ |
| FE | Root layout + providers (theme, TanStack Query, toaster) | ⚪ |
| FE | `.env.local.example` | ⚪ |
| FE | Landing page probes backend `/health` | ⚪ |
| FE | Global 404 + error boundary | ⚪ |
| FE | `/dev/ui` playground with primitives | ⚪ |

**DoD:** `pnpm dev` starts both; landing page shows backend health green; `SELECT count(*) FROM "Flat"` returns 90.

**Backend status:** verified directly — `npm run dev:backend` boots, `curl localhost:4000/health` → `{"ok":true,"db":"up"}`, `SELECT count(*) FROM flats` → 90 (table name `flats` per `@@map`). Lint (`oxlint`), build (`nest build`), unit tests (14, incl. canonical-JSON and SHA-256 hash-chain primitives), and e2e tests (5: health + audit-chain-intact + genesis-linkage + concurrent-append-safety + tamper-detection, all against a real Postgres) pass. Frontend not started — `pnpm dev` DoD can't be fully exercised yet.

**Blockers / notes:** none currently blocking. Docker Desktop's engine needs to be running before `docker compose up -d` — noticed once during this phase, resolved by starting Docker Desktop manually.

---

## Phase 1 — Auth + Job Blog *(first usable feature)* 🟡

**Deliverable:** a resident can sign up, log in, post a job, browse jobs; committee can moderate.

| Track | Task | Status |
|---|---|---|
| BE | `auth/` — signup + email OTP + session cookie | 🟢 *(6-digit OTP, 10-min TTL, 60s cooldown; DB-backed opaque session, only SHA-256 hash stored)* |
| BE | `AuthGuard`, `SocietyScopeGuard`, `RolesGuard` | 🟢 |
| BE | `@CurrentUser`, `@Roles`, `@SocietyScope` decorators | 🟢 |
| BE | `users/` — profile read/update | 🟢 *(`GET/PATCH /api/v1/me`)* |
| BE | `job-blog/` — post CRUD, hiring/seeking kinds | 🟢 |
| BE | Company-email verification link + status flip | 🟢 *(hashed token, 24h TTL; HIRING posts hidden until verified)* |
| BE | Rate limiter (1 post / resident / month) | 🟢 *(society-configurable via `Society.config.jobBlogRateLimitPerMonth`)* |
| BE | Committee `flag`/`remove` action | 🟢 *(`@Roles(COMMITTEE)`; writes hash-chained audit row)* |
| BE | Auto-archive after 60 days | 🟢 *(via `expiresAt`; list filters `expiresAt > now`)* |
| BE | `notifications/` — Maildev email dispatch | 🟢 |
| BE | E2E: signup → OTP → post → verify → visible → flag → hidden | 🟢 *(`test/job-blog.e2e-spec.ts`, 4 cases against real Postgres; captures OTP/verify-token via a MailerService override since both are only stored hashed; also asserts wrong-OTP→401, non-committee-flag→403, rate-limit→429. Full suite: 9 e2e green)* |
| FE | `(auth)` group with `/login`, `/signup`, `/verify` | ⚪ |
| FE | Session cookie SSR read | ⚪ |
| FE | `(resident)` group + `AppShell` (topbar, sidebar) | ⚪ |
| FE | `/dashboard` placeholder | ⚪ |
| FE | `/jobs` list + filters | ⚪ |
| FE | `/jobs/[postId]` detail | ⚪ |
| FE | `/jobs/new` form with company-email flow | ⚪ |
| FE | `(committee)/admin/jobs` moderation | ⚪ |
| FE | Toasts + loading skeletons | ⚪ |
| FE | Role-gated redirects in group layouts | ⚪ |
| FE | Playwright happy path | ⚪ |

**DoD:** the demo — signup → OTP → post → verify → visible — works end-to-end in a fresh clone.

**Backend status:** verified directly — full suite green: `npm run build` (nest build) ok, `npm run lint` (oxlint) clean, unit tests 14 pass, e2e 9 pass (Phase 0 health + audit chain, plus the new Phase 1 job-blog happy-path + negative cases) against a real Postgres. All routes mapped under `/api/v1` (`auth/{signup,otp,verify,logout}`, `me`, `jobs` CRUD + `flag`/`remove`/`verify-company-email`). Frontend not started — the fresh-clone browser demo in the DoD can't be exercised until Phase 1 FE lands.

**Blockers / notes:** none. Frontend track (all ⚪) is deferred — building backend-first per phase by decision (2026-09-16), so the full-clone browser DoD is pending the FE pass.

---

## Phase 2 — Vendor Marketplace 🟡

**Deliverable:** committee onboards vendors; residents browse directory; vendor record page with ratings aggregate.

| Track | Task | Status |
|---|---|---|
| BE | `vendors/` — entity + geo + categories + tier state machine + `gstin` / `gstin_verified_at` | 🟢 *(society-scoped Vendor; `VendorCategory` child table; `verification-tier.util.ts` allows only forward single-step transitions)* |
| BE | Access request records + rating table + aggregate | 🟢 *(`VendorAccessRequest`; `VendorRating` + lazy `ratingAvg`/`ratingCount` recomputed in-tx on each rate)* |
| BE | `infra/gstinapi/` client (free tier, retries, timeouts, feature-flagged) | 🟢 *(`GSTIN_API_ENABLED` off by default → deterministic offline stub; when on: 5s timeout + 1 retry, non-throwing)* |
| BE | Vendor onboarding: on approve → GSTIN lookup → auto-promote to `SOCIETY_ATTESTED` if `Active` | 🟢 *(`POST /vendors/:id/approve`; non-fatal, returns vendor + explanatory note)* |
| BE | `kyc/` light — document upload stub | 🟢 *(`KycDocument` metadata-only, `local://` storage ref; clearly marked stub)* |
| BE | Endpoints: list, detail, onboard, approve, rate (stub) | 🟢 *(`GET /vendors` w/ `?category=&q=`, `GET /vendors/:id`, `POST /vendors`, `/approve`, `/rate`, `/access-request`)* |
| BE | E2E: onboard w/ valid test GSTIN → tier flips → list → detail → rate | 🟢 *(`test/vendors.e2e-spec.ts`, 4 cases: GSTIN-active→SOCIETY_ATTESTED, `00…`/no-GSTIN stays UNVERIFIED, cross-society isolation + category filter, two ratings → avg 4.50, non-committee 403. Full suite: 13 e2e green)* |
| FE | `/marketplace` list with filters | ⚪ |
| FE | `/marketplace/[vendorId]` record page | ⚪ |
| FE | `(committee)/admin/vendors` onboarding form (GSTIN field + verified badge) | ⚪ |
| FE | `(vendor)` group login shell | ⚪ |
| FE | Playwright happy path | ⚪ |

**DoD:** committee onboards a vendor; residents see it and rate the vendor.

**Backend status:** verified directly — `npm run build` ok, oxlint clean, 15 unit + 13 e2e green against real Postgres. GSTIN verification runs offline by default (stub), so the suite needs no external key. Frontend not started.

**Decision (2026-09-16):** `Vendor` carries `societyId` (society-scoped directory) though ARCHITECTURE.md's data-model line omits it — matches the committee-onboards-per-society flow and the `currentUser.societyId` scoping used everywhere else in v1. Geo fields (`latitude`/`longitude`/`radiusKm`) are stored for the Phase 8 recommender but not yet used for cross-society matching.

---

## Phase 3 — Event Polls ⚪

**Deliverable:** a resident creates a poll; neighbours join; auto-fires or expires.

| Track | Task | Status |
|---|---|---|
| BE | `polls/` — Poll (with `poll_type: ADVISORY | BINDING | EVENT | BULK_BUY_RESIDENT`, `weight_mode`, `quorum_pct`, `passing_pct`) + Vote + Commitment entities | ⚪ |
| BE | Min-commitments + deadline auto-fire / expire | ⚪ |
| BE | Poll creator close-early | ⚪ |
| BE | Guards: binding polls reject `TENANT`; ownership-weighted votes multiply by `Flat.ownership_share`; flat with `OWNER_ABSENTEE`+`TENANT` counts only owner on binding | ⚪ |
| BE | Notification hooks on join / vote / close / fire / expire | ⚪ |
| BE | E2E: advisory (all vote, tally equal) / binding weighted (tenant rejected, owners tally with share) / event fires | ⚪ |
| FE | `/polls` list | ⚪ |
| FE | `/polls/new` with type picker (event / advisory / binding — binding is committee-only), quorum/passing/weight-mode fields | ⚪ |
| FE | `/polls/[pollId]` detail with join or vote button, weighted-tally readout, eligibility copy for tenants | ⚪ |
| FE | Query polling for near-real-time state | ⚪ |
| FE | Playwright happy paths (advisory + binding + event) | ⚪ |

**DoD:** event polls fire correctly; poll engine is reusable for Phase 5.

---

## Phase 4 — Bulk-Buy Flow A + Razorpay + Ledger ⚪

**Deliverable:** vendor posts an offer; residents pay via Razorpay sandbox; escrow holds funds; treasurer co-authorises payout; ledger balances.

### 4A — Ledger foundation
| Track | Task | Status |
|---|---|---|
| BE | `ledger/` — Account + LedgerEntry (append-only) | ⚪ |
| BE | Unit-of-work helper (Prisma transaction wrapper) | ⚪ |
| BE | Idempotency-key middleware | ⚪ |
| BE | Nightly reconciliation stub | ⚪ |
| FE | `(committee)/admin/treasury` — balances + entries | ⚪ |

### 4B — Razorpay sandbox
| Track | Task | Status |
|---|---|---|
| BE | `infra/razorpay/` client wrapper | ⚪ |
| BE | `payments/` — order create/capture/refund | ⚪ |
| BE | Webhook route with signed-payload verification + idempotency | ⚪ |
| BE | Payment events → ledger entries | ⚪ |
| FE | `components/razorpay/Checkout.tsx` wrapper | ⚪ |
| FE | Fallback UI on Razorpay script failure | ⚪ |

### 4C — Offer flow
| Track | Task | Status |
|---|---|---|
| BE | `bulk-buy/` Offer entity with `discount_ladder JSON` + commit; ladder DTO validation (non-empty, strictly increasing `minN`, monotonic `pct`) | ⚪ |
| BE | Auto-fire on `min_commitments` reached; applied tier = ladder entry with highest `minN ≤ commitments_count` → escrow-in | ⚪ |
| BE | Booking + JobCard[] on fire; `applied_discount_pct` snapshotted at fire | ⚪ |
| BE | Per-flat sign-off endpoint | ⚪ |
| BE | Payout dual-authorisation (system + treasurer) | ⚪ |
| FE | `(vendor)/vendor/offers` list + new (ladder editor: dynamic rows minN → pct, sorted, live step-chart preview) | ⚪ |
| FE | `(resident)/offers` list + detail with **discount-ladder step chart** + current tier + "next tier at N+K" hint; Razorpay Checkout | ⚪ |
| FE | Dashboard "My upcoming services" with applied-tier badge | ⚪ |
| FE | Sign-off dialog with rating capture | ⚪ |
| FE | Treasurer payout authorise page | ⚪ |

### 4D — Large jobs
| Track | Task | Status |
|---|---|---|
| BE | JobCard.tier `SMALL / LARGE` + milestone payouts | ⚪ |
| BE | Defect-liability retention | ⚪ |
| FE | Milestone cards with per-stage authorise | ⚪ |

**DoD (whole phase):** end-to-end demo — offer posted → committed → paid → signed off → payout → reconciled.

---

## Phase 5 — Bulk-Buy Flow B (resident-initiated) ⚪

**Deliverable:** a resident tags a vendor and opens a poll; vendor confirms; poll fires like Flow A.

| Track | Task | Status |
|---|---|---|
| BE | Poll gains `tagged_vendor_id` + `vendor_confirmed_minimum` | ⚪ |
| BE | Vendor confirm/decline tag request endpoint | ⚪ |
| BE | On fire: reuse Flow A booking/escrow path | ⚪ |
| BE | Weekly-recurring Offer variant for staples | ⚪ |
| FE | `/polls/new` gains `type=bulk_buy` with vendor picker | ⚪ |
| FE | Vendor inbox for incoming tags | ⚪ |
| FE | Weekly-recurring entry point on vendor record | ⚪ |

**DoD:** residents can pull a bulk-buy into existence by tagging a vendor.

---

## Phase 6 — Vouchers ⚪

**Deliverable:** wallet visible; vouchers usable as partial payment in bulk-buy.

| Track | Task | Status |
|---|---|---|
| BE | `vouchers/` — wallet + Voucher records + expiry | ⚪ |
| BE | Commitment supports partial voucher redemption | ⚪ |
| BE | Ledger entries: issue + redemption | ⚪ |
| FE | `/wallet` — balance, transactions, expiring | ⚪ |
| FE | Commitment flow "Apply vouchers" step | ⚪ |

**DoD:** split-tender (vouchers + Razorpay) works cleanly.

---

## Phase 7 — Governance and Disputes (automated triage) ⚪

**Deliverable:** disputes open, triage runs, committee resolves; governance proposals and votes.

| Track | Task | Status |
|---|---|---|
| BE | `governance/` — Proposal + Vote | ⚪ |
| BE | `disputes/` — Dispute + case types | ⚪ |
| BE | Automated triage rule engine (categorise + recommend) | ⚪ |
| BE | Committee accept/override endpoint | ⚪ |
| BE | Dispute-hold sub-account movement | ⚪ |
| BE | Ledger entries on resolution | ⚪ |
| FE | Per-job "Report an issue" intake | ⚪ |
| FE | `(committee)/admin/disputes` queue with triage recs | ⚪ |
| FE | Governance proposals + society-wide vote pages | ⚪ |

**DoD:** disputed job flow from open → triage → decision → funds movement is smooth.

---

## Phase 8 — Simulation harness ⚪

**Deliverable:** Python CLI produces `simulation/outputs/report.json` and PNGs for 6 shipped scenarios.

| Track | Task | Status |
|---|---|---|
| SIM | `simulation/` Python package (pyproject.toml) | ⚪ |
| SIM | Synthetic society generator (90 flats, parameterised); **emits ground-truth labels** for pool-formation + optimal-vendor-recommendation | ⚪ |
| SIM | Discrete-day engine (3 months default) | ⚪ |
| SIM | Three repayment strategies | ⚪ |
| SIM | `analysis/sensitivity.py` + `analysis/monte_carlo.py` | ⚪ |
| SIM | `analysis/functional.py` — pool-formation precision/recall/F1 + vendor-recommendation P/R/F1 across trust thresholds `{0.3–0.7}`; appends to `report.json.functional` | ⚪ |
| SIM | CLI `python -m sim run --scenario X` | ⚪ |
| SIM | 6 scenarios ship: baseline / low-optin / high-default / all-maint / all-voucher / mixed | ⚪ |
| SIM | pytest: engine determinism + strategy invariants + functional-metric monotonicity | ⚪ |

**DoD:** `python -m sim run --scenario baseline` produces reproducible artefacts.

---

## Phase 9 — Lending UI (owner-only, simulation-labelled) ⚪

**Deliverable:** the lending product surface — clearly labelled simulation-only — read-backs the harness outputs.

| Track | Task | Status |
|---|---|---|
| BE | `lending/` — LoanRequest, LoanAgreement, RepaymentSchedule, MaintenanceAdjustment | ⚪ |
| BE | Hard rules enforced in code (owner-only, 2× cap, 90-day tenor, society volume cap) | ⚪ |
| BE | Read-endpoints backed by `simulation/outputs/report.json` | ⚪ |
| BE | Write-endpoints flagged `simulation_only=true` in payload | ⚪ |
| FE | `/lending` gated to OWNER; tenant fallback panel | ⚪ |
| FE | Non-dismissible SIMULATION banner on every lending route | ⚪ |
| FE | Borrower request flow with mode picker | ⚪ |
| FE | Lender view (pledges, active, projected returns) | ⚪ |
| FE | Maintenance-adjustment 6-month preview | ⚪ |
| FE | Committee lending view — aggregates only | ⚪ |

**DoD:** a simulated loan walkthrough reads naturally and the simulation banner is impossible to miss.

---

## Phase 8b — Simulation dashboard *(frontend)* ⚪

*Ordered here because it depends on Phase 8's outputs; can be built in parallel with Phase 9.*

**Deliverable:** `/simulation` dashboard renders sensitivity + scenario reports.

| Track | Task | Status |
|---|---|---|
| BE | Read-endpoint that serves the JSON/CSV outputs safely | ⚪ |
| FE | `/simulation` scenario picker | ⚪ |
| FE | Charts: pool health, default sensitivity heatmap, repayment comparison | ⚪ |
| FE | **Functional-accuracy panel** on `/simulation/report`: pool-formation P/R/F1 table + vendor-recommendation P/R/F1 threshold curve | ⚪ |
| FE | `/simulation/report` embed-friendly view | ⚪ |
| FE | Reproducibility panel (seed, params, run timestamp) | ⚪ |

**DoD:** every chart the dissertation cites renders from real Python output.

---

## Phase 10 — Reports, admin polish, accessibility ⚪

**Deliverable:** viva-ready polish.

| Track | Task | Status |
|---|---|---|
| BE | Monthly financial statement generator | ⚪ |
| BE | Audit-log query endpoint with filters | ⚪ |
| BE | `GET /audit/verify` endpoint (backed by Phase 0 hash-chain infra): reports "intact" or first divergent row | ⚪ |
| BE | Reconciliation dashboard endpoints | ⚪ |
| FE | `(committee)/admin/reports` financial statement page | ⚪ |
| FE | `(committee)/admin/audit` filterable log | ⚪ |
| FE | `(committee)/admin/audit/verify` — displays tail hash + "Verify chain" button; green intact / red divergence readout | ⚪ |
| FE | Empty states everywhere | ⚪ |
| FE | Loading skeletons everywhere | ⚪ |
| FE | Accessibility pass (keyboard, ARIA, contrast) | ⚪ |
| FE | 375px phone-width responsive pass | ⚪ |
| FE | Dark mode audit | ⚪ |

**DoD:** the app looks and behaves like a production product.

---

## Cross-cutting standing tasks

Kept visible so they don't get lost between phases.

- [ ] Regenerate OpenAPI + typed client after any backend contract change
- [ ] Update `Demo bar` at the top on last commit of every phase
- [ ] Update `Last updated` timestamp on every edit to this file
- [ ] Migrations kept reversible
- [ ] Every new endpoint has `@Roles(...)` and `@SocietyScope()` where applicable
- [ ] Every new page has a proper `<title>` and back-link
- [ ] Copy written like a real product; no lorem ipsum

---

## Log of decisions changed in flight

Use this to keep the supervisor honest when reality forces a decision to change from the plan.

- **2026-09-16 — Build order: backend-first per phase (frontend deferred).** Each phase's backend is completed and e2e-verified against real Postgres, committed to `master` when green, then the next phase's backend starts. The frontend track (all ⚪) is built in a later dedicated pass. Rationale: the end-to-end verification loop is tightest at the API layer, and the backend was already mid-Phase-1; this gets a fully-working, tested API across phases fastest. Consequence: the "fresh clone → browser demo" wording in each phase DoD is only fully satisfiable once the FE pass lands — backend DoD is proven by the phase's e2e suite in the meantime.
- **2026-09-16 — Plan extension after reading an alternate design set ("CommunityFinance" trio, external).** Cross-checked the alternate design against our plan; imported six additions without changing scope or phase order: (1) explicit **novelty framing** with four claims (trust-graph substrate, escrow-through-society-account, maintenance-adjustment repayment [ours, unique], hash-chained audit) — see [DESIGN.md](DESIGN.md) §1a; (2) **hash-chained AuditLog** (SHA-256 previous-hash chain, tail-hash cached on Society, `GET /audit/verify` endpoint); (3) **OWNER_ABSENTEE** role variant on Occupancy with tenant delegation; (4) **advisory / binding poll types + ownership-weighted voting** (extends Phase 3 without adding a new phase); (5) **vendor discount ladder** on Offer + GSTIN sandbox verification via `gstinapi.in` free tier; (6) **functional-accuracy evaluation** (pool-formation + vendor-recommendation P/R/F1) in the Python sim. Deferred (kept in Future Plans): job referral engine + LinkedIn OAuth + coupon cash-out + inclusion layer + family-member sub-accounts.
- **Package manager: npm workspaces, not pnpm.** ARCHITECTURE.md allowed either explicitly. pnpm wasn't installed; npm 11 already was. Root `package.json` declares `workspaces: ["backend", "shared"]`; `frontend` gets added when that workspace is scaffolded.
- **Session model: DB-backed `Session` table, not stateless JWT.** ARCHITECTURE.md said "JWT in httpOnly cookie" without settling revocability. Chosen so logout / force-revoke is possible for committee/treasurer accounts. Not yet implemented — lands with Phase 1 auth.
- **Lint/test tooling: oxlint + vitest, not ESLint + Jest.** The Nest CLI's current default scaffold (`@nestjs/cli` v12) ships oxlint and vitest, not the ESLint/Jest combo ARCHITECTURE.md assumed. Kept the modern defaults — same intent (lint + test), faster, less config. Revisit if a dependency needs a Jest-only feature.
- **Prisma pinned to 7.10.0 stable, not the `latest` dist-tag.** `npm view prisma dist-tags` currently resolves `latest` to `8.0.0-rc.15` — a pre-release. Installed `7.10.0` (the `prev` tag, last stable major-7 release) instead. Also cut audited vulnerabilities from 18 to 9 (the RC's dev-tooling chain pulls in a vulnerable `hono`/`@hono/node-server`, used only by Prisma's own dev CLI, not our runtime).
- **Prisma 7 requires an explicit driver adapter.** No bundled query-engine binary anymore — `PrismaService` constructs the client with `@prisma/adapter-pg` (`pg` under the hood) rather than a bare `DATABASE_URL` on the datasource block. Functionally equivalent, just a newer wiring pattern.
- **`GET /health` excluded from the `/api/v1` global prefix.** ARCHITECTURE.md §4.4 locks a global `/api/v1` prefix but also lists `GET /health` bare, and the Phase 0 DoD literally says `curl /health`. Resolved by excluding `health` from `setGlobalPrefix` — standard practice so infra probes don't need the versioned path. Every other route sits under `/api/v1`.
- **Backend `package.json` uses `"type": "module"` (true ESM).** This is what the current Nest CLI scaffolds by default (NodeNext module resolution, `.js` extensions on relative imports even in `.ts` source). Not a deliberate choice against CommonJS — just noting it because it affects how every future file in `backend/src` must be written.
- **Dev Postgres volume wiped and the migration regenerated clean, rather than adding a second migration on top.** The `OccupancyRole` enum change (`OWNER`/`TENANT` → `OWNER_OCCUPIER`/`OWNER_ABSENTEE`/`TENANT`) isn't a safe in-place cast — old `OWNER` rows have no target value in the new enum. The only data in the dev DB was our own synthetic seed (fully reproducible via `npm run prisma:seed`), the migration had never left localhost, and SUPERVISOR.md itself still had this line marked 🟡. Ran `docker compose down -v` + `docker compose up -d`, deleted `prisma/migrations/`, and regenerated one clean `init` migration reflecting the finished Phase 0 schema. Chose this over an honest two-migration history because the first migration modeled a schema that was, by the plan's own admission, incomplete — carrying it forward would document a wrong intermediate state for no benefit. Would not do this again once real (even synthetic-but-referenced) data or a second developer depends on the migration history.
- **Hash-chain content is the full logical row, not literally just the `payload` column.** ARCHITECTURE.md's shorthand is `entryHash = SHA-256(previousHash || canonicalJson(payload))`. Implemented as `SHA-256(previousHash || canonicalJson({ts, societyId, actorId, action, subjectType, subjectId, payload}))` instead — hashing only the `payload` field would leave `action`/`subjectType`/`subjectId`/`actorId` unprotected, which defeats the point of the novelty claim ("any modification to any past row breaks the chain"). `ts` is included as an ISO string precisely because it's part of what "the row" means.
- **`AuditLogInterceptor` resolves `societyId` from the route's `:sid` param, falling back to `request.user.societyId`.** Neither exists yet in Phase 0 (interceptor is dormant — no route carries `@AuditLog(...)` yet), but this is the contract Phase 1's `AuthGuard`/session must satisfy: the authenticated user object needs a `societyId` for routes that don't carry `:sid` in the URL. If neither is resolvable, the write is skipped and logged rather than guessed — assumes one user has exactly one active society membership in v1 (consistent with PRODUCT_PLAN.md's "no family-member sub-accounts" simplicity scope).
- **Signup creates the Occupancy directly — no committee-approval step in v1.** ARCHITECTURE.md's route list shows `POST /societies/:sid/occupancies` as committee-only, which would otherwise leave a fresh signup with no society membership (blocking every society-scoped route, job-blog included). User confirmed: signup collects `{name, email, phone?, societyId, flatId, role}` and creates the `Occupancy` on OTP verification, self-attested, no approval gate — matching the "no KYC yet, placeholder identities" scope already set in the Phase 0 seed. The committee endpoint stays available for reassignment/correction. `OWNER_ABSENTEE` delegation itself (setting `delegatedToUserId`) is **not** a signup-time field or a Phase 1 endpoint — BACKEND_PLAN.md's Phase 1 checklist doesn't list one; only the seed sets it directly for now.
- **OTP: 6-digit code, 10-minute expiry, 60-second resend cooldown.** User's explicit call for Phase 1 auth — standard parameters, no further discussion needed.

---

## Log of blockers

Anything that stops a phase from progressing. Resolved blockers stay in the log with a resolution note.

- *(none yet)*

---

## Risk register *(revisited at every phase boundary)*

Live risks from [CRITIQUE.md](CRITIQUE.md) that we watch across the build:

| Risk | Current mitigation | Status |
|---|---|---|
| NBFC-P2P regulation triggers | Simulation only in v1; live pathway documented; internal-welfare framing referenced but not relied on | 🟢 mitigated by scope |
| Payment Aggregator licensing | Razorpay sandbox in v1; society-account escrow model (novelty claim §1a.3 documents why no PA licence is needed) | 🟢 mitigated by scope |
| DPDP Act consent architecture | Consent ledger designed in from foundation | 🟡 verify each phase adds proper consent events |
| Committee-fraud vector | Two-person authorisation + hash-chained audit log (§1a.4) with committee-facing `/audit/verify` in Phase 10 | 🟡 verify implementation in Phase 4 and again in Phase 10 |
| Audit-log tamper-evidence | SHA-256 previous-hash chain over every state change; Society-scoped advisory lock on append; tail hash cached | 🟡 verify chain intact after each phase's e2e run |
| Job-blog impersonation | Real resident attribution + company-email verify + rate limit | 🟡 verify in Phase 1 |
| Vendor circumvention | Anti-circumvention clause + platform-mediated warranty + rating penalty | 🟡 verify in Phase 4 |
| Vendor identity fraud | GSTIN verification at onboarding via `gstinapi.in` free tier — an "Active" response auto-promotes to `SOCIETY_ATTESTED` | 🟡 verify in Phase 2 |
