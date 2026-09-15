# Hyperlocal Trust-Graph Financial Services Platform — Design v0.3

**Module:** MSO4992 — Dissertation in Financial Technology
**Working title:** *A Trust-Graph-Backed Hyperlocal Financial Services Platform for Indian Residential Communities — Escrowed Group Procurement and a Maintenance-Adjustment Repayment Primitive for Owner-Only Informal Micro-Lending*
**Scope of build:** coordination core only. Micro-lending is **designed and simulated on synthetic data, not deployed live**.
**Evaluation basis:** synthetic 200-flat society (parameters exposed).
**Time boundation:** none — the design targets completeness before speed.

This document is the technical/system-side counterpart to [PRODUCT_PLAN.md](PRODUCT_PLAN.md). Where the product plan describes users, benefits, and roadmap, this one describes what has to be built.

---

## 1. Core idea (one paragraph)

The society is the smallest unit of dense, verified social capital in urban India. The platform treats it as a **trust substrate** and layers three financial primitives on top: **(a)** coordinated bulk-buy procurement with the RWA's own bank account as the escrow settlement layer, **(b)** a geotagged, reputation-carrying vendor marketplace, and **(c)** a designed-and-simulated owner-only micro-lending primitive with **maintenance-adjustment repayment** as its central novelty. Around this financial core sits a light community layer: event and service polls, and a moderated job blog. The FinTech contribution defended in the dissertation is the maintenance-adjustment repayment mechanism and the society-escrow settlement design, evaluated with sensitivity analysis and a regulatory pathway.

---

## 2. Users and rights

| Persona | Rights | Restrictions |
|---|---|---|
| **Owner-resident** | Full read/write. Bulk-buy (create + join). Vendor marketplace (discover, rate). Service polls, event polls. Job blog. **Lending — both lend and borrow, 2× monthly maintenance cap (in simulation).** Governance vote. | Standard KYC + society-roll verification. |
| **Tenant / temporary resident** (any tenure) | Bulk-buy (create + join). Vendor marketplace. Service polls, event polls. Job blog. | **No lending, no borrowing, no ROSCA, no governance vote.** No visibility into individual lending balances. Simplified attestation KYC. |
| **Society committee** | Approves vendors. Sets society-level caps (bulk-buy thresholds, lending pool caps in simulation). Moderates disputes and job-blog flags. Governance polls. | Cannot see other residents' individual balances or private data beyond aggregates. |
| **Society treasurer** | Second authoriser on every payout from the society escrow. Sees the treasury ledger. Runs nightly reconciliation. | Cannot self-authorise a payout; always requires the platform's system-authorisation alongside. |
| **Vendor (geotagged)** | Publishes bulk-buy offers. Responds to resident-tagged polls. Receives consolidated payouts. Portable rating record. | Cannot see resident directory. Access to a resident's contact is per-transaction, consent-gated. Anti-circumvention clause signed on onboarding. |
| **Employer / hiring resident** *(job blog)* | Posts a role with verified company email + resident attribution. | Rate-limited (default 1 post / month, society-configurable). Committee can flag and remove. |
| **Job-seeking resident** *(job blog)* | Posts own availability with resident attribution. Browses posts. | Rate-limited on posting; no anonymised posts. |

**Rule of thumb:** rights scale with skin-in-the-game (ownership, tenure) but *all* residents get equal footing in the coordination features. Lending is the only feature owner-gated.

---

## 3. Feature catalogue

Each subsection: purpose · users · workflow · data · edge cases.

### 3.1 Trust graph, identity, and roles *(foundation)*

- **Purpose:** anchor every action to a verified user in a verified flat in a verified society.
- **Users:** everyone.
- **Workflow:**
  - Applicant signs up → committee confirms flat and status (owner/tenant) → KYC tier assigned → role granted.
  - Tenure clock starts and ticks continuously.
  - Every consent (vendor access, disclosure, etc.) is a logged event on the consent ledger; revocable.
