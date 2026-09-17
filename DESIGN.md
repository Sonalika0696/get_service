# Hyperlocal Trust-Graph Financial Operations Platform — Design v0.5

**Revised to V2.0 scope on 2026-09-16 — see [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).**

**Module:** MSO4992 — Dissertation in Financial Technology
**Working title:** *A Trust-Graph-Backed Financial Operations Platform for Indian Residential Societies — Pooled Procurement, Metered Utility Recovery and Compliance-by-Construction Settlement*
**Scope of build:** the financial-operations core (M1–M14). Lending, stored value and resident voting are **out of scope**, not simulated.
**Evaluation basis:** synthetic 90-flat society, twelve-month horizon (parameters exposed).
**Time boundation:** none — the design targets completeness before speed.

This document is the technical/system-side counterpart to [PRODUCT_PLAN.md](PRODUCT_PLAN.md). Where the product plan describes users, benefits, and roadmap, this one describes what has to be built. Module numbering follows the V2.0 Report of Understanding as amended in [DOC_AMENDMENTS_V2.md](DOC_AMENDMENTS_V2.md): M1–M4 establish identity and access; M5–M11 carry money; M12–M14 provide the ledger, treasury and governance substrate.

---

## 1. Core idea (one paragraph)

The society is the smallest unit of dense, verified social capital in urban India, and it already operates as a small business: it buys electricity and water in bulk, recovers them from flats, collects maintenance, pays vendors and holds a corpus. The platform treats the society as a **trust substrate** and provides the financial-operations layer on top: **(a)** pooled service procurement settled through the RWA's own bank account, **(b)** metered electricity and water recovery reconciled against the bulk invoice, **(c)** a vendor network whose pricing binds through immutable, frozen pricing cards, and **(d)** proportionate governance over every outbound payment, recorded on a hash-chained audit log. The platform holds no funds and takes no commission. The FinTech contribution defended in the dissertation is the society-account settlement design with compliance-by-construction invariants, evaluated by simulation — principally the bulk high-tension versus individual low-tension electricity saving.

---

## 1a. Novelty claims (defensible contributions)

Four claims the dissertation defends. The first is specific to this design; the others reframe well-known architectures for the community-finance setting.

1. **Compliance-by-construction invariants.** Regulatory boundaries are enforced by the schema and posting layer rather than by policy. No platform-owned account exists in the chart of accounts, so no journal can credit the platform (I2). Interest on corpus deposits cannot post to a flat (I4). No field capable of holding clinical information exists (I5). No vote, ballot or tally entity exists (I8). Every balance is derived from journal lines, with any materialised balance a rebuildable cache (I6). Each invariant carries an explicit test, so crossing a regulatory line requires a schema change visible in review.
2. **Flat-anchored trust graph.** Identity is anchored to a committee-ratified occupancy of a flat on an imported register, not to a self-asserted profile. One graph — co-residence, occupancy tenure and prior successful engagement — underlies vendor rating weighting (only signed-off jobs count), pool participation and delegation, with every edge traceable to a flat.
3. **Settlement through the society's own account.** The society's bank account, already governed by its committee under state co-operative society rules, is the settlement account, partitioned into ring-fenced sub-ledgers. Collection routes through an RBI-authorised payment aggregator holding funds in transit under its own licence; each flat's virtual account is an attribution key only. The platform is the system of record above the account and never a custodian. The dissertation build simulates the collection leg with Razorpay sandbox.
4. **Hash-chained audit trail for community finance.** Every state-changing event writes an `AuditLog` row whose `entryHash = SHA-256(previousHash || canonicalJson(row))`, covering the full logical row (timestamp, society, actor, action, subject, payload). Any modification to any past row breaks the chain from that point forward and is detectable by recomputing from the last-known-good hash. Lightweight, no blockchain, and verifiable by any resident.

Chapter 6 of the dissertation returns to each claim with its evaluation result.

---

## 2. Users and rights

