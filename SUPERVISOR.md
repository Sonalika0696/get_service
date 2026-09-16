# Supervisor Progress Tracker

Single source of truth for **what's shipped, what's in flight, what's blocked**. Both backend and frontend map to the same phase numbers so progress is comparable at a glance.

**How to use this file:**
- Mark items `[x]` as they complete. Do not remove them.
- Add a one-line note under a phase if something is decided differently in flight.
- The **Phase Status** column is the headline the supervisor reads first.
- The **Demo bar** at the top says what a demo shows *right now*, if the project stops today.
- Refresh timestamps at the top of the file on each update.

Last updated: *2026-09-16 (Phase 5 COMPLETE (backend): Bulk-Buy Flow B — resident tags a vendor → poll → vendor confirms → fires down the shared Flow A escrow/payout path; weekly-recurring offers. Supervisor caught+fixed a concurrent double-fire race (advisory lock 53). Frontend still not started)*
Current active phase: *Phases 0–5 🟢 backend done & e2e-green (75 unit + 39 e2e). Next: Phase 6 (Vouchers) backend, or begin the frontend track. Frontend ⚪ not started.*

---

## Demo bar *(what the project can show today)*

> `docker compose up -d` + `npm run prisma:migrate` + `npm run prisma:seed` + `npm run dev:backend` brings up the NestJS API. Over HTTP you can now sign up a resident, receive an OTP email (Maildev at :1080), verify it for a session cookie, post a job (SEEKING or HIRING), verify a hiring post's company email, browse the society's visible jobs, and — as a committee member — flag/remove a post (which writes a hash-chained audit row). Auth, rate limiting (1 post/resident/month), and the full Phase 1 flow are e2e-tested against real Postgres. A committee can also onboard vendors (with offline GSTIN verification that auto-promotes an Active GSTIN to `SOCIETY_ATTESTED`), residents can browse the society's vendor directory (category/name filters) and rate vendors (running aggregate). Residents can also run polls — advisory/event polls open to all, binding polls committee-created with ownership-weighted voting and tenant-eligibility rules; event polls auto-fire when their minimum commitments are met and notify joiners. The full **bulk-buy Flow A** works end-to-end on the Razorpay sandbox stub: a committee posts a vendor offer with a discount ladder, residents commit, the offer auto-fires at its minimum (snapshotting the applied tier), each resident pays into a hash-verified escrow ledger, residents sign off their job cards, and a treasurer co-authorises a payout that splits platform commission from the vendor's net and reconciles escrow back to zero — all money tracked in an append-only double-entry ledger with a conservation invariant. Flow B also works: a resident can tag a vendor and open a bulk-buy poll, the committee confirms the vendor's terms, and once enough neighbours join it fires down the very same escrow/booking/payout path as Flow A. Still no frontend — this is all API-level (curl / the e2e suite).

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

## Phase 3 — Event Polls 🟡

**Deliverable:** a resident creates a poll; neighbours join; auto-fires or expires.

| Track | Task | Status |
|---|---|---|
| BE | `polls/` — Poll (with `poll_type: ADVISORY | BINDING | EVENT | BULK_BUY_RESIDENT`, `weight_mode`, `quorum_pct`, `passing_pct`) + Vote + Commitment entities | 🟢 *(`Poll`/`Vote`/`PollCommitment`; anonymous `Vote.voterHash = sha256(pollId:userId)`, unique per poll to block double-vote)* |
| BE | Min-commitments + deadline auto-fire / expire | 🟢 *(fire synchronously in the join tx when minCommitments reached; expiry via `processExpired()` — no cron dep added; driven by `POST /polls/process-expired`)* |
| BE | Poll creator close-early | 🟢 *(creator-only; ADVISORY/BINDING resolve by tally, EVENT/BULK_BUY → CLOSED)* |
| BE | Guards: binding polls reject `TENANT`; ownership-weighted votes multiply by `Flat.ownership_share`; flat with `OWNER_ABSENTEE`+`TENANT` counts only owner on binding | 🟢 *(pure `poll-tally.util.ts` + service eligibility; tenant→403 on binding; weight = `ownershipShare` under OWNERSHIP_WEIGHTED)* |
| BE | Notification hooks on join / vote / close / fire / expire | 🟢 *(`sendPollFired`/`sendPollExpired` to committed residents on fire/expire; see quality note below)* |
| BE | E2E: advisory (all vote, tally equal) / binding weighted (tenant rejected, owners tally with share) / event fires | 🟢 *(`test/polls.e2e-spec.ts`, 6 cases + `poll-tally.util.spec.ts` 10 cases. Full suite: 24 unit + 19 e2e green)* |
| FE | `/polls` list | ⚪ |
| FE | `/polls/new` with type picker (event / advisory / binding — binding is committee-only), quorum/passing/weight-mode fields | ⚪ |
| FE | `/polls/[pollId]` detail with join or vote button, weighted-tally readout, eligibility copy for tenants | ⚪ |
| FE | Query polling for near-real-time state | ⚪ |
| FE | Playwright happy paths (advisory + binding + event) | ⚪ |

