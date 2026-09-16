# Features Catalogue — GateX Platform (V2.0)

A single-page catalogue of every user-facing feature in the build scope, grouped by audience, each with **what it does**, **the problem it solves**, and **the benefit it delivers**.

Source of truth: [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §3, §4. Where a feature has multiple audiences the primary one is listed first.

---

## A. Features for Residents (owner-occupier, owner-absentee, tenant)

### A1. Phone-OTP sign-in with committee-ratified flat claim
- **What it does:** Resident signs in with an OTP, claims a flat, and is activated only once the committee ratifies the claim against the imported flat register.
- **Problem solved:** *Phantom residents* — strangers self-registering into a society and gaining access to bills, service requests and the notice board.
- **Benefit:** Every downstream feature can safely trust "this person really lives in this flat, right now." No government-ID collection required.

### A2. Owner-to-tenant operational delegation
- **What it does:** An owner-absentee can delegate operational rights (raise/join service requests, event opt-in) to their tenant, scoped and revocable, while retaining financial control.
- **Problem solved:** Owners abroad or in another city currently either lose visibility of their flat or hand over full financial control to a tenant.
- **Benefit:** Owner keeps the money view; tenant gets the day-to-day levers; every delegation is a logged consent event.

### A3. Consolidated bills hub
- **What it does:** One payable view per flat covering maintenance, electricity, water, pooled-request contributions and event charges, ordered by due date, clearable in a single session.
- **Problem solved:** Six separate WhatsApp notices, PDFs and spreadsheets per month per flat; disputes based on recollection.
- **Benefit:** One place, one payment session, every line traceable to its evidence — meter reading, apportionment formula, pooled request or frozen pricing card.

### A4. Electricity bill with visible derivation
- **What it does:** Bulk (high-tension) electricity is recovered from flats on sub-meter readings against the licensee tariff; common-area load is apportioned by area factor; every cycle is reconciled against the bulk invoice with variance published.
- **Problem solved:** "Why is my bill this much?" arguments; hidden losses buried in flat rates; unexplained tariff-slab misapplication.
- **Benefit:** Every rupee of the flat's bill has a formula and inputs behind it. Residents in individually metered societies get their bill routed via BBPS with the same trace.

### A5. Water bill with blended-rate transparency
- **What it does:** Municipal, tanker and borewell water is pooled into a blended per-kilolitre rate published with its derivation; metered flats billed on measurement, unmetered flats on a fallback with cross-subsidy reported.
- **Problem solved:** Tanker-season cost spikes that appear arbitrary; unmetered vs metered flats subsidising each other silently.
- **Benefit:** Cost spikes are explained, not argued about; the cross-subsidy is out in the open.

### A6. Raise a service request → neighbours join → pooled procurement
- **What it does:** A resident raises a household need ("AC not cooling", plumbing leak, pest problem); neighbours facing the same problem join; once the per-category participation threshold is met the committee sources a vendor; the vendor's pricing card freezes against the pool.
- **Problem solved:** Every flat individually calling JustDial / UrbanCompany, paying different prices for the same job, no leverage on the vendor.
- **Benefit:** Volume pricing against a published card, a coordinated visit day, and a price no neighbour can be quoted differently for.

### A7. Contribution refund if pool lapses
- **What it does:** If participation stays below the threshold at closing, the pool lapses and every contribution is returned automatically.
- **Problem solved:** Money getting stuck when group orders fizzle out.
- **Benefit:** Residents can commit without fearing lock-in.

### A8. Milestone settlement on large jobs, with defect-liability retention
- **What it does:** Jobs above a society-set threshold settle in milestones (e.g. 30/40/30) with a retention held back for the defect-liability window.
- **Problem solved:** Vendor disappears after payment; punch-list items never closed.
- **Benefit:** Money is released as work is verified; retention gives leverage over defects.

### A9. Charge-sheet variance flag with resident acknowledgement
- **What it does:** On job completion the vendor submits an itemised charge sheet against the frozen card; out-of-card lines are flagged automatically and require participant acknowledgement or committee adjudication.
- **Problem solved:** Undisclosed visit charges and retrospectively inflated line items — the classic post-service surprise.
- **Benefit:** The surprise is eliminated structurally, not by trust.

### A10. Vendor directory with portable ratings
- **What it does:** A searchable directory of onboarded vendors (with GSTIN verification and tier badge), each carrying a rating aggregate that follows them across every society they serve.
- **Problem solved:** Cold-picking a plumber off Google reviews of unknown provenance.
- **Benefit:** Ratings come from real neighbours in real societies and can't be reset by opening a new listing.

### A11. Committee-created events with fixed refund policy
- **What it does:** The committee creates paid events (title, capacity, per-flat charge, waitlist, refund policy). Residents opt in and pay into an event sub-ledger; refunds run automatically per the fixed policy.
- **Problem solved:** Cancelled events triggering discretionary refund arguments; opaque event accounts.
- **Benefit:** The refund rule is fixed at creation and cannot be re-litigated after cancellation.

### A12. Health-camp registration (no clinical data)
- **What it does:** Residents register for society-arranged health camps; the provider receives name, flat, slot only; no clinical field exists in the schema.
- **Problem solved:** Health data leaking into a non-healthcare product.
- **Benefit:** Convenience without a compliance blast radius on the society.

### A13. Donations — internal welfare and external pass-through
- **What it does:** Internal welfare-fund campaigns under dual authorisation; external campaigns record participation only. Anonymity toward other residents is supported.
- **Problem solved:** Collection drives run on Google Forms with no accountability.
- **Benefit:** Contributions accounted for, disbursements dual-authorised, donor anonymity respected without hiding from the auditor.

### A14. Dispute a charge-sheet line
- **What it does:** Any resident can dispute a charge-sheet line; automated triage by category and amount; final adjudication by the committee, recorded to the audit chain.
- **Problem solved:** Bill disputes ending in WhatsApp shouting matches.
- **Benefit:** A structured, recorded path from "this line is wrong" to a decision.

### A15. Verify the hash-chained audit log
- **What it does:** A resident-callable endpoint reports "intact" or the first divergent row of the society's audit chain.
- **Problem solved:** No independent way for a resident to check that the numbers on the app match the numbers in the ledger.
- **Benefit:** Trust in the platform's records does not depend on trusting the platform.

### A16. Notice board / job blog
- **What it does:** A moderated bulletin board for residents to post roles they are hiring for or their own availability; real name + flat always shown, verified company email for hiring posts, rate-limited (1 post/resident/month).
- **Problem solved:** WhatsApp groups jammed with hiring pings; scam listings from unverified numbers.
- **Benefit:** A trusted, hyperlocal notice board — no incentives, no matching engine, no money flows.

### A17. Notifications with quiet hours
- **What it does:** Push (with email/SMS fallback) for every event that touches the resident — bill published, payment confirmed, arrears reminder, pool threshold reached, vendor confirmed, card frozen, approval pending; per-resident preferences and quiet hours.
- **Problem solved:** Either missing critical events entirely or getting hammered by spammy society WhatsApp groups.
- **Benefit:** Engagement without spam; an emergency broadcast path exists but is committee-only and logged.

---

## B. Features for Vendors

### B1. Single vendor identity across every society
- **What it does:** One vendor login (password + mandatory 2FA) links to every society they serve.
- **Problem solved:** Managing a separate account per RWA; ratings and history not portable.
- **Benefit:** One inbox, one profile, one rating aggregate that follows the vendor.

### B2. GSTIN-verified tier badge
- **What it does:** GSTIN and trade licence collected at onboarding; free GSTIN check auto-promotes `UNVERIFIED` → `SOCIETY_ATTESTED`; the operator can promote to `PLATFORM_AUDITED`.
- **Problem solved:** Vendors indistinguishable from cold-call scams; no way to signal legitimacy.
- **Benefit:** A visible credibility signal that costs the vendor no marketing spend.

### B3. Versioned, immutable pricing cards
- **What it does:** Vendors publish pricing cards per category — visit charge, labour basis, materials handling, minimum charge, GST rate, conditions per line. A revision creates a new version; older versions stay readable for engagements that froze them.
- **Problem solved:** Constant renegotiation per society; no way to enforce a rate card after publishing it.
- **Benefit:** Publish once, be quoted the same by every society; historical bindings survive future edits.

### B4. Pooled-request engagement queue
- **What it does:** The committee sources vendors from the directory against a pooled request; vendor confirms or declines; on confirmation the card freezes to that pool and a job list is pushed.
- **Problem solved:** JustDial-style bidding wars driving margins down; per-flat door-knocks eating a day for pennies.
- **Benefit:** Many jobs in one visit day, no bidding fight, near-zero customer acquisition cost.

### B5. Itemised charge sheet against frozen card
- **What it does:** After the visit, vendor submits an itemised charge sheet mapped to the frozen card; job cards are signed off per flat.
- **Problem solved:** Chasing payment across ten flats with ten different WhatsApp threads.
- **Benefit:** One settlement per pooled engagement, on defined terms.

### B6. Milestone billing on large jobs
- **What it does:** Above a society-set threshold, work bills in milestones (e.g. 30/40/30) with defect-liability retention released after the warranty window.
- **Problem solved:** Cash-flow pain on multi-day / multi-phase jobs done for a single flat's rate.
- **Benefit:** Predictable staged revenue for big engagements.

### B7. Portable rating and record
- **What it does:** Ratings aggregate across every society the vendor serves; history is not deletable by opening a new listing.
- **Problem solved:** Reputation being trapped inside one RWA's private WhatsApp group.
- **Benefit:** Good work compounds into cross-society demand.

### B8. Consent-gated access to residents
- **What it does:** Vendors cannot browse the resident directory; contact and access are per-engagement and consent-logged.
- **Problem solved:** Vendor lists becoming spam databases.
- **Benefit:** Residents stay reachable inside jobs and unreachable outside them — which is exactly the deal that keeps them opting in.

---

## C. Features for Society Committee / Admin

### C1. Flat register import and resident ratification queue
- **What it does:** Committee imports the flat register by CSV (area factors validated to sum to unity) and ratifies each new resident claim against it before activation.
- **Problem solved:** Not knowing who is actually in the society; strangers self-onboarding.
- **Benefit:** A single source of truth for who owns and who occupies which flat.

### C2. Vendor onboarding and moderation
- **What it does:** Committee reviews vendor applications, checks GSTIN status, promotes to `SOCIETY_ATTESTED`, and can flag vendors on the directory.
- **Problem solved:** No structured way to admit or expel vendors from the society's "approved list".
- **Benefit:** A curated directory with clear owner accountability.

### C3. Pooled-request sourcing (no bidding surface)
- **What it does:** For every viable pool, the committee picks the vendor from the directory against published cards.
- **Problem solved:** Auction-style vendor bidding races that residents can't referee and vendors can't sustain.
- **Benefit:** Vendor economics stay healthy; committee owns the decision that residents can inspect afterwards.

### C4. Billing-cycle runs (electricity, water, maintenance)
- **What it does:** Committee runs each billing cycle; validation halts the cycle on any flagged meter; reconciliation against the bulk invoice publishes variance.
- **Problem solved:** Excel-based billing riddled with copy-paste errors and no invoice reconciliation.
- **Benefit:** Cycle output is defensible and repeatable.

### C5. Event creation
- **What it does:** Committee creates paid events with a refund policy fixed at creation.
- **Problem solved:** Refund arguments after cancellation.
- **Benefit:** Governance-free event lifecycle after creation.

### C6. Dispute adjudication queue
- **What it does:** Automated triage by category/amount surfaces disputes to the committee; final decisions write to the audit chain.
- **Problem solved:** Dispute resolution done on WhatsApp with no record.
- **Benefit:** A traceable process; AGM-ready summaries.

### C7. Three-rung approval ladder for outbound money
- **What it does:** Every outbound payment and corpus movement flows through: (Rung 1) single officer for small amounts; (Rung 2) **two officers of distinct identity** above the lower threshold — same-identity approval is rejected; (Rung 3) configurable committee majority above the upper threshold. Thresholds are per-society config.
- **Problem solved:** The classic RWA fraud vector — one office-bearer moving money alone.
- **Benefit:** Compliance-by-construction segregation of duties; changing a bye-law is a data change, not a code change.

### C8. Emergency broadcast channel
- **What it does:** Bypasses quiet hours; committee-officer only; every use logged.
- **Problem solved:** Genuine emergencies drowning in the same channel as spam.
- **Benefit:** A distinct urgent path that cannot be abused silently.

### C9. Aggregated financials view
- **What it does:** Committee sees society-level financials — never another resident's individual balance.
- **Problem solved:** Casual snooping into neighbours' arrears; DPDP-Act consent violations.
- **Benefit:** Governance without surveillance.

---

## D. Features for Treasurer / Deputy Treasurer

### D1. Sub-ledger balances reconciling to the bank
- **What it does:** Append-only double-entry ledger partitioned into sub-ledgers (maintenance, electricity, water, procurement escrow, events, welfare, sinking, corpus); every sub-ledger reconciles to the society's bank balance.
- **Problem solved:** No idea which "pocket" holds which money; commingling by default.
- **Benefit:** Every pocket is visibly funded and cross-pocket movement is an explicit dual-authorised journal.

### D2. Bank-statement ingestion with unmatched-credit queue
- **What it does:** Statement credits match by virtual account (attribution key per flat); unmatched credits sit in a review queue and are never auto-allocated.
- **Problem solved:** Credits assigned to the wrong flat, then untangled by memory.
- **Benefit:** Attribution errors surface early; residents get correct arrears.

### D3. Arrears ageing and instalment forbearance
- **What it does:** Configurable ageing buckets, late-fee schedules and per-resident instalment plans on the society's receivable.
- **Problem solved:** Arrears blowing up unnoticed until AGM; no structured hardship path.
- **Benefit:** Collections operate on data, not vibes.

### D4. Corpus treasury with FD laddering
- **What it does:** A sweep rule with an operating-float floor proposes fixed-deposit placements; maturities are laddered across the year; interest posts to society income only.
- **Problem solved:** Corpus lying idle in a current account; ad-hoc FD placements around one officer's calendar.
- **Benefit:** Yield without liquidity accidents.

### D5. Two-distinct-identity approvals on money out
- **What it does:** Every payout above Rung-1 requires two distinct officer identities.
- **Problem solved:** Rubber-stamping by one person with two logins.
- **Benefit:** Structural closure of the single-actor fraud vector.

---

## E. Cross-cutting: Governance, Audit, Compliance

### E1. Hash-chained audit log with resident verification
- **What it does:** Every state change writes an `AuditLog` row whose SHA-256 hash chains from the previous row; every instruction, approval and rejection carries the acting identity; verification is callable by any resident.
- **Problem solved:** Records that can be edited quietly after the fact.
- **Benefit:** Tamper-evident finance; external auditability without special access.

### E2. Consent ledger (DPDP Act 2023 alignment)
- **What it does:** Every vendor access and every disclosure is a logged, revocable consent event enforced at query time.
- **Problem solved:** Vague "by using this app you consent" boilerplate that fails DPDP.
- **Benefit:** Consent is granular, revocable and enforced at the data-access boundary.

### E3. Meter-reading immutability
- **What it does:** Readings write to the audit chain at capture; corrections post reversing readings; a flagged meter halts the cycle.
- **Problem solved:** Silent edits to meter data in the middle of a billing dispute.
- **Benefit:** Reading history is a chain, not a spreadsheet cell.

### E4. Society-account settlement design (no fund-holding)
- **What it does:** Collection runs through an RBI-authorised payment aggregator (Razorpay sandbox in the build), settling directly to the society's bank account. The platform holds no account in the society's chart of accounts.
- **Problem solved:** Payment-Aggregator authorisation exposure for the platform; commingled custodial risk.
- **Benefit:** The no-fund-holding invariant is enforceable by construction, not by policy.

---

## F. What we deliberately don't build (and the problem that would have created)

Every item below was cut for a compliance or trust reason. They are non-features by design.

| Excluded | Why not building it protects the user |
|---|---|
| Any form of lending (P2P, micro, deferred payment) | Triggers NBFC-P2P regulation and Money Lenders Acts; closed-user-group matching is expressly prohibited (RBI Master Direction, revised Aug 2024). |
| Wallet, vouchers, stored value | Engages PSS Act 2007 prepaid-instrument boundary; no cash-convertible balance exists in the schema. |
| Resident voting (advisory or binding) | Would create a governance surface the committee approval ladder already covers, with fewer edge cases. |
| Individual service bookings | Would recreate the JustDial / UrbanCompany price-opacity model the pool is designed to replace. |
| Vendor bidding | Auctions drive vendor economics into the ground; committee sourcing against published cards protects both sides. |
| Any commission on resident or vendor money | Preserves the no-fund-holding design and the transparency contract with vendors. |
| Referral incentives / hiring commission | Keeps the notice board non-financial and out of matchmaking-platform regulation. |
| Storing any health information | Removes an entire class of DPDP / medical-data risk. |
| Security / visitor / gate management | Deliberate non-competition with MyGate / NoBrokerHood; we sit beside them. |
| Family sub-accounts | One user per role per flat; sharing is the household's problem, not ours. |

---

## G. Revenue

- **Only revenue stream:** vendor listing / subscription fee, contracted and settled entirely outside the society's money rails.
- **What that buys the vendor:** directory presence, ability to publish pricing cards, optional `PLATFORM_AUDITED` tier.
- **What the platform never earns from:** resident payments, pooled contributions, vendor settlements, corpus movements.

The design tension — that the platform earns from the party whose pricing it exists to make transparent — is mitigated structurally: cards are immutable, freeze at confirmation, and variance detection is automatic. Revenue cannot influence the transparency mechanism without a schema change visible in code review.