| Persona | Rights | Restrictions |
|---|---|---|
| **Owner-occupier** | Bills hub and payment for the flat. Electricity and water bills with computation trace. Service requests (raise + join). Events (opt in). Health camps, donations. Vendor directory (discover, rate). Notice board. Audit-chain verification. | Phone OTP; account inactive until committee ratification against the flat register. |
| **Owner-absentee** (owner not living in the flat) | Retains the flat's financial view: bills, statements, ledger. May **delegate** operational rights (raising and joining service requests, event opt-in) to the tenant; delegation is scoped, revocable and a logged consent event. | Delegation cannot carry financial capabilities — excluded at the type level. |
| **Tenant / temporary resident** (any tenure) | Service requests (raise + join), events, vendor directory, notice board; operational rights of the flat where delegated. | No financial authority over the flat beyond what the owner's configuration permits. |
| **Society committee** | Ratifies residents. Imports the flat register. Onboards vendors. **Sources vendors** for pooled requests; opens committee-origin offers. **Creates events.** Runs billing cycles. Adjudicates disputes. Approves expenditure on the ladder. Moderates the notice board. Light approvals inbox on mobile. | Password + mandatory 2FA. Cannot see other residents' individual balances beyond aggregates. Same-identity approval rejected. |
| **Society treasurer / deputy treasurer** | Treasury view, statement ingestion and unmatched-credit review, arrears, corpus placement. Approver on rungs 2 and 3. | Cannot approve an instruction they initiated; cannot count twice. |
| **Vendor** | Own web login. Publishes versioned pricing cards. Confirms or declines assigned engagements. Submits charge sheets. Receives settlement per engagement. Portable rating record. | Password + mandatory 2FA. Cannot see resident directory; access per engagement, consent-gated. No bidding. |
| **Platform operator** | Creates societies, assigns the first committee officer, promotes vendors to `PLATFORM_AUDITED`. | No account in any society's chart of accounts; no access to resident balances. |
| **Notice-board poster** *(job blog)* | Posts a role (verified company email) or own availability, with resident attribution. | Rate-limited (default 1 post / month, society-configurable). Committee can flag and remove. |

**Rule of thumb:** financial authority follows ownership and committee office; participation in pools, events and the notice board is equal for all ratified residents. No resident votes anywhere in the product.

---

## 3. Feature catalogue

Each subsection: purpose · users · workflow · data · edge cases.

### 3.1 Identity, flat anchoring and roles *(M1, M2 — foundation)*

- **Purpose:** anchor every action to a verified principal — a resident in a ratified flat, a vendor, or an operator.
- **Users:** everyone.
- **Workflow:**
  - Operator creates the society → committee imports the flat register (CSV; area factors sum to unity within tolerance).
  - Resident signs in by phone OTP → claims a flat → committee ratifies against the register → occupancy activates, tenure clock starts.
  - Committee officers and vendors enrol password + TOTP.
  - Delegations and consents are logged, revocable events enforced at query time.
