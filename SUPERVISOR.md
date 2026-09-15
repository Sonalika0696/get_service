# Supervisor Progress Tracker

Single source of truth for **what's shipped, what's in flight, what's blocked**. Both backend and frontend map to the same phase numbers so progress is comparable at a glance.

**How to use this file:**
- Mark items `[x]` as they complete. Do not remove them.
- Add a one-line note under a phase if something is decided differently in flight.
- The **Phase Status** column is the headline the supervisor reads first.
- The **Demo bar** at the top says what a demo shows *right now*, if the project stops today.
- Refresh timestamps at the top of the file on each update.

Last updated: *2026-09-16*
Current active phase: *Phase 0 — Foundation (backend done, frontend not started)*

---

## Demo bar *(what the project can show today)*

> `docker compose up -d` + `npm run prisma:migrate` + `npm run prisma:seed` + `npm run dev:backend` brings up a NestJS API with a working `/health` check and a seeded 90-flat test society in Postgres. Nothing user-facing yet — no frontend.

Update this box on the last commit of every phase — it should read like a two-sentence pitch of what a supervisor would see if they opened the app right now.

---

## Legend

- Phase status: 🟢 done · 🟡 in progress · ⚪ not started · 🔴 blocked
- Track: **BE** = backend, **FE** = frontend, **SIM** = Python simulation harness
- Deliverable: the concrete thing that exists at end-of-phase
- DoD: definition of done (verbatim from the plan)

---

## Phase 0 — Foundation ⚪

**Deliverable:** repo runs; DB has a seeded 90-flat society; nothing user-facing.

| Track | Task | Status |
|---|---|---|
| BE | NestJS scaffold + tsconfig + ESLint | 🟢 *(oxlint, not ESLint — see decisions log)* |
| BE | `docker-compose.yml` (Postgres + Maildev) | 🟢 |
| BE | Prisma + initial migration (User, Society, Flat, Occupancy, Role) | 🟢 *(+ AuditLog in the same migration)* |
| BE | `config/` with Zod env validation | 🟢 |
| BE | `common/`: logger, error filter, validation pipe, Clock | 🟢 *(Clock lives in `infra/clock/` per ARCHITECTURE.md §4.1)* |
| BE | `AuditLogInterceptor` writing to append-only `AuditLog` | 🟢 *(wired globally; dormant until a route carries `@AuditLog(...)`, first used in Phase 1)* |
| BE | `GET /health` returns `{ok, db}` | 🟢 |
| BE | Seed: 1 society, 90 flats, 1 committee, 3 owners, 2 tenants | 🟢 |
| FE | Next.js 16 scaffold, TS strict | ⚪ |
| FE | Tailwind + shadcn/ui primitives | ⚪ |
| FE | Root layout + providers (theme, TanStack Query, toaster) | ⚪ |
| FE | `.env.local.example` | ⚪ |
| FE | Landing page probes backend `/health` | ⚪ |
| FE | Global 404 + error boundary | ⚪ |
| FE | `/dev/ui` playground with primitives | ⚪ |

**DoD:** `pnpm dev` starts both; landing page shows backend health green; `SELECT count(*) FROM "Flat"` returns 90.

**Backend status:** verified directly — `npm run dev:backend` boots, `curl localhost:4000/health` → `{"ok":true,"db":"up"}`, `SELECT count(*) FROM flats` → 90 (table name `flats` per `@@map`). Lint (`oxlint`), build (`nest build`), unit tests, and e2e test (hits `/health` through a real Prisma connection) all pass. Frontend not started — `pnpm dev` DoD can't be fully exercised yet.

**Blockers / notes:** none currently blocking. Docker Desktop's engine needs to be running before `docker compose up -d` — noticed once during this phase, resolved by starting Docker Desktop manually.

---

## Phase 1 — Auth + Job Blog *(first usable feature)* ⚪

**Deliverable:** a resident can sign up, log in, post a job, browse jobs; committee can moderate.

| Track | Task | Status |
|---|---|---|
| BE | `auth/` — signup + email OTP + session cookie | ⚪ |
| BE | `AuthGuard`, `SocietyScopeGuard`, `RolesGuard` | ⚪ |
| BE | `@CurrentUser`, `@Roles`, `@SocietyScope` decorators | ⚪ |
| BE | `users/` — profile read/update | ⚪ |
| BE | `job-blog/` — post CRUD, hiring/seeking kinds | ⚪ |
| BE | Company-email verification link + status flip | ⚪ |
| BE | Rate limiter (1 post / resident / month) | ⚪ |
| BE | Committee `flag`/`remove` action | ⚪ |
| BE | Auto-archive after 60 days | ⚪ |
| BE | `notifications/` — Maildev email dispatch | ⚪ |
| BE | E2E: signup → OTP → post → verify → visible → flag → hidden | ⚪ |
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

**Blockers / notes:** *(fill as they arise)*

---

## Phase 2 — Vendor Marketplace ⚪

**Deliverable:** committee onboards vendors; residents browse directory; vendor record page with ratings aggregate.

| Track | Task | Status |
|---|---|---|
| BE | `vendors/` — entity + geo + categories + tier state machine | ⚪ |
| BE | Access request records + rating table + aggregate | ⚪ |
| BE | `kyc/` light — document upload stub | ⚪ |
| BE | Endpoints: list, detail, onboard, approve, rate (stub) | ⚪ |
| BE | E2E: onboard → list → detail → rate | ⚪ |
| FE | `/marketplace` list with filters | ⚪ |
| FE | `/marketplace/[vendorId]` record page | ⚪ |
| FE | `(committee)/admin/vendors` onboarding form | ⚪ |
| FE | `(vendor)` group login shell | ⚪ |
| FE | Playwright happy path | ⚪ |

