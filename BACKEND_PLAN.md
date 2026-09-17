# Backend Implementation Plan

**Version 2.0.** Companion to [ARCHITECTURE.md](ARCHITECTURE.md), the V2.0 Report of Understanding and Software Design Document as amended by [DOC_AMENDMENTS_V2.md](DOC_AMENDMENTS_V2.md). Decisions in [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md). Progress in [SUPERVISOR.md](SUPERVISOR.md).

Phases 0–5 are complete and end-to-end verified. Phases 6–13 are new and map 1:1 onto the frontend phases in [FRONTEND_PLAN.md](FRONTEND_PLAN.md).

**Sequencing note.** SDD §10 as first drafted placed electricity billing first, on the grounds that it exercises ledger, apportionment and audit together and therefore de-risks everything after it. That rationale is spent — the ledger and audit chain are built and independently verified. Sequencing is now by product dependency, and identity generalisation comes first because it blocks the vendor portal, the operator console and every client surface.

---

## Completed phases

| Phase | Delivered | Rework required |
|---|---|---|
| **0** — Foundation | NestJS, config, Prisma, hash-chained `AuditLog` with verification, seed | — |
| **1** — Auth + notice board | Email OTP, DB-backed sessions, job blog with moderation | Phone OTP replaces email; bearer tokens (Phase 6) |
| **2** — Vendor marketplace | Directory, GSTIN verification, tier promotion, rating aggregate | `Vendor` splits from `VendorSocietyLink`; vendor login (Phase 7) |
| **3** — Poll engine | Advisory / binding / event polls, ownership weighting, auto-fire on minimum | `Vote`, `VoteChoice`, `PollWeightMode` deleted; commitment mechanic becomes `ServiceRequest` / `Participation` (Phase 8) |
| **4** — Ledger, payments, procurement | Double-entry ledger with conservation invariant, aggregator sandbox, offer → commit → escrow → sign-off → settlement, milestones, retention | Commission removed; `Account.balance` becomes a rebuildable cache; approval ladder replaces single-treasurer authorisation (Phase 6) |
| **5** — Resident-initiated procurement | Resident tags a vendor, poll fires down the shared settlement path | Resident no longer names the vendor; committee sources (Phase 8) |

**Standing state:** 66 unit tests, 38 e2e tests, green against real PostgreSQL *(was 75 / 39 before the V2.0 scope cleanup: 9 tally-util unit tests and 3 voting e2e tests deleted with the feature; 2 e2e tests added — one proving no voting surface exists, one covering close-early)*.

---

## Phase 6 — Identity, society management and the approval ladder

**Modules:** M1, M2, M14 · **Frontend:** F1, F6

**Goal:** a platform operator can create a society and import its flats; a resident can sign up by phone and be ratified by the committee; a vendor and an operator can authenticate at all. Expenditure is governed by a three-rung ladder.

This phase is the keystone. Nothing else in the plan can start without it.

**Sub-phase sequencing** *(agreed with the supervisor 2026-09-16; build → test → commit each before the next, suite stays green):*
- **6.1 Scope cleanup** — ✅ **done & e2e-green** (voting, commission, dead account kinds removed; I2 + I8 asserted). Landed in the working tree; see the decisions log. *Not yet committed to `master` at time of writing — commit a checkpoint before starting 6.2.*
- **6.2 Identity** — principal model + phone OTP + bearer tokens + password/TOTP 2FA + role guards. *Highest leverage: unblocks vendor + operator login and both clients.*
- **6.3 Society management** — society/flat-CSV/occupancy/role CRUD + committee ratification queue + `Delegation` + `ConsentGrant`.
- **6.4 Approval ladder (M14)** — generalise `PayoutAuthorisation` to N approvers; three rungs; reject same/repeat identity; per-society thresholds; `DEPUTY_TREASURER` live.
- **6.5 Cross-cutting** — I6 balance cache + assertion worker; `shared/openapi.json` + typed client; OTP/auth rate limiting; **expose `GET /audit/verify`** (pulled forward — see below).