- **Data:** user (phone, name, email, status, principal kind), society, flat, occupancy, role, delegation, consent_grant, session.
- **Edge cases:** ownership transfer (occupancy closes, new ratification), tenant move-out mid-pool (participation remains the flat's), committee rotation (roles reassigned, not the user record), vendor serving several societies (one `Vendor`, many `VendorSocietyLink`).

### 3.2 Society ledger, collections and treasury *(M12 — financial backbone)*

- **Purpose:** every rupee is the society's; the platform never becomes the fund-holder.
- **Users:** committee (aggregates), treasurer (reconciler, approver), everyone (their own flat's view).
- **Workflow:**
  - Collection through the payment aggregator (Razorpay sandbox / UPI collect), settling to the society's bank account.
  - Ledger is double-entry, append-only, idempotency-keyed, partitioned into sub-ledgers: maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus.
  - Bank statement lines ingested and matched by the flat's virtual account; unmatched credits queue for treasurer review.
  - Cross-pocket movements, payouts and corpus placements route through the approval ladder (§3.9).
  - Arrears ageing, configurable late fees, instalment forbearance on the society's own receivable.
  - Corpus sweep: balances above the operating-float floor generate a fixed-deposit placement proposal; maturities laddered; interest posts to society income only.
- **Data:** account (society-owned or external only), journal_entry / ledger_line, virtual_account, bank_statement_line, payment, payout, payout_authorisation, fixed_deposit.
- **Edge cases:** statement mismatch (freeze affected payouts, alert committee), duplicate webhook (idempotency key), approver unavailable (deputy treasurer counts toward the ladder), stored balance drift (scheduled worker asserts cache equals derived balance).

### 3.3 Consolidated bills hub *(M11)*

- **Purpose:** one payable view per flat.
- **Users:** residents.
- **Workflow:** one aggregate read composes maintenance, electricity, water, pooled-request contributions and event charges; each line carries its computation basis and evidence link; pay in one session; statement exportable and verifiable against the chain.
- **Data:** a read model over flat_bill, participation contributions, registrations and maintenance dues.
- **Edge cases:** partial payment (allocated by due date, recorded per line), a bill revised after publication (reversing entry, both visible).

### 3.4 Electricity billing *(M5)*

- **Purpose:** recover the bulk supply from flats on measured consumption, reconciled to the invoice.
- **Users:** committee (runs), residents (read).
- **Workflow:** ingest readings → validate (negative, stalled, rollover, out-of-bounds; a flag halts the cycle) → compute slabs, fixed charges, duty and cess from the tariff schedule in force → apportion common area by area factor with deterministic residue allocation → reconcile against the bulk invoice, publishing variance → publish flat bills with computation trace. Each stage idempotent and resumable, run on the worker tier.
- **Data:** meter (flat / common), reading (immutable, audit-chained at capture), tariff_schedule (versioned by effective date), billing_cycle, flat_bill (computation_trace).
- **Edge cases:** individually metered society (bypass apportionment; present bill; BBPS adapter), partial sub-meter deployment (fallback basis recorded per bill, cross-subsidy reported), meter replacement mid-cycle (closing and opening readings).

### 3.5 Water billing *(M6)*

- **Purpose:** recover water cost across municipal, tanker and borewell supply.
- **Workflow:** per-cycle cost pool by source → blended per-kilolitre rate with published derivation → metered flats billed on measurement, unmetered on fallback basis.
- **Data:** water_source, source_cost, blended_rate, flat_bill.
- **Edge cases:** tanker-season spikes (reported, not smoothed silently), borewell outage.

### 3.6 Service requests and pooling *(M7 — core loop)*

There is no individual booking. Two entry points, one engine.

**Resident-initiated request**
- Resident raises: category, description, preferred window. Visible to the society.
- Neighbours with the same need **join** (an opt-in `Participation`, no weight, no choice).
- Participation threshold read from per-category configuration and **frozen onto the request at creation**.
- Viable pool → **committee assigns a vendor** from the directory (no bidding) → vendor confirms and proposes a window → **card freezes against the pool**, audit-chained, pushed to every participant.
- Below threshold at closing → pool lapses, contributions returned.

**Committee-initiated offer**
- Committee opens procurement on the society's behalf (annual contracts, festival bulk orders, seasonal tanker supply). Retains the shipped offer path and its discount ladder; the applied tier is snapshotted when the offer fires.

**Common**
- Contributions post to the procurement-escrow sub-ledger.
- Job card per participating flat; per-flat sign-off.
- Large jobs above a society-set threshold: milestone settlement with defect-liability retention.
- Settlement on confirmed delivery and charge-sheet acknowledgement, under the approval ladder, less dispute hold-back.
- Concurrency: threshold evaluation serialised with an advisory lock (the Phase 5 double-fire fix).

- **Data:** service_request (origin, category, window, threshold, status), participation, offer, booking, job_card, milestone, payout.
- **Edge cases:** raiser withdraws after others join (request survives while above threshold), vendor declines (committee reassigns), vendor no-show (refund from sub-ledger + rating penalty), partial completion (per-card sign-off), disputed line (hold-back).

### 3.7 Vendor directory, pricing cards and charge sheets *(M4)*

- **Purpose:** the directory the committee sources from, and the mechanism by which vendor prices bind.
- **Users:** vendor, resident, committee, operator.
- **Workflow:**
  - Vendor onboards: location, service radius, categories, GSTIN, trade licence, settlement bank account.
  - **GSTIN verification** via `gstinapi.in` free tier at onboarding — an Active result auto-promotes `UNVERIFIED` → `SOCIETY_ATTESTED`. Operator promotes to `PLATFORM_AUDITED`.
  - **Pricing card** per category: lines with basis (per visit / hour / unit / percentage), rate, minimum, conditions, GST rate. Immutable once published; revisions version; superseded versions remain readable.
  - **Charge sheet** after work: itemised, matched line by line to the frozen card; per-line and total variance computed; out-of-card lines flagged; participants acknowledge or dispute.
  - Ratings post-job, weighted by signed-off completion.
- **Data:** vendor, vendor_society_link, pricing_card, pricing_line, charge_sheet, charge_line, vendor_rating.
- **Edge cases:** rating rings (only signed-off jobs count), false verification (tier withdrawal, logged), card revised between assignment and confirmation (freeze takes the version current at confirmation).

### 3.8 Events *(M8)*

- **Purpose:** paid cultural and community events.
- **Workflow:** **committee creates** with title, descriptions, capacity, registration window, **per-flat opt-in charge**, concessions and a **refund policy fixed at creation** → residents opt in and pay into the event sub-ledger → waitlist with automatic promotion → automatic refund on cancellation or under-subscription per the fixed policy → post-event settlement against vendor invoices, surplus disposed of per policy.
- **Data:** event, registration, refund.
- **Edge cases:** capacity change after opt-ins (waitlist promotion only upward), cancellation (policy applies mechanically; no discretion).

### 3.9 Governance, approvals and disputes *(M14)*

- **Purpose:** control of expenditure, not collection of opinion.
- **Users:** committee, treasurer, any resident (disputes).
- **Workflow:**
  - An officer initiates an instruction (payout, cross-pocket journal, corpus placement); the required approval count is derived from the amount:

    | Rung | Condition | Authorisation |
    |---|---|---|
    | 1 | Below lower threshold | Single officer |
    | 2 | Above lower threshold | Two officers of distinct identity |
    | 3 | Above upper threshold | Configurable majority of the committee roster |

  - Approvals accumulate; initiator and repeat identities are rejected; execution blocked until the count is met.
  - Disputes on charge-sheet lines: automated triage by category and amount recommends a resolution; committee adjudicates with card and sheet as evidence.
  - Every instruction, approval, rejection and adjudication written to the audit chain with the acting identity.
- **Data:** payout_authorisation (N approvers), approval_policy (thresholds, majority fraction), dispute_case, dispute_events[].
- **Edge cases:** committee turnover mid-approval (roster at initiation governs the majority), conflict of interest (an officer who is party to a dispute cannot adjudicate it), roster too small to form a majority (instruction cannot execute; surfaced to the committee).

### 3.10 Health camps and donations *(M9, M10)*

- **Health camps:** camp, camp_registration. Provider receives name, flat and slot only. **Invariant I5** — no field capable of holding clinical information.
- **Donations:** donation_campaign, contribution. Internal welfare fund under dual authorisation; external pass-through recording participation only. Anonymity toward residents supported; not toward the auditor.

### 3.11 Notice board *(job blog — non-financial)*

- **Purpose:** moderated bulletin board for hyperlocal hiring and availability posts.
- **Workflow:** post with resident name + flat + society attribution; hiring posts require verified company email; rate limit 1 post / resident / month (configurable); committee flag / remove; browsing scoped to the society.
- **Data:** post, poster_identity, company_email_verification, flags[], moderation_events[].
- **Edge cases:** impersonation (residency + email both required), spam (rate limit + flag), stale posts (auto-archive after N days).

### 3.12 Cross-cutting concerns

- **Notifications.** Infrastructure, delivered with the feature that raises them: push to the resident app with email and SMS fallback, per-resident preferences, quiet hours, and a logged committee-only emergency broadcast.
- **Consent ledger.** Every disclosure or access is logged and revocable, enforced at query time; sub-meter readings are treated as personal data because they reveal occupancy.
- **Hash-chained audit trail (M13).** Every state change writes an `AuditLog` row with `previousHash` and `entryHash`. A verification endpoint callable by any resident recomputes the chain and reports the first divergence; a scheduled worker alerts on divergence. Novelty claim §1a.4.
- **Role-based access control.** Enforced at API layer (guards on every endpoint), business-logic layer (state-machine guards on every transition), and database layer (society scope) — defence in depth. Principals are `RESIDENT | VENDOR | OPERATOR`.
- **Trust graph and hard rules.** The flat-anchored trust graph (§1a.2) informs rating weighting and participation; it never replaces a hard rule. Caps, thresholds and approval counts are always primary.
- **Anti-fraud triage.** Automated first-pass triage on disputes with committee-confirmed final call.
- **Performance.** p95 < 500 ms on read endpoints; one aggregate request per primary mobile screen; a 400-flat billing run under 60 s on the worker tier.

---

## 4. Money flow diagrams (narrative)

### 4.1 Pooled request (small ticket)
```
Resident raises request --> neighbours join --> category threshold met
Committee assigns vendor --> vendor confirms --> pricing card frozen against pool (audit-chained)
Participants (N) --pay via aggregator--> society account (procurement-escrow sub-ledger)
Vendor completes each job card --> per-flat sign-off
Vendor submits charge sheet --> variance flagged --> participants acknowledge (or dispute -> committee)
Approval ladder (rung by amount) --> single settlement to vendor, less any hold-back
No platform deduction at any step.
```

### 4.2 Pooled request (large ticket)
```
Committee-origin offer or pooled request above large-job threshold
Approval ladder authorises the engagement
Milestone 1 (start): 30% settlement
Milestone 2 (midpoint sign-off): 40% settlement
Milestone 3 (final sign-off, less defect-liability retention): 30% settlement
Retention released after the defect-liability window, under the ladder
```

### 4.3 Electricity billing cycle
```
Sub-meter + common-area readings --> audit chain at capture
Validate --> any flag halts the cycle for committee review
Compute slabs from tariff schedule in force
Common area = bulk - sum(sub-meters) --> apportioned by area factor
Reconcile sum(flat bills) against licensee bulk invoice --> variance published
Flat bills published to bills hub --> residents pay via aggregator --> electricity sub-ledger
Society pays licensee from electricity sub-ledger under the ladder
```

### 4.4 Collection and reconciliation
```
Flat obligation (bills hub) --> aggregator (UPI collect) --> settles to society bank account
Payment webhook (idempotent) --> ledger posting to the relevant sub-ledger
Bank statement line --> matched by the flat's virtual account (attribution key)
Unmatched credit --> treasurer review queue (never auto-allocated)
```

### 4.5 Corpus placement
```
Corpus balance above operating-float floor --> sweep rule proposes FD placement
Approval ladder (two distinct identities minimum) --> placement executed at the society's bank
Maturity ladder derived by query
Interest --> society income account only (I4: never a flat)
```

---

## 5. System-level design themes

*Stack commitments live in [ARCHITECTURE.md](ARCHITECTURE.md); this section stays at the level of principle.*

### 5.1 Data model themes
- Society is the tenant boundary; every society record is society-scoped.
- Vendors and operators are principals without an occupancy; identity must not be resolved through the flat.
- The ledger is the source of truth for money; every balance is derived (I6).
- Readings, pricing cards, journal lines and audit rows are immutable; corrections are new rows.

### 5.2 Trust model themes
- All authorisation is role + rule based.
- The trust graph is a *feature* used inside rules, not a replacement for them.
- Consent is granular and revocable; every access to another resident's data is a logged event.

### 5.3 Integration themes
- Payment aggregator is a *partner*, not a re-build. Platform never holds funds.
- Bank statement ingestion is a first-class citizen (reconciliation depends on it).
- BBPS adapter for individually metered electricity.
- Communication channels (push, SMS, email) are pluggable providers.

### 5.4 Simulation harness themes
- Runs on synthetic society data with parameterised distributions; 90 flats, twelve months.
- Scenarios: bulk HT vs individual LT electricity cost (principal result) and its sensitivity; pooled-request aggregation saving; collection rates and arrears; water cost volatility; corpus sweep yield vs liquidity.
- Monte Carlo sampling to stable intervals; outputs reproducible with a seed.

### 5.5 Compliance themes
- **Payment Aggregator framework:** collection via an RBI-authorised aggregator holding funds in transit under its own licence; no platform-owned account (I2).
- **RBI NBFC-P2P framework:** lending out of scope. A platform matching lenders and borrowers requires ₹2 crore net owned funds; the 16 August 2024 revisions prohibit closed-user-group matching and cap aggregate lender exposure at ₹50 lakh. A single-society lending feature cannot satisfy these, so none is built.
- **State Money Lenders Acts:** systematic platform-facilitated lending would require a state licence — a further reason for exclusion.
- **PSS Act 2007:** no wallet, voucher or stored-value instrument exists, so the prepaid-instrument boundary is not approached.
- **DPDP Act 2023:** society as Data Fiduciary, platform as Processor; consent enforced at query time; no health data (I5).

---

## 6. What is deliberately out of scope for V2.0

- No lending, credit or deferred-payment product of any kind.
- No wallet, vouchers, society coupons or stored value.
- No resident voting — advisory or binding — and no weighted tallies.
- No individual service bookings; no vendor bidding.
- No commission; no referral incentives or commission-bearing hiring portal.
- No ROSCA / chit-group module; no group insurance module; no CSR sponsorship implementation.
- No security / visitor / gate module.
- No health information stored.

Clients are in scope: a native React Native + Expo resident app and a Next.js management web app for committee, vendor and platform operator.

Full rationale in [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §4-§5.

---

## 7. Future features (documented, not built)

Mirrors [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §5:

1. Direct bank transfer to the flat's virtual account as a collection rail.
2. Digital ROSCA / chit-group module (via registered chit-company partner).
3. Group insurance module (via IRDAI-licensed partner).
4. CSR-sponsored inclusion programme (Section 135, Companies Act 2013).
5. Web fallback for residents (open question).
6. Multi-society network features and inter-society procurement.
7. Embedded module / SDK inside MyGate / ApnaComplex / ADDA.

---

## 8. Architectural decisions (locked)

Documented here so downstream docs can be re-derived from a single source.

1. **Client surfaces:** native React Native + Expo resident app; Next.js (App Router) management web app for committee, vendor and platform operator.
2. **PA integration:** Razorpay sandbox (UPI collect), settling to the society's account.
3. **Synthetic society scale:** 90 flats.
4. **Simulation horizon:** 12 months.
5. **Dispute automation depth:** automated triage + committee-confirmed final call.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the stack, service boundaries, data model and API surface derived from these choices.
