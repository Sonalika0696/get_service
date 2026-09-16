# Product Plan — GateX Platform (working name: *tbc*)

**Revised to V2.0 scope on 2026-09-16 — see [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).**

**Status:** Final for dissertation build scope (V2.0). Synthetic-data evaluation only. No time boundation on delivery.

---

## 1. Product vision

A residential society is the smallest unit of high-trust, geographically dense economic activity in urban India. It is also, in most cases, a small business run on spreadsheets and WhatsApp: it buys electricity and water in bulk, recovers them from flats, collects maintenance, pays vendors, and holds a corpus — with little structure and less audit. This product is the **financial-operations layer** for that business, built on four primitives:

1. **Coordinated buying power** — many small residents becoming one large customer through pooled service requests, with the society's own bank account (and a ring-fenced sub-ledger within it) as the settlement layer.
2. **Metered, reconciled utility recovery** — electricity and water billed from sub-meter readings against published tariffs, common-area load apportioned transparently, and every cycle reconciled against the bulk invoice.
3. **A transparent, accountable vendor network** — vendors publish immutable pricing cards, the card freezes against a pool at confirmation, and any departure on the charge sheet is flagged automatically.
4. **Proportionate, tamper-evident governance** — a three-rung approval ladder on every outbound payment and corpus movement, written to a hash-chained audit log that any resident can verify.

The platform **holds no funds and takes no commission**. Collection runs through an RBI-authorised payment aggregator settling to the society's bank account; platform revenue is a vendor listing/subscription fee contracted outside the society's money rails.

The FinTech contribution defended in the dissertation is the **society-account settlement design with compliance-by-construction invariants**, and the **economic evaluation of collective procurement** — principally bulk high-tension versus individual low-tension electricity cost — on a synthetic 90-flat society with sensitivity analysis. Alongside these, the design contributes two reframed novelty claims — a **flat-anchored trust graph** and a **hash-chained audit trail** for community finance — both documented in [DESIGN.md](DESIGN.md) §1a.

---

## 2. Target users (personas)

### 2.1 Owner-occupier *(primary user)*
- **Profile:** owns the flat and lives in it; long-term stake in the society; typical age 30-60.
- **What they get:** the resident app — consolidated bills hub, electricity and water bills with their computation trace, service requests (raise and join), events, health camps, donations, vendor directory, notice board, and the audit-chain verification view.
- **What they give:** phone number, flat claim ratified by the committee, on-time payment of the flat's obligations.
- **Primary benefit:** every rupee the flat owes is in one place with its derivation visible, and household services cost less because neighbours pool demand against a published card.