**DoD:** event polls fire correctly; poll engine is reusable for Phase 5.

**Backend status:** verified directly — build ok, oxlint clean, 24 unit + 19 e2e green against real Postgres. Poll engine is intentionally general (eligibility/weight/tally centralised) so Phase 5 extends `BULK_BUY_RESIDENT` rather than forking it.

**Decisions (2026-09-16):**
- No `@nestjs/schedule` dependency added. Auto-fire is synchronous inside the join transaction (deterministic, e2e-testable); expiry is a callable `processExpired()` exposed as `POST /polls/process-expired` (committee-only) as a stand-in for a future scheduler. GET routes never mutate status.
- `BULK_BUY_RESIDENT` voting eligibility isn't yet specified by the domain — defaulted to uniform/any-resident (like EVENT); Phase 5 can override.
- Each e2e scenario builds its own society, because ADVISORY/BINDING quorum denominators are society-wide (a shared society would let one test's residents inflate another's quorum).

**Quality follow-up (non-blocking):** `notifyCommitted` awaits Maildev sends *inside* the fire/expiry DB transaction, so a mail failure would roll back the state change. Best-effort and instant under the test mailer; revisit (move notifications after commit) when notifications become a hard dependency.

---

## Phase 4 — Bulk-Buy Flow A + Razorpay + Ledger 🟢 *(backend; FE pending)*

**Deliverable:** vendor posts an offer; residents pay via Razorpay sandbox; escrow holds funds; treasurer co-authorises payout; ledger balances.

**4A status (2026-09-16):** verified directly — build ok, oxlint clean, 35 unit + 25 e2e green against real Postgres. Money-conservation invariant proven in unit tests; idempotent posting proven over HTTP. Reviewed and approved.

**4B status (2026-09-16):** verified directly — build ok, oxlint clean, 47 unit + 28 e2e green. Razorpay built stub-first behind `RAZORPAY_ENABLED` (off by default) so the escrow flow is fully offline-testable; real HMAC signature verification even in stub mode. **Supervisor review caught a money bug** the green suite missed: `applyCapture` handled `payment.captured` and `order.paid` identically with no Payment-level dedupe, so the captured+order.paid pair (distinct event ids → not caught by event-id idempotency) would credit escrow twice. Fixed with a Payment-status guard on both capture and refund; a new e2e posts a second distinct capture-type event and asserts the ledger entry count stays 1.

**4C status (2026-09-16):** verified directly — build ok, oxlint clean, **64 unit + 30 e2e green**. Full Flow A e2e proves the DoD chain end-to-end (offer → 2 commits fire it → signed webhooks fund escrow → sign-offs complete the booking → treasurer authorises → payout splits commission+vendorNet and drains escrow to 0 → balancesIntact). **Constraint honoured:** everything runs on the Razorpay stub — no real API transactions (which incur charges); the vendor payout is a hard-stubbed method never gated on the flag. **Supervisor review caught a second money bug:** concurrent `authorisePayout` calls on the same booking could double-pay (both pass the PAID-guard from a pre-lock snapshot). Fixed with a per-booking `pg_advisory_xact_lock`; the subagent added a real-concurrency e2e (two overlapping authorise requests → vendor paid exactly once) and negative-controlled it (removing the lock makes the test fail). **Paused here for supervisor review before 4D (large-job milestones/defect retention).**