- **Data:** user, flat, society, role, tenure_started_at, kyc_tier, consent_events[].
- **Edge cases:** ownership transfer (flat handoff), tenant leaving mid-loan (blocked upstream since tenants can't be in loans), committee rotation (roles reassigned, not the underlying user record).

### 3.2 Society-escrow ledger *(financial backbone)*

- **Purpose:** every rupee touches the society's own bank account; the platform never becomes the fund-holder.
- **Users:** committee (read aggregates), treasurer (co-authoriser and reconciler), everyone (their own view).
- **Workflow:**
  - Society links its bank account (via a licensed PA partner in a live product; via sandbox in the dissertation build).
  - Ledger is double-entry, immutable-append, with sub-accounts for bulk-buy, vouchers, dispute holds, and (in simulation) lending pool.
  - Every payout event requires two authorisations: platform system-authoriser (rule-checked) + treasurer manual.
  - Nightly reconciliation matches ledger against bank statement.
- **Data:** society_account, sub_accounts[], ledger_entries (double-entry), payouts (with dual signatures), reconciliations[].
- **Edge cases:** bank statement mismatch (freeze payouts, alert committee), treasurer unavailable (deputy treasurer authoriser, configured up-front).

### 3.3 Bulk-buy engine *(primary revenue product)*

Two flows, one engine.

**Flow A — Vendor-initiated minimum-booking offer**
- Vendor posts: category, job-card scope, unit price, discount %, min N, deadline T, target society.
- Residents opt in; commitments accumulate.
- Auto-fires when N met; auto-cancels on expiry.
- On fire: escrow-in from each opt-in; scheduled visit; per-flat completion + sign-off; consolidated payout at end.

**Flow B — Resident-initiated poll (first-mover tag)**
- Resident tags a vendor from the directory + proposes a slot.
- Vendor confirms minimum-booking rule or declines.
- Poll opens to society; joins accumulate.
- If vendor's minimum is met within the window: identical fire path to Flow A.
- If not: expire, notify, no money moves.

**Common**
- Job card as the atomic unit.
- Weekly recurring bulk-buy for staples (recurring subscription, nearest vendor, app-only rate).
- Two-tier flow for high-ticket jobs (>society-configured threshold): milestone-based payout, defect-liability retention.
- Anti-circumvention clause; platform-only warranty; trust-score penalty otherwise.

- **Data:** offer, poll, job_card, commitment, escrow_hold, sign_off, payout.
- **Edge cases:** partial completion (per-card sign-off), disputed job (funds held), vendor no-show (auto-refund + rating penalty), poll creator withdrawing (they stay committed unless the poll hasn't fired).

### 3.4 Geotagged vendor marketplace *(the reputation layer)*

- **Purpose:** vetted directory that both bulk-buy flows pull from.
- **Users:** vendor (register), resident (discover, rate), committee (approve, moderate).
- **Workflow:**
  - Vendor onboards: geolocation, service radius, categories, credentials, references. Committee approves.
  - Verification tiers: unverified → society-attested → platform-audited.
  - Ratings post-job; weighted by verified completion.
  - Vendor record visible to residents *before* joining a poll: past ratings, on-time %, dispute rate, price band.
  - Access to resident contact is per-transaction, consent-gated.
- **Data:** vendor, credentials[], categories[], radius, ratings[], record_summary.
- **Edge cases:** rating rings (mitigate by weighting only signed-off jobs), false verification (audit tier withdrawal), cross-society reputation (portable but reset thresholds per society).

### 3.5 Micro-lending — **designed and simulated only** *(the FinTech research module)*

This module is **not deployed live**. It is designed in full, implemented against synthetic data, and evaluated. The regulatory pathway to live operation is a chapter of the dissertation.

- **Users (simulated):** owner-residents only.
- **Workflow (simulated):**
  - Borrower requests loan → eligibility check (owner, cap ≤ 2× monthly maintenance, trust threshold clear).
  - Matched to a willing lender in the same society.
  - Loan terms: tenor ≤ 90 days; zero or low interest (society-set ceiling); no rollover.
  - Repayment option chosen at loan creation:
    - **Maintenance adjustment** (default): borrower's future maintenance increased by an extra amount for N months; equivalent credit lands on lender's maintenance ledger. No cash flow between the two.
    - **Vendor voucher**: repayment is a voucher usable in the bulk-buy marketplace.
    - **Bank transfer**: fallback when lender declines both.
  - Default handling: reminder → committee mediation → lien on defaulter's next maintenance dues → escalation.
  - Society-level monthly volume cap so aggregate stays non-business-like.
- **Data (simulated):** loan_request, loan_agreement (borrower, lender, tenor, amount, repayment_mode), repayment_schedule[], maintenance_adjustments[], default_events[].
- **Simulation harness:**
  - 200-flat synthetic society, parameterised.
  - 12-month simulated horizon (default).
  - Monte Carlo over opt-in rate × default rate × maintenance amount.
  - Outputs: pool health curves, repayment-option comparison, sensitivity tables, regulatory-annotation report.
- **Legal disclaimer surfaced in-product:** the simulated module carries an in-product banner making its non-production status explicit.

### 3.6 Job blog *(v1 referral surface)*

- **Purpose:** moderated bulletin board for hyperlocal hiring and job-seeking.
- **Users:** any resident.
- **Workflow:**
  - Post created with resident's real name + flat + society attribution.
  - Hiring posts require verified company email (email verification link).
  - Rate limit: 1 post / resident / month (society-configurable).
  - Committee can flag / remove.
  - Browsing scoped to society (with optional multi-society opt-in for future).
- **Data:** post, poster_identity, company_email_verification, flags[], moderation_events[].
- **Edge cases:** impersonation (resident-attribution + email verification both required), spam (rate limit + committee flag), stale posts (auto-archive after N days).

### 3.7 Event polls *(free-tier community feature)*

- **Purpose:** the poll mechanic for non-financial or committee-escrowed events.
- **Users:** any resident.
- **Workflow:** identical to Flow B but with optional or zero money; committee holds any pooled money in a dedicated sub-account.
- **Data:** shared with the bulk-buy poll model; event_poll is a flag/variant.
- **Edge cases:** poll creator leaves the society (transfer or cancel).

### 3.8 Governance and dispute resolution

- **Purpose:** replace WhatsApp with structured process for approvals, votes, disputes.
- **Users:** committee, treasurer, any resident (can file a dispute).
- **Workflow:**
  - Committee dashboard: approve vendors, set caps, review flagged content, moderate disputes.
  - Governance polls: proposals require committee sign-off, then society-wide vote per the RWA's own rules.
  - Dispute ladder per case type (resident-vendor / resident-resident lending / vendor-society), each with defined escalations.
  - Immutable audit log for every governance action.
- **Data:** governance_proposal, vote, dispute_case, dispute_events[], audit_log[].
- **Edge cases:** committee turnover (roles reassigned, in-flight cases carry over), conflict-of-interest (committee member's own case is auto-escalated to a peer).

### 3.9 Notifications and communication

- In-app + SMS + email, per-category opt-out.
- Poll deadlines, payout events, dispute updates, lending events (in simulation UI only), job-blog rate-limit warnings.

### 3.10 Cross-cutting concerns

- **Consent ledger.** Every disclosure or access is logged and revocable.
- **Audit trail.** Every state change is timestamped and immutable-append.
- **Role-based access control.** Enforced at API layer, not just UI.
- **Trust score.** Composite of tenure, on-time behaviour, dispute history. **Secondary** to hard rules (which are always primary in this design).
- **Anti-fraud triage.** Automated first-pass triage on disputes with committee-confirmed final call.

---

## 4. Money flow diagrams (narrative)

### 4.1 Bulk buy (small ticket)
```
Residents (N) --pay--> Society escrow (bulk-buy sub-account)
Vendor completes each job card -> resident sign-off
End-of-day: platform system-auth + treasurer co-auth
                    --> single consolidated payout to vendor
                    --> platform commission auto-deducted --> revenue ledger
```

### 4.2 Bulk buy (large ticket)
```
Committee/AGM approval -> job posted
Milestone 1 (start): 30% payout
Milestone 2 (midpoint sign-off): 40% payout
Milestone 3 (final sign-off + defect-liability retention): 30% payout
Retention released after defect-liability window
```

### 4.3 Simulated micro-loan with maintenance-adjustment repayment
```
Lender pledges amount --> lending pool sub-account (SIMULATED)
Borrower request --> eligibility (owner, cap, trust threshold)
Match --> loan agreement created
Disbursement: pool --> borrower's account (SIMULATED)
Repayment schedule created:
  For N months, borrower's maintenance += monthly repayment share
                lender's maintenance    -= monthly repayment share
Society's monthly maintenance run reconciles the transfer without cash between the two individuals.
Default: reminder --> mediation --> lien on defaulter's next dues --> escalation
```

### 4.4 Voucher repayment path
```
Borrower opts for voucher repayment
Society issues N vouchers on the borrower's account, redeemable in bulk-buy
Lender receives voucher wallet credits equal to loan principal + agreed fee
Vouchers auto-redeem on lender's next group buys
```

---

## 5. System-level design themes

*Kept intentionally stack-agnostic — architecture choices happen after this document is approved.*

### 5.1 Data model themes
- Society is the tenant boundary; every record is society-scoped.
- Users can belong to multiple societies (e.g. a vendor serving several).
- The ledger is the source of truth for money; every other financial view is derived.

### 5.2 Trust model themes
- All authorisation is role + rule based.
- The trust score is a *feature* used inside rules, not a replacement for them.
- Consent is granular and revocable; every access to another resident's data is a logged event.

### 5.3 Integration themes
- Payment aggregator is a *partner*, not a re-build. Platform never holds funds.
- Bank statement ingestion is a first-class citizen (reconciliation depends on it).
- Communication channels (SMS, email) are pluggable providers.

### 5.4 Simulation harness themes
- Runs on synthetic society data with parameterised distributions.
- Monte Carlo sampling for sensitivity analysis.
- Outputs are reproducible with a seed.

### 5.5 Compliance themes
- DPDP Act 2023: society as Data Fiduciary, platform as Processor. Contracts codify this.
- RBI NBFC-P2P framework: simulation only; live pathway via partner is documented.
- State Money Lenders Acts: informal-lending exemption analysis; hard caps and volume ceilings enforced.
- Payment Aggregator framework: platform never touches funds; PA partner does.

---

## 6. What is deliberately out of scope for v1

- No live P2P lending.
- No commission-bearing referral portal.
- No ROSCA / chit-group module.
- No group insurance module.
- No CSR sponsorship implementation.
- No security / visitor / gate module.
- No native mobile apps; mobile-web responsive is enough for the demonstration.

Full rationale in [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §4-§5.

---

## 7. Future features (documented, not built)

Mirrors [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §5:

1. Live micro-lending via NBFC-P2P partnership.
2. Full referral portal with commissions and retention-linked payouts.
3. Digital ROSCA / chit-group module (via registered chit-company partner).
4. Group insurance module (via IRDAI-licensed partner).
5. CSR-sponsored inclusion layer (Section 135, Companies Act 2013).
6. Native mobile apps.
7. Multi-society network features and portable vendor reputation.
8. Embedded module / SDK inside MyGate / ApnaComplex / ADDA.

---

## 8. Open architectural decisions

Only these remain before we design the stack:

1. **Frontend surface** — responsive web only, PWA, or one native app.
2. **PA integration** — pure simulation, or sandbox (e.g. Razorpay test mode) for demonstration realism.
3. **Synthetic society scale** — default 200 flats; parameterisation range.
4. **Simulation horizon** — 3 / 6 / 12 months.
5. **Dispute automation depth** — automated triage + manual final call, or manual only.

Once these are locked, the next document is `ARCHITECTURE.md` — the stack, service boundaries, data model, and API surface.
