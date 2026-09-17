# Supervisor Progress Tracker

Single source of truth for **what's shipped, what's in flight, what's blocked**. Backend and frontend map to the same phase numbers so progress is comparable at a glance.

**How to use this file:**
- Mark items `[x]` as they complete. Do not remove them.
- Add a line to the decisions log if something is decided differently in flight.
- The **Demo bar** says what a demo shows *right now*, if the project stopped today.
- Refresh the timestamp on every edit.

**Last updated:** *2026-09-16 — V2.0 scope revision applied. Lending, wallet, vouchers and resident voting withdrawn; utility billing, collections, treasury, vendor pricing cards and a native resident app added. Phases renumbered; 0–5 complete, 6–13 replan. Scope cleanup landed in code: voting, lending/voucher account kinds and commission removed, e2e green. See [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md) and [DOC_AMENDMENTS_V2.md](DOC_AMENDMENTS_V2.md).*

**Current active phase:** *Phase 6 — Identity, society management and the approval ladder. Blocks every other phase and both clients. **6.1 scope cleanup done & e2e-green (uncommitted); next is 6.2 identity**, driven by the dedicated backend session (see decisions log for the sub-phase sequencing and handoff).*

---

## Demo bar *(what the project can show today)*

> `docker compose up -d` + `npm run prisma:migrate` + `npm run prisma:seed` + `npm run dev:backend` brings up the NestJS API. Over HTTP: a resident signs up, receives an OTP, verifies it, and posts to the society notice board, which a committee member can moderate — every moderation writing a hash-chained audit row. A committee onboards vendors with offline GSTIN verification that auto-promotes an Active GSTIN to `SOCIETY_ATTESTED`; residents browse the directory and rate vendors against a running aggregate. The full **collective procurement flow** works end to end on the payment sandbox: a committee posts an offer with a discount ladder, residents commit, the offer auto-fires at its minimum while snapshotting the applied tier, each resident pays into a hash-verified escrow ledger, residents sign off their job cards, and settlement reconciles escrow back to zero — all money tracked in an append-only double-entry ledger with a conservation invariant, and large jobs staged across milestones with defect-liability retention. A resident-initiated variant pulls a procurement into existence by tagging a vendor. **Still API-level only** — curl and the e2e suite. No client exists yet.

*Update this box on the last commit of every phase. It should read like a two-sentence pitch of what a supervisor would see if they opened the project right now.*

---

## Legend

- **Status:** 🟢 done · 🟡 in progress · ⚪ not started · 🔴 blocked · ♻️ shipped but superseded, rework pending
- **Track:** **BE** backend · **FE-M** resident mobile app · **FE-W** management web · **SIM** Python harness

---

## Status at a glance

| Phase | Scope | Modules | BE | FE-M | FE-W |
|---|---|---|---|---|---|
| 0 | Foundation, audit chain | — | 🟢 | ⚪ | ⚪ |
| 1 | Auth + notice board | — | ♻️ | ⚪ | ⚪ |
| 2 | Vendor directory | M4 partial | ♻️ | ⚪ | ⚪ |
| 3 | Poll engine | — | ♻️ | ⚪ | ⚪ |
| 4 | Ledger, payments, procurement | M7 partial | ♻️ | ⚪ | ⚪ |
| 5 | Resident-initiated procurement | M7 partial | ♻️ | ⚪ | ⚪ |
| **6** | **Identity, society mgmt, approval ladder** | **M1, M2, M14** | 🟡 | ⚪ | ⚪ |
| 7 | Vendor portal, pricing cards | M4 | ⚪ | ⚪ | ⚪ |
| 8 | Service requests, pooling | M7 | ⚪ | ⚪ | ⚪ |
| 9 | Collection, reconciliation, bills hub | M11, M12 | ⚪ | ⚪ | ⚪ |
| 10 | Electricity + water billing | M5, M6 | ⚪ | ⚪ | ⚪ |
| 11 | Events, charge sheets, settlement | M8, M4 | ⚪ | ⚪ | ⚪ |
| 12 | Treasury, audit exposure, camps, donations | M12, M13, M9, M10 | ⚪ | ⚪ | ⚪ |
| 13 | Simulation harness | — | ⚪ | — | — |

Task detail lives in [BACKEND_PLAN.md](BACKEND_PLAN.md) and [FRONTEND_PLAN.md](FRONTEND_PLAN.md) and is not duplicated here, to avoid drift.