### 4A — Ledger foundation
| Track | Task | Status |
|---|---|---|
| BE | `ledger/` — Account + LedgerEntry (append-only) | 🟢 *(transfer-style double entry per ARCHITECTURE: `LedgerEntry(debit, credit, amount, reasonCode, linkedEntity)`; `Account` unique per `[societyId, kind]`, cached balance; `AccountKind` incl. `EXTERNAL` PSP boundary)* |
| BE | Unit-of-work helper (Prisma transaction wrapper) | 🟢 *(`LedgerService.post(input, tx?)` — enlists in a caller's `$transaction` or opens its own; writes the append-only entry + both cached balances atomically. This is the signature 4B/4C reuse.)* |
| BE | Idempotency-key middleware | 🟢 *(`IdempotencyService.runOnce(scope, key, societyId, fn)`: `scope:key` advisory lock + check→run→record in one tx, so a replay never double-posts; used by `POST /ledger/adjustments` via `Idempotency-Key` header)* |
| BE | Nightly reconciliation stub | 🟢 *(`ReconciliationService.run` — no PSP source until 4B; returns report shape, no network; `GET /ledger/reconciliation`, treasurer-only)* |
| FE | `(committee)/admin/treasury` — balances + entries | ⚪ |

### 4B — Razorpay sandbox
| Track | Task | Status |
|---|---|---|
| BE | `infra/razorpay/` client wrapper | 🟢 *(feature-flagged `RAZORPAY_ENABLED`, off by default → deterministic offline stub; rupees↔paise boundary isolated in the client; `verifyWebhookSignature` is ALWAYS real HMAC-SHA256, timing-safe)* |
| BE | `payments/` — order create/capture/refund | 🟢 *(`Payment` + `WebhookEvent`; `POST /payments/orders` idempotent, no ledger write; treasurer `POST /payments/:id/refund` calls PSP only; `GET /payments/:id` society-scoped)* |
| BE | Webhook route with signed-payload verification + idempotency | 🟢 *(public `POST /payments/webhook`; raw-body HMAC verified BEFORE parse via `rawBody:true`; processing wrapped in `IdempotencyService.runOnce` keyed on Razorpay event id)* |
| BE | Payment events → ledger entries | 🟢 *(webhook is the SOLE ledger-writer: `payment.captured`/`order.paid` → EXTERNAL→BULK_BUY, `refund.processed` → reversal, enlisted in the same tx. **Payment-level guard** makes capture/refund idempotent across the captured+order.paid event pair — fixes a double-credit bug caught in supervisor review)* |
| FE | `components/razorpay/Checkout.tsx` wrapper | ⚪ |
| FE | Fallback UI on Razorpay script failure | ⚪ |

### 4C — Offer flow
| Track | Task | Status |
|---|---|---|
| BE | `bulk-buy/` Offer entity with `discount_ladder JSON` + commit; ladder DTO validation (non-empty, strictly increasing `minN`, monotonic `pct`) | 🟢 *(`Offer`/`Commitment`; pure `discount-ladder.util.ts` + spec: validation + `appliedTier` + `nextTierThreshold`; `minCommitments` = ladder's lowest `minN`)* |
| BE | Auto-fire on `min_commitments` reached; applied tier = ladder entry with highest `minN ≤ commitments_count` → escrow-in | 🟢 *(fires synchronously in the commit tx; escrow-in reuses 4B — one `Payment` per commitment, captured via the signed webhook → EXTERNAL→BULK_BUY; commitment flips FUNDED reactively in `applyCapture`)* |
| BE | Booking + JobCard[] on fire; `applied_discount_pct` snapshotted at fire | 🟢 *(one `Booking` + one `JobCard` per commitment; `unitPrice` = offer price × (1−pct) and `appliedDiscountPct` snapshotted at fire, Decimal 2dp)* |
| BE | Per-flat sign-off endpoint | 🟢 *(`POST /job-cards/:id/sign-off`, own-resident-only 403, requires commitment FUNDED; booking → COMPLETED when all signed)* |
| BE | Payout dual-authorisation (system + treasurer) | 🟢 *(`POST /bookings/:id/payout/authorise`, treasurer-only: SYSTEM rule-check (all signed + funded + escrow≥amount) + TREASURER row → executes once; BULK_BUY→COMMISSION_SINK + BULK_BUY→EXTERNAL; commission from `Society.config.commissionPct` (10% default); vendor payout STUBBED (no real RazorpayX); **per-booking advisory lock** closes a concurrent double-pay window found in supervisor review)* |
| FE | `(vendor)/vendor/offers` list + new (ladder editor: dynamic rows minN → pct, sorted, live step-chart preview) | ⚪ |
| FE | `(resident)/offers` list + detail with **discount-ladder step chart** + current tier + "next tier at N+K" hint; Razorpay Checkout | ⚪ |
| FE | Dashboard "My upcoming services" with applied-tier badge | ⚪ |
| FE | Sign-off dialog with rating capture | ⚪ |
| FE | Treasurer payout authorise page | ⚪ |

### 4D — Large jobs
| Track | Task | Status |
|---|---|---|
| BE | JobCard.tier `SMALL / LARGE` + milestone payouts | 🟢 *(LARGE offers carry a `milestoneTemplate` (pcts sum to 100, validated in `milestone-template.util.ts`); on fire → `Milestone` rows; `POST /bookings/:id/milestones/:mid/authorise` (treasurer, dual-auth, advisory-locked) releases in sequence — first milestone sets aside commission→COMMISSION_SINK + retention→RETENTION, last milestone takes the remainder to avoid dust; SMALL/LARGE payout routes reject each other)* |
| BE | Defect-liability retention | 🟢 *(`retentionPct`/`retentionDays` on Offer; retention held in a `RETENTION` account; `POST /bookings/:id/retention/release` (treasurer) releases RETENTION→EXTERNAL only after all milestones PAID and `Clock.now() >= retentionReleaseAt`; idempotent)* |
| FE | Milestone cards with per-stage authorise | ⚪ |

**DoD (whole phase):** end-to-end demo — offer posted → committed → paid → signed off → payout → reconciled.

**4D status (2026-09-16):** verified directly — build ok, oxlint clean, **75 unit + 32 e2e green**. LARGE flow e2e proves: fire → milestones created + retention scheduled → escrow funded → in-order milestone releases (commission+retention set aside at milestone 1, remainder at the last) → retention released after the defect period → BULK_BUY and RETENTION both drain to 0, Σ balances conserved, balancesIntact. SMALL path (4C) unchanged and still green. All transfers stubbed — no real Razorpay calls. **Phase 4 is complete (4A+4B+4C+4D).**

---

## Phase 5 — Bulk-Buy Flow B (resident-initiated) 🟡

**Deliverable:** a resident tags a vendor and opens a poll; vendor confirms; poll fires like Flow A.

| Track | Task | Status |
|---|---|---|
| BE | Poll gains `tagged_vendor_id` + `vendor_confirmed_minimum` | 🟢 *(+ `vendorConfirmedAt`/`vendorDeclinedAt`/`vendorUnitPrice`/`vendorDiscountLadder`; also added `Poll.category` and `PollStatus.CANCELLED`)* |
| BE | Vendor confirm/decline tag request endpoint | 🟢 *(`POST /bulk-buy/polls/:id/vendor-confirm` (committee, sets terms; fires now if min already met) + `/vendor-decline` → CANCELLED)* |
| BE | On fire: reuse Flow A booking/escrow path | 🟢 *(extracted `createBookingWithEscrow` shared by `fireOffer` + `fireResidentPoll`; Flow B bookings are `sourceType:'POLL'`, SMALL-tier v1, and ride the unchanged pay/sign-off/dual-auth payout path. Per-poll `pg_advisory_xact_lock(53)` on both join+confirm closes a concurrent double-fire window found in review)* |
| BE | Weekly-recurring Offer variant for staples | 🟢 *(`Offer.recurring NONE|WEEKLY`; `POST /offers/:id/roll` clones a WEEKLY offer to a fresh OPEN one +7d — scheduler stand-in)* |
| FE | `/polls/new` gains `type=bulk_buy` with vendor picker | ⚪ |
| FE | Vendor inbox for incoming tags | ⚪ |
| FE | Weekly-recurring entry point on vendor record | ⚪ |

**DoD:** residents can pull a bulk-buy into existence by tagging a vendor.

**Backend status (2026-09-16):** verified directly — build ok, oxlint clean, **75 unit + 39 e2e green**. Flow B e2e proves the full chain (resident tags vendor → committee confirms terms → residents join → fires → escrow-funded → sign-off → payout → reconcile) plus decline, ownership split (`POST /polls` rejects BULK_BUY_RESIDENT → 400), weekly roll, and concurrent-join single-fire. Ownership: `bulk-buy` owns BULK_BUY_RESIDENT polls end-to-end; the `polls` module stays governance/event only. All on the Razorpay stub — no real transactions. Migrations `20260916112850/113200/113600_phase5_flow_b*` (three additive; `migrate dev`/`reset` are blocked non-interactively, so applied via `migrate diff --script` + `migrate deploy`). Frontend not started.

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