**DoD:** committee onboards a vendor; residents see it and rate the vendor.

---

## Phase 3 — Event Polls ⚪

**Deliverable:** a resident creates a poll; neighbours join; auto-fires or expires.

| Track | Task | Status |
|---|---|---|
| BE | `polls/` — Poll + Commitment entities | ⚪ |
| BE | Min-commitments + deadline auto-fire / expire | ⚪ |
| BE | Poll creator close-early | ⚪ |
| BE | Notification hooks on join / fire / expire | ⚪ |
| BE | E2E: create → join → fire → notify | ⚪ |
| FE | `/polls` list | ⚪ |
| FE | `/polls/new` (event only for now) | ⚪ |
| FE | `/polls/[pollId]` detail with join & state | ⚪ |
| FE | Query polling for near-real-time state | ⚪ |
| FE | Playwright happy path | ⚪ |

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
| BE | `bulk-buy/` Offer entity + commit | ⚪ |
| BE | Auto-fire on N reached → escrow-in | ⚪ |
| BE | Booking + JobCard[] on fire | ⚪ |
| BE | Per-flat sign-off endpoint | ⚪ |
| BE | Payout dual-authorisation (system + treasurer) | ⚪ |
| FE | `(vendor)/vendor/offers` list + new | ⚪ |
| FE | `(resident)/offers` list + detail with Razorpay Checkout | ⚪ |
| FE | Dashboard "My upcoming services" | ⚪ |
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
| SIM | Synthetic society generator (90 flats, parameterised) | ⚪ |
| SIM | Discrete-day engine (3 months default) | ⚪ |
| SIM | Three repayment strategies | ⚪ |
| SIM | Sensitivity + Monte Carlo | ⚪ |
| SIM | CLI `python -m sim run --scenario X` | ⚪ |
| SIM | 6 scenarios ship: baseline / low-optin / high-default / all-maint / all-voucher / mixed | ⚪ |
| SIM | pytest for engine determinism + strategy invariants | ⚪ |

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
| BE | Reconciliation dashboard endpoints | ⚪ |
| FE | `(committee)/admin/reports` financial statement page | ⚪ |
| FE | `(committee)/admin/audit` filterable log | ⚪ |
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

- **Package manager: npm workspaces, not pnpm.** ARCHITECTURE.md allowed either explicitly. pnpm wasn't installed; npm 11 already was. Root `package.json` declares `workspaces: ["backend", "shared"]`; `frontend` gets added when that workspace is scaffolded.
- **Session model: DB-backed `Session` table, not stateless JWT.** ARCHITECTURE.md said "JWT in httpOnly cookie" without settling revocability. Chosen so logout / force-revoke is possible for committee/treasurer accounts. Not yet implemented — lands with Phase 1 auth.
- **Lint/test tooling: oxlint + vitest, not ESLint + Jest.** The Nest CLI's current default scaffold (`@nestjs/cli` v12) ships oxlint and vitest, not the ESLint/Jest combo ARCHITECTURE.md assumed. Kept the modern defaults — same intent (lint + test), faster, less config. Revisit if a dependency needs a Jest-only feature.
- **Prisma pinned to 7.10.0 stable, not the `latest` dist-tag.** `npm view prisma dist-tags` currently resolves `latest` to `8.0.0-rc.15` — a pre-release. Installed `7.10.0` (the `prev` tag, last stable major-7 release) instead. Also cut audited vulnerabilities from 18 to 9 (the RC's dev-tooling chain pulls in a vulnerable `hono`/`@hono/node-server`, used only by Prisma's own dev CLI, not our runtime).
- **Prisma 7 requires an explicit driver adapter.** No bundled query-engine binary anymore — `PrismaService` constructs the client with `@prisma/adapter-pg` (`pg` under the hood) rather than a bare `DATABASE_URL` on the datasource block. Functionally equivalent, just a newer wiring pattern.
- **`GET /health` excluded from the `/api/v1` global prefix.** ARCHITECTURE.md §4.4 locks a global `/api/v1` prefix but also lists `GET /health` bare, and the Phase 0 DoD literally says `curl /health`. Resolved by excluding `health` from `setGlobalPrefix` — standard practice so infra probes don't need the versioned path. Every other route sits under `/api/v1`.
- **Backend `package.json` uses `"type": "module"` (true ESM).** This is what the current Nest CLI scaffolds by default (NodeNext module resolution, `.js` extensions on relative imports even in `.ts` source). Not a deliberate choice against CommonJS — just noting it because it affects how every future file in `backend/src` must be written.

---

## Log of blockers

Anything that stops a phase from progressing. Resolved blockers stay in the log with a resolution note.

- *(none yet)*

---

## Risk register *(revisited at every phase boundary)*

Live risks from [CRITIQUE.md](CRITIQUE.md) that we watch across the build:

| Risk | Current mitigation | Status |
|---|---|---|
| NBFC-P2P regulation triggers | Simulation only in v1; live pathway documented | 🟢 mitigated by scope |
| Payment Aggregator licensing | Razorpay sandbox in v1; society-account escrow model | 🟢 mitigated by scope |
| DPDP Act consent architecture | Consent ledger designed in from foundation | 🟡 verify each phase adds proper consent events |
| Committee-fraud vector | Two-person authorisation + immutable audit log | 🟡 verify implementation in Phase 4 |
| Job-blog impersonation | Real resident attribution + company-email verify + rate limit | 🟡 verify in Phase 1 |
| Vendor circumvention | Anti-circumvention clause + platform-mediated warranty + rating penalty | 🟡 verify in Phase 4 |