---

## Completed phases and their rework debt

All five shipped phases are e2e-verified against real PostgreSQL. **66 unit tests, 38 e2e tests, green** *(75 / 39 before the V2.0 cleanup removed the voting tests)*. Each carries rework from the V2.0 revision.

| Phase | Shipped | Rework, and where it lands |
|---|---|---|
| **0** 🟢 | NestJS scaffold, Zod-validated config, Prisma, 90-flat seed, `GET /health`, **hash-chained `AuditLog`** with forward verification — proven to catch a row tampered by raw SQL, and safe under 15 concurrent appends | None |
| **1** ♻️ | Email OTP, DB-backed sessions, notice board with company-email verification, rate limiting, committee moderation | Phone OTP replaces email; bearer tokens added → **Phase 6** |
| **2** ♻️ | Vendor directory, GSTIN verification with auto-promotion, category/name filters, rating aggregate | `Vendor` splits from `VendorSocietyLink`; vendor login → **Phases 6, 7** |
| **3** ♻️ | Advisory/binding/event polls, ownership-weighted voting, tenant eligibility, auto-fire on minimum | ✅ Voting **deleted** (2026-09-16). Remaining: commitment mechanic becomes `ServiceRequest`/`Participation` → **Phase 8** |
| **4** ♻️ | Double-entry ledger with conservation invariant, aggregator sandbox, offer → commit → escrow → sign-off → settlement, milestone staging, defect-liability retention | ✅ Commission **removed** (2026-09-16). Remaining: `Account.balance` becomes a rebuildable cache (I6); approval ladder replaces single-treasurer authorisation → **Phase 6** |
| **5** ♻️ | Resident tags a vendor, poll fires down the shared settlement path. Supervisor caught and fixed a concurrent double-fire race via advisory lock | Resident no longer names the vendor; committee sources → **Phase 8** |

---

## Cross-cutting standing tasks

- [ ] Regenerate `shared/openapi.json` + typed client after any contract change; **CI fails on drift**
- [ ] Every new endpoint carries a p95 measurement before its phase closes — **> 500 ms is a bug**
- [ ] Update the Demo bar on the last commit of every phase
- [ ] Update the `Last updated` timestamp on every edit to this file
- [ ] Migrations kept reversible
- [ ] Every new endpoint has `@Roles(...)` and `@SocietyScope()` where applicable
- [ ] Any compliance invariant touched by a phase gets an explicit test asserting it still holds
- [ ] Copy written like a real product; no lorem ipsum

---

## Log of decisions changed in flight

- **2026-09-16 — Backend handoff + plan additions (supervisor session).** Backend execution from Phase 6.2 onward is driven by the dedicated backend session; this orchestrator has handed over an updated [BACKEND_PLAN.md](BACKEND_PLAN.md) with Phase 6 broken into sub-phases **6.1 (done) → 6.2 identity → 6.3 society mgmt → 6.4 approval ladder → 6.5 cross-cutting**, each build→test→commit before the next. Two improvements folded into the plan: (1) **`GET /audit/verify` pulled forward** to 6.5 (was Phase 12) — the chain-verify service is built and e2e-proven, exposing it now backs a novelty claim for every client at near-zero cost; (2) **notifications moved out of the DB transaction** — the Phase 3 poll fire/expiry paths `await` mail inside the posting tx, so a mail failure could roll back committed state; dispatch must be post-commit best-effort. **Action for the backend session: commit the green 6.1 working-tree checkpoint to `master` before starting 6.2** — it is currently uncommitted.
- **2026-09-16 — V2.0 scope cleanup landed in code.** Removed resident voting (`Vote`, `VoteChoice`, `PollWeightMode`, `ADVISORY`/`BINDING` types, `PASSED`/`FAILED` statuses, quorum/weighting fields, `Flat.ownershipShare`, `POST /polls/:id/vote`), the `VOUCHER`/`LENDING_SIM`/`COMMISSION_SINK` account kinds, and per-payout commission. Vendors are now paid the full escrowed amount, and the e2e suite asserts the stronger I2 property that **EXTERNAL nets to exactly zero** across both SMALL and LARGE flows — every rupee in goes back out. `Booking.commissionTaken` was **renamed** to `retentionSetAside` rather than dropped, because it also marks the once-only retention set-aside; resetting it would double-hold retention on in-flight large jobs. The migration **refuses to run**, with an explicit message, if any ledger entries, commission history or voting data would be destroyed — verified by planting a `COMMISSION_SINK` entry in a rolled-back transaction. Tests: unit 75 → 66, e2e 39 → 38, all green. New e2e test asserts invariant I8 directly.
- **2026-09-16 — Dev database reset (with explicit consent).** `prisma migrate dev` refused to proceed because `20260916113600_phase5_flow_b_poll_cancelled` had been edited after it was applied locally (the committed file differs from the checksum recorded in `_prisma_migrations`). The dev DB held only seed data plus one Phase 1 smoke-test job post; it was reset, the full migration chain re-applied from zero, and re-seeded. **Lesson:** never edit a migration after it has run anywhere — add a new one. Not an issue for anyone cloning fresh, whose DB applies the committed file.

