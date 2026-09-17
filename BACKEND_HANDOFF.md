# Backend Development Handoff — resume from Phase 9.2

_Last updated by the backend orchestrator (Opus) at Phase 9.1 complete + real-time delivery shipped. This document passes all context needed for the next agent to continue the plan from **Phase 9.2** without relearning the codebase or repeating the gotchas that already cost time._

---

## 0. TL;DR — current state

- **Stack:** NestJS 12 + Prisma 7, **ESM** (`"type":"module"`, every relative import ends in `.js`), Postgres 16 via Docker. Prisma client generated to `backend/src/generated/prisma/`.
- **Done:** Phases 1–8 complete, **Phase 9.1** complete (VirtualAccount + sub-ledger pockets), plus a **real-time Socket.IO push layer**. The resident money loop (service-request pool → committee assign → vendor confirm → PricingCard freeze → escrow → payout across a rung-based approval ladder) is live and DoD-proven.
- **Suite (HEAD):** ~**117 unit + 117 e2e** green; lint/build/`openapi:check` clean; `migrate status` no drift.
- **Resume point:** **Phase 9.2** (maintenance-charge generation + `bill.published` real-time push) — the sub-phase that makes bills real and lights up "bills to individual users in real time." The full Phase 9 sub-phase plan is in §6.
- **HEAD commit:** `5e92572` (Phase 9.1). Recent backend commits listed in §5.

---

## 1. How to run & work (operational gotchas — read before touching anything)

**Docker / DB.** Postgres + maildev run via `docker compose up -d` (containers `society_fintech_postgres`, `society_fintech_maildev`). If Postgres is unreachable, start Docker Desktop then `docker compose up -d`.

**Build/test:**
- `cd backend`
- `npm run lint` (oxlint), `npm run build` (nest build)
- `npm test` (vitest unit), `npm run test:e2e` (vitest against **real Postgres**)
- **Known flake:** under heavy parallel load the e2e suite occasionally times out in *unrelated* suites (they each boot a Nest app + Postgres pool). Failures move around run-to-run and pass on re-run. **Re-run once** before treating a scattered failure as real. Always re-run the FULL suite on integrated `master` — isolation-green ≠ integration-green.

**Migrations are NON-INTERACTIVE.** `prisma migrate dev` / `reset` are BLOCKED (they prompt). Author SQL with:
```
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql
```
If `--from-migrations` complains about a shadow DB, fall back to `--from-config-datasource --to-schema-datamodel prisma/schema.prisma` (diffs against the live DB — several recent migrations used this). Then `npx prisma migrate deploy` + `npx prisma generate`, and finish with `npx prisma migrate status` (must say "no drift"). **Hand-edit** the raw diff for renames (convert drop+create → `RENAME`) and add `DO $$ … RAISE EXCEPTION` guards + data backfills — template: `prisma/migrations/20260916150000_v2_remove_voting_lending_commission/migration.sql` and `..._phase8_1_service_request_participation_rename/`.

**Prisma CLI can vanish.** A concurrent root `npm install` sometimes prunes the `prisma` devDep CLI from the shared `node_modules`, so `npx prisma …` silently fetches a wrong newer major (renamed `migrate`→`migration`, JSON output) and migration tooling breaks. **Runtime is unaffected** (code uses the self-contained generated client), so tests stay green and hide it. Fix: `npm install` at repo root, re-check `npx prisma migrate status`.

**Generated Prisma client is `.ts`**, transformed at runtime by vitest/nest — a raw `node -e` cannot `import` it (`ERR_MODULE_NOT_FOUND` on `client.js`). To script against the DB, build first and use `dist/`, or boot the Nest app in-process (`app.listen(0)`) as the e2e specs and the seed/benchmark harnesses do.

**OpenAPI.** After any route/DTO change: `npm run openapi:generate` then `npm run openapi:check` (CI drift guard). `shared/openapi.json` is the committed spec (currently ~100 paths). NOTE: `POST /auth/dev/login` (a dev-only login controller) **is now committed** on master, so the spec legitimately includes it — the earlier "clean-spec stash dance" to keep it out is **no longer needed**.