### 2.1a Owner-absentee *(owner who lets the flat to a tenant)*
- **Profile:** owns the flat but does not live in it; a tenant occupies the flat and handles day-to-day matters.
- **What they get:** retains the flat's *financial* view — bills, statement history, the flat's ledger. May **delegate** *operational* rights (raising or joining service requests, event opt-in on the flat's behalf) to the tenant. Delegation is scoped, revocable, logged as a consent event, and excludes financial capabilities at the type level.
- **Primary benefit:** stays in control of the flat's money from a distance without managing day-to-day service coordination.

### 2.2 Tenant / temporary resident
- **Profile:** rents in the society; typical urban rental cycle 11-24 months.
- **What they get:** service requests, events, vendor directory, notice board, and — where delegated by the owner — the operational rights of the flat.
- **Primary benefit:** cheaper, better-documented household services, plugged into the neighbourhood without needing an owner introduction.

### 2.3 Society committee / admin
- **Profile:** elected residents managing the RWA.
- **What they get:** the management web app — resident ratification queue, flat register import, vendor onboarding and moderation, service-request queue and vendor sourcing, event creation, billing-cycle runs, dispute adjudication, aggregated financials (never another resident's individual balance). Committee members also get a **light approvals inbox** in the resident app for time-sensitive approvals.
- **What they do:** approve expenditure under the three-rung ladder; set per-society configuration (approval thresholds, committee majority fraction, per-category participation thresholds, late fees).
- **Benefit:** cleaner accounting than the spreadsheet-and-WhatsApp workflow; AGM financial statement derivable from the ledger.

### 2.4 Society treasurer and deputy treasurer
- **Profile:** committee members with signing authority on the RWA bank account.
- **What they get:** treasury view — sub-ledger balances reconciling to the bank balance, bank-statement ingestion with an unmatched-credit review queue, arrears ageing, corpus fixed-deposit placement with maturity ladder.
- **Benefit:** audit trail replaces trust. Two-distinct-identity approval closes the classic RWA fraud vector.

### 2.5 Vendor
- **Profile:** local plumbers, electricians, AC technicians, painters, grocers, deep-cleaners, AMC providers, tanker suppliers. Small businesses or individuals within a defined service radius.
- **What they get:**
  - Their own web login (password + mandatory 2FA), one identity across every society they serve.
  - Publish versioned, immutable **pricing cards** per category.
  - An engagement queue: confirm or decline pooled requests the committee assigns to them.
  - Submit itemised charge sheets against the frozen card; receive one settlement per pooled engagement.
  - A portable rating and record that follows them across societies.
- **What they give:** GSTIN and trade licence, a listing/subscription fee, rating exposure.
- **Benefit:** much lower customer-acquisition cost than JustDial / UrbanCompany. One visit day = many jobs, and no fight for search ranking.

### 2.6 Platform operator
- **Profile:** the platform's own staff.
- **What they get:** operator console — society onboarding, first committee officer assignment, vendor promotion to `PLATFORM_AUDITED`.
- **What they never get:** any account in a society's chart of accounts.

### 2.7 Notice-board poster *(job blog)*
- **Profile:** any resident with a role to fill or their own availability to advertise.
- **What they get:** a moderated bulletin-board post inside the society, with resident attribution and, for hiring posts, a verified company email.
- **Benefit:** a trusted, hyperlocal notice board. It is **non-financial** — no referral incentives, no matching engine, no payouts.

### 2.8 Researcher / dissertation reader *(dissertation context)*
- **Not a product user**, but a stakeholder for the deliverable.
- **What they get:** a working prototype of the financial-operations core, a simulation harness quantifying the collective-procurement and utility-recovery economics, and a regulatory analysis explaining both what is built and what is deliberately excluded.

---

## 3. Features — built in V2.0

Each feature: **who uses it → what it does → how it works → what benefit it delivers → what revenue it drives (if any)**.

### 3.1 Identity, flat anchoring and roles *(M1, M2 — foundation)*

- **Users:** everyone.
- **What it does:** anchors every resident account to a ratified flat, an occupancy role (owner-occupier / owner-absentee / tenant), a tenure clock and a consent ledger; gives vendors and operators an identity that does not depend on a flat.
- **How it works:**
  - Platform operator creates the society; the committee imports the **flat register** by CSV (area factors validated to sum to unity).
  - Residents sign in with **phone OTP**. A new account claims a flat and stays pending until the **committee ratifies** it against the imported register — closing the phantom-resident vector.
  - Committee officers and vendors authenticate with **password + mandatory 2FA**.
  - Principal kinds: `RESIDENT`, `VENDOR`, `OPERATOR`.
  - Consent ledger: every vendor access and every disclosure is a logged, revocable consent event, enforced at query time.
  - No mandatory government identifier for residents.
- **Benefit:** every downstream feature can *safely* trust "this user is who they say they are, in this flat, in this society, right now."
- **Revenue:** none directly; enables everything.

### 3.2 Society ledger, collections and treasury *(M12 — financial backbone)*

- **Users:** committee, treasurer (write); everyone (their own flat's view).
- **What it does:** every rupee is the society's; the platform is a system of record, never a custodian.
- **How it works:**
  - Collection runs through an **RBI-authorised payment aggregator** (Razorpay sandbox, UPI collect in the build), which holds funds in transit under its own licence and settles to the **society's bank account**.
  - Each flat holds a **virtual account number as an attribution key only** — it identifies the flat against an obligation or inbound credit, is not a payment rail in this revision, and plays no part in authentication.
  - The platform runs an append-only **double-entry ledger** over that account, partitioned into sub-ledgers: maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus. Cross-pocket movement requires an explicit dual-authorised journal.
  - Bank-statement ingestion matches credits by virtual account; **unmatched credits queue for treasurer review, never auto-allocated**.
  - Arrears ageing, configurable late fees and instalment forbearance on the society's own receivable.
  - **Corpus treasury:** a sweep rule with an operating-float floor proposes fixed-deposit placements; maturities are laddered across the year; interest posts to society income only.
- **Benefit:**
  - No fund-holding by the platform, so no payment-aggregator authorisation is engaged by the platform itself.
  - Auditable, tamper-evident finances — replaces "the treasurer's Excel sheet".
- **Revenue:** none. The platform holds no account in the society's chart of accounts.

### 3.3 Consolidated bills hub *(M11)*

- **Users:** residents.
- **What it does:** one payable view per flat — maintenance, electricity, water, pooled-request contributions and event charges — ordered by due date and clearable in one session.
- **How it works:** a single aggregate read composes every obligation; each line carries its **computation basis** and a link to the underlying evidence (meter reading, apportionment formula, pooled request, frozen card). Statement history is exportable and verifiable against the audit chain.
- **Benefit:** residents stop reconciling six separate notices; disputes start from evidence, not recollection.
- **Revenue:** none.

### 3.4 Electricity billing *(M5 — the economic heart)*

- **Users:** committee (runs cycles); residents (read bills).
- **What it does:** recovers a bulk (typically high-tension) electricity supply from flats on measured consumption.
- **How it works:**
  - Sub-meters per flat and common-area meters; readings are immutable and written to the audit chain **at capture**; corrections post a reversing reading.
  - Pipeline: ingest → validate → compute → apportion → reconcile → publish. Validation flags negative consumption, stalled meters, rollover and out-of-bounds values; **a flagged meter halts the cycle**.
  - Tariff slabs, fixed charges, duty and cess applied from the versioned tariff schedule in force.
  - Common-area consumption (bulk less sum of sub-meters) apportioned by area factor with deterministic rounding-residue allocation.
  - Reconciliation against the licensee's bulk invoice — **variance published, not absorbed**.
  - Individually metered societies bypass apportionment: the bill is presented and routed through a BBPS adapter.
- **Benefit:** residents see the formula and inputs behind their bill; the committee can show that recovery matches the invoice.
- **Revenue:** none.

### 3.5 Water billing *(M6)*

- **Users:** committee, residents.
- **What it does:** recovers water cost across municipal supply, tanker purchases and borewell operation.
- **How it works:** a per-cycle cost pool across the three sources yields a **blended per-kilolitre rate**, published with its derivation. Metered flats are billed on measurement; unmetered flats on a recorded fallback basis, with the resulting cross-subsidy reported.
- **Benefit:** tanker-season cost spikes are explained rather than argued about.
- **Revenue:** none.

### 3.6 Service requests and pooled procurement *(M7 — the core resident loop)*

There is **no individual service booking**. Every vendor engagement is pooled. Two entry points converge on the same pool, engagement and settlement path.

**Resident-initiated request**
- **Users:** any resident (raises); neighbours (join); committee (sources the vendor); vendor (confirms).
- **What it does:** a resident raises a need — *"AC not cooling"*, a plumbing leak, a pest problem — with category, description and preferred window. Neighbours facing the same problem **join** it. Joining is an opt-in record, not a vote.
- **How it works:**
  - A **participation threshold configured per service category** (frozen onto the request at creation) decides viability: an emergency plumbing call may proceed at one participant, a bulk grocery order at fifteen.
  - Below threshold at the closing date the pool lapses and any contributions are returned.
  - Once viable, **the committee sources the vendor** from the directory. There is no vendor bidding.
  - The vendor confirms and proposes a window; **the pricing card freezes against the pool** at confirmation, is written to the audit chain, and is pushed to every participant.

**Committee-initiated offer**
- **Users:** committee (opens); residents (commit).
- **What it does:** top-down procurement on the society's behalf — an annual lift AMC, a festival bulk order, seasonal tanker supply. Retains the shipped offer path, including its discount ladder with the applied tier snapshotted when the offer fires.

**Common properties**
- Participants pay into the **procurement-escrow sub-ledger** of the society's account; the society holds the funds as agent for its members under its bye-laws.
- **Job card** is the atomic unit — one flat's worth of work, signed off by that flat.
- **Large jobs** above a society-set threshold settle in milestones (e.g. 30% / 40% / 30%) with defect-liability retention.
- Release to the vendor follows confirmed delivery and charge-sheet acknowledgement, under the approval ladder (§3.10), less any dispute hold-back.
- **Benefit for residents:** a volume price against a published card, a coordinated visit day, and a price no neighbour can be quoted differently for identical work.
- **Benefit for vendor:** many jobs in one visit day; near-zero acquisition cost per job.
- **Revenue:** none from the transaction. The saving arises from aggregation alone.

### 3.7 Vendor directory, pricing cards and charge sheets *(M4 — the transparency layer)*

- **Users:** vendors (publish, confirm, invoice); residents (discover, rate, acknowledge); committee (onboard, adjudicate); operator (audit tier).
- **What it does:** the directory the committee sources from, and the mechanism that makes vendor pricing binding.
- **How it works:**
  - Vendor onboards with location, service radius, categories, **GSTIN** and trade licence. **GSTIN verification** via the free `gstinapi.in` endpoint; an Active result auto-promotes `UNVERIFIED` → `SOCIETY_ATTESTED`. The operator promotes to `PLATFORM_AUDITED`.
  - One vendor identity links to many societies, with one rating aggregate.
  - **Pricing cards** are versioned and immutable once published: visit charge, labour basis, materials handling, minimum charge, GST rate, conditions per line. A revision creates a new version; superseded versions stay readable for any engagement that froze them.
  - On completion the vendor submits an itemised **charge sheet** against the frozen card. Out-of-card lines are **flagged automatically** and require participant acknowledgement, or committee adjudication if disputed.
  - Vendor cannot see the resident directory; access is per-engagement and consent-gated.
  - Ratings: post-job numeric rating plus optional comment. Numeric ratings stay — tier promotion to community-rated depends on them.
- **Benefit for residents:** the undisclosed or retrospectively inflated visit charge is eliminated structurally.
- **Benefit for vendors:** portable reputation across societies.
- **Revenue:** **vendor listing / subscription fee** — the platform's only revenue stream (§6).

### 3.8 Events *(M8)*

- **Users:** committee (creates); residents (opt in).
- **What it does:** paid cultural and community events.
- **How it works:** **events are created by the committee only.** At creation the committee fixes title and descriptions, capacity, registration window, a **per-flat opt-in charge**, concessions, and a **refund policy fixed at creation** that cannot be varied afterwards. Residents opt in and pay into an event sub-ledger; waitlist with automatic promotion; automatic refund on cancellation or under-subscription per the fixed policy; post-event settlement against vendor invoices.
- **Benefit:** no discretionary refund arguments when an event is cancelled.
- **Revenue:** none.

### 3.9 Health camps and donations *(M9, M10 — deliberately minimal)*

- **Health camps:** committee arranges a provider; residents register. The provider receives name, flat and slot only. **No health data is ever stored** — no schema field can hold clinical information.
- **Donations:** internal welfare-fund campaigns under dual authorisation; external pass-through campaigns record participation only. Anonymity toward residents is supported; anonymity toward the auditor is not.
- **Revenue:** none.

### 3.10 Governance, approvals, disputes and audit *(M14, M13)*

- **Users:** committee, treasurer, any resident (can dispute a charge-sheet line and verify the audit chain).
- **What it does:** controls expenditure and records accountability. There is **no resident voting surface**.
- **How it works:**
  - **Three-rung approval ladder** on every outbound payment and every corpus movement:
    - Rung 1, below the lower threshold — a single committee officer.
    - Rung 2, above the lower threshold — **two officers of distinct identity**; same-identity approval is rejected.
    - Rung 3, above the upper threshold — a **configurable majority of the committee roster**.
  - Thresholds and the majority fraction are per-society configuration, so a bye-law amendment is a data change.
  - **Disputes:** a resident disputes a charge-sheet line; automated triage by category and amount; final adjudication by the committee, recorded to the chain.
  - **Hash-chained audit log:** every state change writes an `AuditLog` row whose SHA-256 hash chains from the previous row. Every instruction, approval and rejection carries the acting identity. A verification endpoint callable by any resident reports "intact" or the first divergent row.
- **Benefit:** replaces WhatsApp politics with structured process; tamper-evident records suitable for external audit.
- **Revenue:** none directly; a compliance backbone.

### 3.11 Notice board *(job blog — non-financial)*

- **Users:** any resident.
- **What it does:** a moderated bulletin board where residents post roles they are hiring for or their own availability.
- **How it works:** poster's real resident name + flat + society is always shown; hiring posts additionally require a verified company email; rate-limited (1 post / resident / month, society-configurable); committee can flag and remove.
- **Benefit:** a trusted hyperlocal notice board. No incentives, no matching, no money.
- **Revenue:** none.

### 3.12 Notifications *(cross-cutting infrastructure)*

- **Users:** everyone.
- **What it does:** delivered alongside the feature that raises them — bill published, payment confirmed, arrears reminder, pool threshold reached, vendor confirmed, pricing card frozen, approval pending.
- **How it works:** push to the resident app with email and SMS fallback; per-resident preferences and quiet hours; an emergency broadcast path restricted to committee officers, bypassing quiet hours, and logged.
- **Benefit:** engagement without spam.

---

## 4. Non-goals for V2.0

These decisions are deliberate. They keep scope honest.

- **No lending of any kind** — no peer-to-peer lending, no micro-lending, no credit or deferred-payment product. *Why:* a platform matching lenders and borrowers is an NBFC-P2P under the RBI Master Direction (2017, revised 16 August 2024), requiring ₹2 crore net owned funds; the 2024 revisions prohibit matching within a closed user group — which is exactly what a single society is — and cap aggregate lender exposure at ₹50 lakh across platforms. State Money Lenders Acts add a second layer. The analysis of why lending cannot sit inside a society platform is retained as a dissertation contribution; the feature is not.
- **No wallet, vouchers, society coupons or stored value.** No cash-convertible balance exists in the schema. *Why:* stored value engages the Payment and Settlement Systems Act 2007 prepaid-instrument boundary.
- **No resident voting** — no advisory polls, no binding general-body polls, no weighted tallies. Governance is the committee approval ladder.
- **No individual service bookings.** Every vendor engagement is a pooled request.
- **No vendor bidding.** The committee sources vendors against published pricing cards.
- **No commission** or any platform cut of a resident payment, pooled contribution or vendor settlement.
- **No referral incentives, referral matching or commission-bearing hiring portal.** The notice board is non-financial.
- **No LinkedIn OAuth / professional-graph ingestion.**
- **No health information stored**, ever.
- **No digital ROSCA / chit fund**, no group insurance, no CSR partnerships in the build scope.
- **No security / visitor / gate management.** MyGate/NoBrokerHood own that; we sit beside, not compete.
- **No family-member sub-accounts.** One user per role per flat; households manage sharing outside the app.

Client delivery is **in scope**: a native React Native + Expo app for residents, and a Next.js web app for committee, vendor and platform operator.

---

## 5. Future plans (deferred, documented, not built)

### 5.1 Direct transfer to the flat's virtual account
- Collection by bank transfer to the per-flat virtual account, alongside the payment aggregator. Deferred, not deleted: the virtual account already exists as the attribution key.

### 5.2 Digital ROSCA / chit-group module
- 6-20 person rotating savings inside a society.
- Would operate only via partnership with a registered chit company under the Chit Funds Act 1982, and would need the same closed-user-group analysis that excluded lending.

### 5.3 Group insurance
- Domestic-help accident and health cover underwritten across the society.
- Operates via an IRDAI-licensed partner (corporate agent, web aggregator, or POSP model).

### 5.4 CSR-sponsored inclusion programme
- Career pathways for domestic-worker children (internships, tuition, mentorship); career-break re-entry for resident women.
- Corporate sponsor funds it under Section 135 of the Companies Act 2013; platform provides impact reporting.

### 5.5 Web fallback for residents
- Open question: whether residents who prefer a desktop (for instance elderly residents) need a web door into the resident experience.

### 5.6 Multi-society network effects
- Vendor reputation portable across societies (the vendor identity model already supports it).
- Inter-society procurement for very high-ticket infrastructure (society-wide solar, EV charging).

### 5.7 API / SDK / integration mode
- Offer the financial-operations features as an embedded module inside MyGate / ApnaComplex / ADDA via SDK. Solves the distribution problem.

---

## 6. Revenue model (dissertation-relevant, not implemented)

The platform earns through a **vendor listing and subscription fee**, charged to vendors for directory presence and the ability to publish pricing cards. The fee is contracted and settled entirely outside the society's money rails.

| Stream | Timing | Modelled? |
|---|---|---|
| Vendor listing / subscription fee | V2.0 | Yes — the only revenue stream |
| Vendor platform-audited tier (part of the subscription) | V2.0 | Optional in eval |
| Insurance aggregator income via licensed partner | future | Discussed, not modelled |
| CSR sponsorship of inclusion programme | future | Discussed, not modelled |

No commission is taken from any resident payment, pooled contribution or vendor settlement. The platform therefore holds no account in the society's chart of accounts, which is what makes the no-fund-holding invariant enforceable by construction rather than by policy.

**Design tension, stated openly:** the platform earns from the party whose pricing it exists to make transparent. The mitigation is structural — cards are immutable once published, the freeze is enforced at confirmation, and variance detection is automatic — so revenue cannot influence the transparency mechanism without a schema change visible in review.

Platform viability is discussed against vendor adoption and listing-fee level. The dissertation's principal economic results, however, are the society-side savings in §7 — not platform revenue.

---

## 7. Success metrics *(dissertation deliverable)*

- **Technical demonstration**
  - End-to-end pooled request on a synthetic 90-flat society: raise → join → committee sources vendor → card freeze → charge sheet with variance → acknowledgement → settlement under the approval ladder.
  - Twelve months of synthetic readings produce twelve reconciled electricity cycles; a 400-flat billing run completes in under 60 s.
  - Zero-loss ledger conservation across the simulated horizon.
  - Role-based access enforced across all built features (access-control matrix asserted exhaustively).
  - Hash-chained audit log verified end-to-end through the API, including detection of a row tampered by raw SQL.
  - p95 < 500 ms on read endpoints.
- **Economic simulation**
  - **Bulk high-tension versus aggregate individual low-tension electricity cost** — the principal economic result — with sensitivity to tariff differential, common-area load fraction and any regulatory cap on recoverable margin.
  - Aggregation saving on pooled requests by participation rate and category threshold, against published card rates. Because vendors do not bid, this isolates the volume effect.
  - Collection-rate distribution and arrears ageing under varying payment behaviour.
  - Water cost volatility under seasonal tanker dependency.
  - Corpus sweep yield against liquidity risk.
- **Functional accuracy**
  - Billing correctness at slab boundaries, apportionment to rounding tolerance, idempotency under replay, pricing-card binding.
- **Analytical contribution**
  - Regulatory chapter: the payment-aggregator restatement of the no-fund-holding design; why lending (NBFC-P2P, Money Lenders Acts) and stored value (PSS Act 2007) are excluded; DPDP Act 2023 consent architecture.
  - Comparison chapter positioning the design against MyGate / ApnaComplex / NoBrokerHood / ADDA on features, revenue model and legal exposure.

---

## 8. Risks and how the plan handles them

| Risk | Mitigation in this plan |
|---|---|
| Lending or stored-value regulation triggers | Both removed from scope entirely; no loan, wallet or voucher entity exists |
| Payment Aggregator licensing | Collection through an RBI-authorised aggregator settling to the society's account; no platform-owned account exists |
| Revenue conflicts with transparency | Vendor listing fee only; immutable cards, freeze at confirmation, automatic variance detection |
| Group buying's failed track record in India | Design centres services and utilities (which coordinate well), not commodity groceries |
| RWA sales cycles kill go-to-market | Dissertation scope: synthetic-data eval, no live pilot required |
| Vendor circumvention post-first-visit | Recurring committee-origin contracts + platform-mediated charge-sheet protection + rating |
| Vendor inflating charges after work | Card frozen at confirmation; line-level variance automatic; participant acknowledgement required |
| Committee fraud on society-held funds | Three-rung ladder (two distinct identities, then committee majority) + hash-chained audit + statement reconciliation |
| Phantom resident self-registering | Committee ratification against the imported flat register before activation |
| Meter reading manipulation | Readings on the audit chain at capture; reversing corrections; flagged meters halt the cycle |
| Notice-board impersonation and scams | Real resident attribution + verified company email + rate-limit + committee moderation |
| Data protection under DPDP Act 2023 | Consent ledger enforced at query time; sub-meter readings treated as personal data; society as Data Fiduciary, platform as Processor |
| Surface proliferation | Four surfaces (resident app, committee/vendor/operator web) share one generated API client and design tokens |

---

## 9. Open decisions (all locked)

1. **Client surfaces:** native React Native + Expo app for residents; Next.js web app for committee, vendor and platform operator.
2. **Payment aggregator:** Razorpay sandbox (UPI collect) for demo realism.
3. **Synthetic-society scale:** 90 flats.
4. **Simulation horizon:** 12 months.
5. **Dispute resolution:** automated triage + committee-confirmed final call.

Implementation runs in [BACKEND_PLAN.md](BACKEND_PLAN.md), [FRONTEND_PLAN.md](FRONTEND_PLAN.md), tracked in [SUPERVISOR.md](SUPERVISOR.md).