- **2026-09-16 — V2.0 scope revision.** Lending, wallet, vouchers and society coupons withdrawn (RBI NOF ₹2cr and the 16 Aug 2024 closed-user-group prohibition; PSS Act 2007 stored-value boundary). Resident voting withdrawn for product-focus reasons, with the approval ladder terminating in a **committee majority** instead of a general-body poll. Added: utility billing (M5, M6), collections and treasury (M11, M12), vendor pricing cards with charge-sheet variance (M4), events (M8), camps and donations (M9, M10). Service engagements become **pooled only** — no individual bookings. Committee **sources vendors**; no bidding. Revenue moves from per-payout commission to a **vendor listing/subscription fee**, which is what makes invariant I2 enforceable. Client splits into a **native resident app** and a **management web app**, superseding the single-PWA specification in SDD §2.1/§2.3. Full log: [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).
- **2026-09-16 — Implementation order departs from SDD §10.** The SDD placed electricity billing first because it exercises ledger, apportionment and audit together. That rationale is spent — both are built and independently verified. Sequencing is now by product dependency, starting with identity generalisation, which blocks the vendor portal, the operator console and every client surface.
- **2026-09-16 — Build order: backend-first per phase.** Each phase's backend is completed and e2e-verified against real Postgres, committed to `master` when green, then the next phase starts. Rationale: the verification loop is tightest at the API layer. Consequence: "fresh clone → browser demo" wording in a phase DoD is only fully satisfiable once that phase's client work lands.
- **2026-09-16 — Plan extension after reading an alternate design set.** Imported without changing scope: novelty framing with four claims, hash-chained `AuditLog`, `OWNER_ABSENTEE` with tenant delegation, vendor discount ladders, GSTIN sandbox verification, functional-accuracy evaluation in the sim.
- **Package manager: npm workspaces, not pnpm.** ARCHITECTURE.md allowed either; pnpm wasn't installed, npm 11 was.
- **Session model: DB-backed `Session` table, not stateless JWT.** Chosen so logout and force-revoke work for committee and treasurer accounts. Now also what makes bearer-token auth for the mobile client a one-guard change.
- **Lint/test tooling: oxlint + vitest, not ESLint + Jest.** Current Nest CLI defaults; same intent, faster, less config.
- **Prisma pinned to 7.10.0 stable, not the `latest` dist-tag** (which resolves to an 8.0.0 RC). Also cut audited vulnerabilities from 18 to 9.
- **Prisma 7 requires an explicit driver adapter.** `PrismaService` constructs the client with `@prisma/adapter-pg` rather than a bare `DATABASE_URL` on the datasource block.
- **`GET /health` excluded from the `/api/v1` global prefix** so infra probes don't need the versioned path.
- **Backend uses `"type": "module"` (true ESM)** — NodeNext resolution, `.js` extensions on relative imports even in `.ts` source. Affects every file written in `backend/src`.
- **Dev Postgres volume wiped and the migration regenerated clean** rather than layering a second migration, when the `OccupancyRole` enum change made an in-place cast unsafe. Only synthetic seed data existed and the migration had never left localhost. Would not do this again once a second developer or referenced data depends on migration history.
- **Hash-chain content is the full logical row, not just the `payload` column.** `SHA-256(previousHash || canonicalJson({ts, societyId, actorId, action, subjectType, subjectId, payload}))` — hashing only `payload` would leave `action`/`subjectType`/`subjectId`/`actorId` unprotected, defeating the novelty claim.
- **`AuditLogInterceptor` resolves `societyId` from the route's `:sid` param, falling back to `request.user.societyId`.** If neither resolves, the write is skipped and logged rather than guessed. **Phase 6 note:** this contract assumed one user, one society — it must be revisited when the principal model becomes `RESIDENT | VENDOR | OPERATOR`.
- **Signup creates the Occupancy directly — no committee approval in v1.** **Superseded by Phase 6:** RoU M2 requires committee ratification against the imported flat register before activation, to close the phantom-resident vector.
- **OTP: 6-digit code, 10-minute expiry, 60-second resend cooldown.**