**Money-safety HARD rules (never violate):**
- `RAZORPAY_ENABLED=false`, `SMS_ENABLED=false` — stubs only. **Never** make a real Razorpay transaction or real SMS (real transactions incur charges — an explicit user constraint). The SMS stub *throws* if enabled; RazorpayX payout is stubbed and keys on `booking.vendorId`.
- `THROTTLE_ENABLED` defaults **true** (secure-by-default); `backend/.env` sets it `false` so the test suite (which hammers `/auth/signup`+`/verify`) stays green.

---

## 2. Architecture & invariants (must hold — tests assert them)

- **Double-entry ledger** (`src/modules/ledger`): `post({debitKind, creditKind, amount, reasonCode, linkedEntity…})` moves money between two `Account` rows (`@@unique([societyId, kind])`), updating a cached `Account.balance` inside the same tx. `AccountKind` is the pocket discriminator; **pockets are per-society** (one Account per `(societyId, kind)`), NOT per-flat — per-flat would blow up `verifyBalances`/`assertAllBalances`. `BULK_BUY` **is** the procurement-escrow pocket. Phase 9.1 added pockets MAINTENANCE/ELECTRICITY/WATER/EVENTS/WELFARE/SINKING/CORPUS (additive enum values; no Account rows exist until something posts).
  - **I2** (no platform-owned account / conservation): every posting is balanced; sum across accounts nets to zero.
  - **I6** (`Account.balance` is a rebuildable cache): `verifyBalances(societyId)` cross-checks cached vs recomputed-from-`LedgerEntry`; `rebuildBalances` reconstructs; `assertAllBalances` sweeps all societies. `GET /ledger/verify` is resident-callable **integrity-only** (no amounts).
- **Hash-chained AuditLog** (`src/modules/audit`): append-only, SHA-256 chain per society, `pg_advisory_xact_lock(42, …)`. `verifyChain(societyId)` proves integrity (`GET /audit/verify`, resident-callable). Money/authority mutations write `AuditService.appendBestEffort(...)` **after** the tx commits (never a false "executed" row on rollback).
- **Idempotency:** `IdempotencyService.runOnce(scope, key, societyId, fn)` — advisory lock ns **51**.
- **Advisory-lock namespaces:** 42 audit · 51 idempotency · 52 payout/milestone (per booking) · 53 resident-poll fire · **54 service-request** threshold-eval/confirm · (56 reserved by the Phase 9 plan for pocket transfers). Take the lock as the FIRST statement inside the transaction.
- **Approval ladder (M14)** (`src/modules/bulk-buy/approval-ladder.util.ts` + `authorisePayout`): rung 1 (≤lowerThreshold) 1 officer; rung 2 (≤upper) 2 distinct; rung 3 (>upper) `max(2, ceil(majorityFraction × committeeRoster))`. Config in `Society.config.approval` (conservative all-or-nothing default). Authorisations keyed `@@unique([payoutId, authoriserId])` so the same officer can't double-count. **Reuse this verbatim for Phase 9.6 pocket transfers** (with a floor of 2 — dual-authorised always).
- **Discriminated principal** (`common/types/current-user.ts`): `RESIDENT | VENDOR | OPERATOR`. Resident carries `societyId`/`occupancyRole`/`roleKinds`; **vendor carries `societyIds: string[]`** (multi-society since 7.1); operator none. `UserContextService.load()` resolves it; `AuthGuard` accepts session cookie OR `Authorization: Bearer`.
- **Ratification gate (6.3):** a self-registered `Occupancy` starts `PENDING`; `UserContextService` only resolves a RESIDENT whose occupancy is `RATIFIED`, so an un-ratified account gets 401. **Every e2e fixture must** `prisma.occupancy.updateMany({ where:{userId}, data:{ ratificationStatus:'RATIFIED', ratificationDecidedAt:new Date() }})` after verify (see any `*.e2e-spec.ts`).

---

## 3. Cross-cutting patterns (copy these, don't reinvent)