- [ ] **Principal model.** Replace the implicit "resident of exactly one society" identity with a discriminated `RESIDENT | VENDOR | OPERATOR` principal. `UserContextService.load()` currently returns `null` without an active `Occupancy`, and `AuthGuard` converts that to `401` — so a vendor or operator cannot authenticate today.
- [ ] `CurrentUserContext` becomes a discriminated union; `societyId` and `occupancyRole` are no longer unconditionally present
- [ ] New guards: `@ResidentOnly()`, `@VendorOnly()`, `@OperatorOnly()`; `SocietyScopeGuard` gains an operator bypass
- [ ] **Phone OTP** as the resident credential; `User.phone` becomes the anchor. Email retained as a contact field
- [ ] **Password + mandatory TOTP 2FA** for committee officers and vendors (SDD §5.1)
- [ ] **Bearer tokens** accepted alongside the session cookie. `SessionService.validate()` already does the work — this is one guard
- [ ] Society CRUD; **flat register CSV import** validating that area factors sum to unity within tolerance
- [ ] Occupancy management: move-in, move-out, tenure clock
- [ ] **Committee ratification queue** — no self-registered account activates without it (SDD §5.3 phantom-resident threat)
- [ ] `Delegation` entity, scoped and revocable; financial and voting capabilities excluded at the type level
- [ ] `ConsentGrant` entity, enforced at query time rather than at display time
- [ ] Role assignment: `COMMITTEE`, `TREASURER`, `DEPUTY_TREASURER`
- [ ] **Approval ladder (M14):** generalise `PayoutAuthorisation` from an implied two approvers to N. Rung 1 single officer; rung 2 two distinct identities; rung 3 configurable committee majority. Reject same-identity and repeat-identity approval
- [ ] Thresholds and majority fraction as per-society configuration
- [x] **Scope cleanup:** delete `Vote`, `VoteChoice`, `PollWeightMode`, `AccountKind.VOUCHER`, `AccountKind.LENDING_SIM`, `AccountKind.COMMISSION_SINK`; remove commission splitting from settlement *(done 2026-09-16 — also removed `ADVISORY`/`BINDING` poll types, `PASSED`/`FAILED` statuses and `Flat.ownershipShare`; renamed `Booking.commissionTaken` → `retentionSetAside`. Migration `20260916150000_v2_remove_voting_lending_commission` refuses to run if any ledger history, commission or voting data would be destroyed)*
- [ ] **Invariant I6:** `Account.balance` becomes a cache written only by the posting layer, with a scheduled worker asserting equality against the derived value
- [ ] **`shared/openapi.json`** generated from decorators; typed client generated; CI fails on drift
- [ ] Rate limiting on OTP and auth endpoints
- [ ] **Expose `GET /audit/verify` (pulled forward from Phase 12 — supervisor suggestion).** `AuditService.verifyChain` is built and e2e-proven but has no route. Surfacing it now — resident-callable, returns "intact" or the first divergent row — lets every client and the operator console lean on one of the four novelty claims from day one, at near-zero cost. Phase 12 keeps only the *scheduled* verification worker and the audit filter/read endpoints.
- [ ] **Move notifications out of the DB transaction (rework — supervisor suggestion).** The Phase 3 poll fire/expiry paths `await` mail dispatch *inside* the posting transaction, so a mail failure would roll back a state change that already succeeded. As notifications become cross-cutting infrastructure (RoU §5 amendment A7), dispatch must be best-effort and **post-commit** (enqueue on transaction success), never able to fail or reverse a committed money/state change.

**Definition of done:** an operator creates a society, imports 90 flats, a resident signs up by phone and is ratified, a vendor logs in with 2FA, and a payout above the upper threshold requires and collects a committee majority — with every identity on the audit chain.

---

## Phase 7 — Vendor portal and pricing cards

**Modules:** M4 (partial) · **Frontend:** F3

**Goal:** a vendor publishes an immutable, versioned pricing card that will later bind them.

- [ ] Split `Vendor` from `VendorSocietyLink` — one vendor identity, one rating aggregate, many societies
- [ ] `PricingCard`: vendor, category, version, effective from, superseded at, GST rate. **Immutable once published**
- [ ] `PricingLine`: label, basis (per visit / per hour / per unit / percentage), rate, minimum, conditions. Visit charge is a first-class line, not an implicit extra
- [ ] Card revision creates a new version; superseded versions remain readable for any engagement that froze them
- [ ] Card publication writes to the audit chain
- [ ] Vendor profile self-service: categories, service radius, bank account for settlement
- [ ] Trade licence capture alongside the existing GSTIN verification
- [ ] Operator endpoint: promote a vendor to `PLATFORM_AUDITED`

**Definition of done:** a vendor publishes a card, revises it twice, and all three versions remain independently retrievable.

---

## Phase 8 — Service requests and pooling

**Modules:** M7 · **Frontend:** F4