---

## Log of blockers

- **🔴 Vendors and operators cannot authenticate.** `UserContextService.load()` returns `null` without an active `Occupancy`, and `AuthGuard` converts that to `401 'No active society membership'`. Identity is structurally "a resident of exactly one society", so the vendor portal (RoU M4) and operator console cannot exist. *Resolution: Phase 6 principal model. Blocks Phases 7–12 and both clients.*
- **🟡 `shared/openapi.json` does not exist.** Referenced by the frontend plan; `shared/types` and `shared/constants` are empty directories. With two clients this is blocking rather than cosmetic. *Resolution: Phase 6.*
- **🟡 `AuditService.verifyChain` has no endpoint.** The service is built and e2e-proven, but SDD §4.10 requires an endpoint any resident may call, and it backs one of the four novelty claims. *Resolution: **Phase 6.5** (pulled forward from Phase 12 on supervisor suggestion — cheap, high-value, unblocks the novelty claim for every client). Phase 12 retains only the scheduled verification worker + audit filter endpoints.*

---

## Risk register *(revisited at every phase boundary)*

| Risk | Current mitigation | Status |
|---|---|---|
| NBFC-P2P regulation triggers | Lending **removed from scope entirely** in V2.0; the regulatory analysis that establishes why becomes a dissertation contribution rather than a compliance burden | 🟢 eliminated |
| Stored-value / PPI authorisation | Wallet, vouchers and coupons **removed**; no cash-convertible balance exists in the schema | 🟢 eliminated |
| Payment Aggregator licensing | Collection routes through an RBI-authorised aggregator holding funds in transit under its own licence; no platform-owned account exists (I2) | 🟡 verify I2 has a test in Phase 6 |
| Platform revenue conflicts with transparency | Revenue is a vendor listing fee, contracted outside the society's rails. Structural mitigation: immutable cards, freeze at confirmation, automatic variance detection | 🟡 state the tension explicitly in the dissertation |
| Committee-fraud vector | Three-rung approval ladder — two distinct identities, then committee majority — plus hash-chained audit of every instruction, approval and rejection | 🟡 verify in Phase 6, again in Phase 12 |
| Audit-log tamper-evidence | SHA-256 previous-hash chain over every state change; society-scoped advisory lock on append; tail hash cached; scheduled verification worker | 🟡 verify chain intact after each phase's e2e run |
| DPDP Act consent architecture | Consent ledger enforced at query time, not display time; sub-meter readings treated as personal data revealing occupancy | 🟡 verify each phase adds proper consent events |
| No health data ever stored | Invariant I5 enforced structurally — no schema field can hold clinical information | 🟡 verify in Phase 12 |
| Vendor inflating charges after work | Pricing card frozen at confirmation; line-level variance automatic; resident acknowledgement required | 🟡 verify in Phases 7, 11 |
| Vendor identity fraud | GSTIN verification at onboarding; trade licence capture; tier promotion rule-driven and logged | 🟡 verify in Phase 7 |
| Phantom resident self-registering | Committee ratification against the imported flat register before activation | 🟡 verify in Phase 6 |
| Meter reading manipulation | Readings written to the audit chain **at capture**, before computation; corrections post a reversing reading; flagged meters halt the cycle | 🟡 verify in Phase 10 |
| **Surface proliferation** | Four client surfaces (resident app, committee web, vendor web, operator web) against one unbuilt frontend. Mitigated by a shared generated API client and shared design tokens | 🔴 **live — the largest delivery risk** |
| **Scope growth vs. remaining time** | V2.0 adds eight modules with no backend. Phases 10–13 carry the dissertation's economic contribution and must not be squeezed | 🔴 **live — review at every phase boundary** |