- **Guards & the RolesGuard FOOTGUN (bitten 3×):** `@Roles(...)` (RolesGuard) and `@SocietyScope()` (SocietyScopeGuard) read metadata **handler-level only** — a **class-level** `@Roles`/`@SocietyScope` is **silently ignored** (route becomes open to any resident). Always apply them **per-method**. In contrast, `@ResidentOnly()/@VendorOnly()/@OperatorOnly()` (PrincipalGuard) DO honor class-level (they use `getAllAndOverride`). `@CurrentResident()` 403s non-residents; `@CurrentUser()` returns the discriminated union.
- **Post-commit best-effort dispatch** (notifications AND real-time): inside the `$transaction`, only READ what you need (recipients/payload) and return it; AFTER `$transaction` resolves, dispatch — each send wrapped in try/catch, logged not thrown. A mail/socket failure must NEVER roll back or reverse a committed state/money change. Reference: `polls.service.ts` (`collectRecipients`/`dispatchNotifications`) and `service-requests.service.ts` (`pushRealtime` alongside `dispatchNotifications`).
- **Real-time (`src/modules/realtime`):** Socket.IO gateway authenticated on connect (cookie-first, then `handshake.auth.token`, then `Authorization` — mirrors `AuthGuard`; invalid session disconnected before joining any room). Rooms: `user:<id>` (always) + `society:<id>` (residents / each vendor-linked society; operators none). `RealtimeService.emitToSociety(societyId, type, payload)` / `emitToUser(userId, type, payload)` → single `'domain-event'` event `{ type, payload, at }`, never throws. Payloads are LEAN (id/type/title/status) — clients refetch via REST. **`emitToUser` is the ready seam for Phase 9.2 `bill.published`.** Single-instance in-memory adapter — a Redis adapter is needed before running >1 backend instance. Measured delivery latency: **~0 ms** (fires pre-response, loopback), end-to-end p95 ~0.5 s (dominated by the REST handler's DB work, not the socket).

---

## 4. Coordination gotchas (this repo has MULTIPLE active sessions on ONE working tree)

A concurrent **frontend session** edits `apps/web` / `apps/mobile`, and **the user** also commits directly. All commits use the same git identity (`Sonalika0696`), so author doesn't distinguish sessions.

- **NEVER `git add -A` / `git add .`** — commit with **explicit paths** only. Another session's broad `git commit -a` has swept uncommitted work into a mixed commit and **rebased** the branch (your recent commit hashes change; content survives). If that happens: don't reset/split their commit (it holds others' work) — verify your code landed (`git show HEAD:<file> | grep`), commit any remaining pieces with explicit paths, regenerate `shared/openapi.json`, re-run the full suite on the new HEAD.
- **Do NOT touch `apps/*`** (frontend-owned).
- **Shared Postgres** → keep the DB single-lane for anything latency/consistency-sensitive; parallel test lanes cause the contention flake in §1.
- **Shared root `package-lock.json`** → when adding a backend dep, commit `backend/package.json` AND the lockfile together (else `npm ci` breaks); the lockfile may carry frontend churn — that's the frontend's to reconcile.
- More detail is in the project memory file `parallel-agent-coordination.md`.

---

## 5. What's built (phases + representative commits)

| Phase | What | Commit(s) |
|---|---|---|
| 6.1 | V2.0 scope cleanup (removed voting/commission/dead account kinds) | `01cba78` |
| 6.2 | Discriminated identity, phone OTP, password+TOTP 2FA, bearer tokens | `47fca57` |
| 6.3 | Society mgmt, **ratification gate**, delegation, consent | `bb6c0b5` |
| 6.4 | **Approval ladder** (N-of-M distinct-officer settlement) | `105c0aa` |
| 6.5 | audit/verify · notifications post-commit · balance-cache worker · rate limiting · **OpenAPI spec + drift guard** | `28c7ff7`,`56ba9c0`,`a5d01c0`,`e2d3729`,`43800b4` |
| web-gap | `GET /auth/session` · dashboard KPIs · `GET /ledger/cashflow` | `8926c06`,`5964fd8`,`791cdd3` |
| posture | `/ledger/verify` integrity-only · `THROTTLE_ENABLED` default-on | `622e6c0` |
| 7.1–7.3 | Vendor identity/`VendorSocietyLink` split · immutable pricing cards · vendor self-service + `PLATFORM_AUDITED` | `c77aa8c`,`6069540`,`b2c6c17` |
| 8.1–8.3 | `Poll→ServiceRequest` rename · **pooling loop** (threshold→assign→confirm→card-freeze→escrow) · notifications | `e5e36cf`/`10c6e44`, `320ea9c`/`517fe0c`, `e27bb9a` |
| real-time | Socket.IO gateway + live delivery of events & service-request pools | `566fdda` |
| 9.1 | **VirtualAccount** + sub-ledger pockets | `5e92572` |

_(Note: some hashes shifted after a user rebase — match by message, not hash.)_

---

## 6. Phase 9 plan & adopted decisions (the roadmap — START HERE at 9.2)

The full architecture pass (with file/line anchors) concluded most billing infra already exists — the ledger `post()` is generic, `BULK_BUY` already is the procurement-escrow pocket, procurement contributions are already queryable rows (`Participation→Commitment→JobCard→Payment→LedgerEntry`), and `RealtimeService.emitToUser` is the ready bills seam. **The one genuine gap is maintenance** — `Flat.maintenanceAmount` is a rate nothing ever turns into an obligation.

**Adopted decisions (do NOT re-litigate):**
1. Sub-ledger pockets = **additive `AccountKind` values, per-society** (done in 9.1). Not per-flat.
2. **Bills are derived-on-read** via one `$queryRaw` UNION (maintenance ∪ procurement, with utilities/events as future arms) — NOT a precomputed `Bill` table.
3. `PaymentsService.applyCapture`/`applyRefund` must **branch on `linkedEntityType`** (credit MAINTENANCE for a maintenance-linked payment vs BULK_BUY for a Commitment). This is the one shared-code touch — needs a regression test proving bulk-buy/service-request capture is byte-identical.
4. **Dual-authorised pocket transfers** reuse `approval-ladder.util.ts` with a floor of 2 (never single-officer); advisory-lock a new ns (56).
5. Cursor pagination + ETag on **new** Phase 9 list endpoints only (not a retrofit of Phases 1–8).
6. Bank-narration matching is **substring on `VirtualAccount.code`**, and only ever *narrows to a flat* — it never auto-posts; every line (matched or not) requires an explicit treasurer `allocate` action.
7. **Heads-up:** `GET /me/bills`'s full vision (maintenance + utilities + events) is only partially realizable in Phase 9 — utilities need metering (Phase 10), events need the Event entity (Phase 11). The UNION query is shaped so those slot in as arms later with no rewrite.

**Sub-phase breakdown:**
- **9.2 (NEXT):** `MaintenanceCharge {societyId, flatId, period 'YYYY-MM', amount (snapshot of Flat.maintenanceAmount), lateFeeAccrued, paidAmount, dueDate, status}` `@@unique([flatId, period])`; `late-fee.util.ts` (mirror `approval-ladder.util.ts`, config in `Society.config.lateFee`); `InstalmentPlan`; `MaintenanceBillingService.generateForPeriod`/`accrueLateFees`; extend `PaymentsService.applyCapture`/`applyRefund` with the MaintenanceCharge branch; **emit `bill.published` via `RealtimeService.emitToUser(residentId, ...)` post-commit** for each generated charge. _This is the user's top priority — bills visible to individual users in real time._
- **9.3:** `GET /me/bills` — `BillsService` `$queryRaw` UNION (maintenance ∪ procurement via the JobCard/Commitment chain), each line carrying `basis` + `evidence` pointers; build cursor pagination + ETag here first.
- **9.4:** `GET /me/home` — mobile aggregate (amount due, actions needed, joinable service requests, upcoming events).
- **9.5:** `BankStatementLine` CSV ingestion (mirror `flat-csv.util.ts` + `flats.service.ts` shape; body-string CSV, no multipart in this repo) → match-by-VA → treasurer allocate queue; statement history + CSV export.
- **9.6:** `PocketTransfer` + `PocketTransferAuthorisation` (mirror `Payout`/`PayoutAuthorisation` + `authorisePayout` exactly), dual-authorised cross-pocket journal endpoints.
- **9.7:** Server-Timing/p95 instrumentation, cursor+ETag retrofit onto the bank-line list, spec regen, full e2e sweep, phase close-out.
- **Sequencing:** 9.1 → **9.2 → 9.3 → 9.4** (the real-time-bills path) first; 9.5 & 9.6 don't block the mobile home tab and can follow/parallelize (they don't touch MaintenanceCharge/BillsService/the realtime emit).

---

## 7. Key files/anchors for 9.2+

- `backend/prisma/schema.prisma` — new models/enums land here (`AccountKind`, `Society` relations).
- `backend/src/modules/ledger/ledger.service.ts` — `post()`/`getOrCreateAccount()` reused unchanged for every pocket.
- `backend/src/modules/payments/payments.service.ts` — `applyCapture`/`applyRefund` (~207–312) get the MaintenanceCharge branch (decision #3).
- `backend/src/modules/bulk-buy/approval-ladder.util.ts` + `bulk-buy.service.ts` `authorisePayout` (~499–580) — the exact pattern `PocketTransfer` authorisation mirrors.
- `backend/src/modules/realtime/realtime.service.ts` — `emitToUser` seam for `bill.published`; add `'bill.published'/'bill.paid'` to the `DomainEventType` union (optional, runtime already accepts strings).
- `backend/src/modules/operator/flats.service.ts` + `flat-csv.util.ts` — the CSV-ingestion template for `BankStatementLine`; and where VirtualAccount provisioning is wired.
- `backend/src/modules/service-requests/service-requests.service.ts` — the `Commitment`/`JobCard`/`Payment` evidence chain `/me/bills`' procurement lane reads.
- `backend/src/modules/virtual-accounts/` — VA provisioning + `code` (used for bank-narration matching in 9.5).
- `backend/src/modules/users/users.controller.ts` — `@Controller('me')`; `/me/bills` and `/me/home` fit as sibling routes in their own modules (mirror `DashboardController`).

---

## 8. Pending / deferred items (not yet done)

- **Card creator-name enrichment (small, requested):** the admin UI opens bulk-buy + service-request cards and wants "created at + by whom". `GET /service-requests/:id` returns `createdAt` + `creatorId` but only the **id** — add the creator's **display name** (+ flat unitNo) to the service-request and bulk-buy detail projections so the card can show "by <name>". (The "small card, not full-screen" part is pure frontend.)
- **Comprehensive seed:** an idempotent realistic dataset covering every scenario + a DB dedupe was being generated at handoff time (script under `scripts/`). Verify it ran, `verifyBalances`/audit-chain intact, and the seed script is committed. Re-run it to refresh demo data.
- **Phase 9.2–9.7** (§6), then **Phase 10** (metering & utilities → fills the utilities arm of `/me/bills`), **Phase 11** (Events entity + registrations → fills the events arm; lets you finally retire EVENT polls), **Phase 12** (audit filter/read endpoints + scheduled chain-verification worker).
- **Deferred / cross-cutting:** retire the old **Flow B** (`/bulk-buy/polls`) money-path code (superseded by service-requests; coexists harmlessly; do it as a focused reviewed change); **push notifications** (FCM/APNs) for *closed* apps (the live socket only reaches open apps); **Redis Socket.IO adapter** before scaling >1 instance; **TOTP clock-skew window** (currently tolerance 0) before real officer rollout; **high-fan-out latency sweep** (50/100/200 sockets — the benchmark only got clean 1/3-client tiers).

---

## 9. Confirmed product decisions (locked — don't reopen)

- **Committee-origin ServiceRequest goes through the pool loop** (threshold→assign→confirm), distinct from the `Offer` path (which stays for pre-negotiated top-down deals).
- **Vendor supplies an explicit contribution quote at confirm** + the PricingCard freezes as the variance reference — never auto-sum card lines.
- **Committee relays vendor confirmation** for now (vendor-self-confirm via `@VendorOnly` is a fast-follow).
- **Razorpay/SMS never real** (charges). **Bills derived-on-read.** **Pockets per-society.** (See §6.)

---

_When in doubt: read the nearest existing module that does the same shape (there is almost always one), preserve the money invariants, keep dispatch post-commit, apply guards per-method, migrate additively with a guard block, and re-run the FULL suite on the real HEAD before committing with explicit paths._