**Goal:** the core resident loop. A resident raises a need, neighbours join, the committee sources a vendor, the price freezes.

- [ ] `ServiceRequest`: society, raised-by flat, **origin** (resident or committee), category, description, window, threshold, status
- [ ] `Participation`: request, flat, joined at, contribution, status. An opt-in record — no weight, no choice
- [ ] Migrate the Phase 3 commitment mechanic onto these entities; retire the `Poll` naming
- [ ] **Per-category participation threshold** as society configuration, frozen onto the request at creation
- [ ] Below threshold at closing: pool lapses, contributions return
- [ ] Committee assigns a vendor from the directory. No bidding
- [ ] **Card freeze at vendor confirmation**, written to the audit chain, governing every participating flat identically
- [ ] Committee-origin requests retain the shipped Phase 4C offer path (annual contracts, festival orders)
- [ ] Notification fan-out: threshold reached, vendor assigned, vendor confirmed
- [ ] Concurrency: the advisory-lock pattern from the Phase 5 double-fire fix applies to threshold evaluation

**Definition of done:** a resident raises "AC not cooling", two neighbours join, the threshold for that category is met, the committee assigns a vendor, the vendor confirms, and all three flats hold the identical frozen card.

---

## Phase 9 — Collection, reconciliation and the bills hub

**Modules:** M11, M12 (partial) · **Frontend:** F5

**Goal:** every obligation a flat owes appears in one place and can be cleared in one session.

- [ ] `VirtualAccount` per flat — **attribution key only**, no role in authentication
- [ ] Sub-ledger partition of the master account: maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus
- [ ] Cross-pocket movement requires an explicit dual-authorised journal; no implicit sweep
- [ ] `BankStatementLine` ingestion from CSV; match by virtual account; **unmatched credits queue for treasurer review, never auto-allocated**
- [ ] Collection through the payment aggregator, settling to the society's account
- [ ] **`GET /me/bills`** — the consolidated hub. Composes maintenance, utilities, procurement contributions and event charges in **one query**, not six service calls
- [ ] Every line carries its computation basis and a link to underlying evidence
- [ ] **`GET /me/home`** — the mobile aggregate: amount due, actions needed, joinable requests, upcoming events
- [ ] Statement history per flat, exportable, verifiable against the audit chain
- [ ] Arrears ageing, configurable late fees, instalment forbearance on the society's own receivable
- [ ] Cursor pagination and `ETag` support on every list endpoint
- [ ] Server-timing headers; p95 instrumentation per endpoint

**Definition of done:** a resident sees maintenance, a procurement contribution and an event charge in one payload under 500 ms p95, and clears all three in one session.

---

## Phase 10 — Electricity and water billing

**Modules:** M5, M6 · **Frontend:** F7

**Goal:** the economic heart of the dissertation. Sub-metered recovery, apportioned common area, reconciled against the bulk invoice.

- [ ] **Worker tier** — Redis-backed queue. Billing runs are long and must be restartable
- [ ] `Meter` (flat or common), `Reading` (immutable; corrections post a reversing reading), `TariffSchedule` (JSONB, versioned by effective date), `BillingCycle`, `FlatBill`
- [ ] Pipeline, each stage idempotent and resumable: **ingest → validate → compute → apportion → reconcile → publish**
- [ ] Readings written to the audit chain **at capture**, before any computation
- [ ] Validation flags negative consumption, stalled meters, rollover, out-of-bounds values. **A flagged meter halts the cycle** rather than billing a suspect figure
- [ ] Tariff slabs, fixed charges, duty and cess applied from the schedule in force for the period
- [ ] Common-area consumption derived as bulk less the sum of sub-meters, apportioned by area factor with deterministic rounding-residue allocation
- [ ] Reconciliation against the licensee's bulk invoice; **variance published, not absorbed**
- [ ] `FlatBill.computationTrace` — formula and inputs, so the resident sees the derivation
- [ ] Configuration A (individually metered) bypasses stages 2–5: store consumer number, present bill, route through the BBPS adapter
- [ ] **Water:** `WaterSource` across municipal, tanker and borewell; blended per-kilolitre rate per cycle, published with derivation
- [ ] Partial sub-meter deployment: metered flats billed on measurement, unmetered on the fallback basis, basis recorded per bill, cross-subsidy reported

**Definition of done:** twelve months of synthetic readings produce twelve reconciled cycles; a 400-flat run completes under 60 s; any charge traces back to a reading.

---

## Phase 11 — Events, charge sheets and settlement

**Modules:** M8, M4 (remainder) · **Frontend:** F8

**Goal:** close the procurement loop, and let the committee run paid community events.

- [ ] `Event`: **committee-created only**. Title, descriptions, capacity, window, **per-flat opt-in charge**, concessions, and a refund policy **fixed at creation**
- [ ] `Registration` with waitlist and automatic promotion on release
- [ ] Collection into an event-specific sub-ledger; automatic refund on cancellation or under-subscription per the fixed policy
- [ ] Post-event settlement reconciling collections against vendor invoices; surplus disposed of per the policy already set
- [ ] `ChargeSheet`: vendor-submitted, itemised, matched line by line against the frozen card
- [ ] **Automatic variance computation** per line and in total; in-card lines pass, out-of-card lines flag
- [ ] Resident acknowledgement; dispute routes to committee adjudication with both documents as evidence
- [ ] Settlement from the relevant sub-ledger under the Phase 6 approval ladder, less any hold-back
- [ ] Dispute triage by category and amount

**Definition of done:** a vendor submits a sheet with one out-of-card line, a resident disputes it, the committee adjudicates, and settlement reflects the decision — every step on the chain.

---

## Phase 12 — Treasury, audit exposure, camps and donations

**Modules:** M12 (full), M13, M9, M10 · **Frontend:** F9

**Goal:** the society's own corpus is managed and every claim the platform makes is independently checkable.

- [ ] `FixedDeposit`: principal, rate, placed at, maturity, initiated by, approved by. **Two distinct identities**
- [ ] Sweep rule with operating-float floor and minimum tenor; balances above the floor generate a placement proposal
- [ ] Maturity ladder derived by query, distributing maturities across the year
- [ ] Interest posts to society income accounts only; **invariant I4** rejects any journal crediting interest to a flat
- [ ] ~~`GET /audit/verify` endpoint~~ — **moved to Phase 6.5** (pulled forward, supervisor suggestion). This phase assumes it already exists.
- [ ] Scheduled verification worker, alerting on divergence (the automated counterpart to the Phase 6 on-demand endpoint)
- [ ] Audit log read and filter endpoints
- [ ] `HealthCamp` and `CampRegistration` — provider receives name, flat and slot only. **Invariant I5: no field capable of holding clinical information exists**
- [ ] `DonationCampaign` and `Contribution` — internal welfare fund under dual authorisation; external pass-through recording participation only
- [ ] Anonymity toward residents supported; anonymity toward the auditor is not

**Definition of done:** the chain verifies through the API, a row tampered by raw SQL is caught at the correct sequence position, and a corpus placement requires two identities.

---

## Phase 13 — Simulation harness *(Python, offline)*

**Modules:** — · **Frontend:** reporting surface, deferred

**Goal:** the economic evaluation the dissertation cites. Rewritten — the lending scenarios are withdrawn.

- [ ] 90-flat reference society, twelve-month horizon, Monte Carlo to stable intervals
- [ ] **Bulk high-tension versus aggregate individual low-tension cost** — the principal economic result
- [ ] Sensitivity to tariff differential, common-area load fraction, and any regulatory cap on recoverable margin
- [ ] Aggregation saving on pooled requests by participation rate and category threshold, measured against published card rates. Isolates the volume effect, since vendors do not bid
- [ ] Collection-rate distribution and arrears ageing under varying payment behaviour
- [ ] Water cost volatility under seasonal tanker dependency
- [ ] Corpus sweep yield against liquidity risk — frequency with which a laddered profile fails a seasonal call
- [ ] Functional-accuracy block: billing correctness at slab boundaries, apportionment to rounding tolerance, idempotency, pricing-card binding, access-control matrix asserted exhaustively
- [ ] Reproducibility: seed, parameters and timestamp written with every run

**Definition of done:** `python -m sim run --scenario baseline` writes reproducible artefacts, and the bulk-tariff saving is reported with stable confidence intervals.

---

## Standing tasks, every phase

- Regenerate `shared/openapi.json` and the typed client on any contract change; CI fails on drift
- Every new endpoint carries a p95 measurement before the phase closes; **> 500 ms is a bug, not a tuning note**
- Every state change that matters is on the audit chain
- e2e tests run against real PostgreSQL, never a mock
- Update [SUPERVISOR.md](SUPERVISOR.md) and its demo bar on the last commit of each phase
- Any compliance invariant touched by a phase gets an explicit test asserting it still holds
