# Product Plan — Society FinTech Platform (working name: *tbc*)

**Status:** Final for dissertation build scope. Synthetic-data evaluation only. No time boundation on delivery.

---

## 1. Product vision

A residential society is the smallest unit of high-trust, geographically dense economic activity in urban India. This product turns that trust into three usable financial primitives:

1. **Coordinated buying power** — many small residents becoming one large customer, with the society's own bank account as the escrow settlement layer.
2. **A geotagged, accountable vendor network** — where trust travels with the vendor from job to job, gated by residents' consent rather than paid ads.
3. **An owner-only informal-lending primitive** — capped at 2× monthly maintenance, repaid as adjustments against future maintenance dues or as marketplace vouchers, designed to sit *inside* what Indian law treats as private neighbourly help rather than a commercial lending business.

Around this financial core sits a light community layer: event and service polls, a moderated job blog, and a vendor record every resident can read before joining a poll.

The FinTech contribution defended in the dissertation is the **maintenance-adjustment repayment primitive** and the **society-escrow settlement design**, evaluated on a synthetic 200-flat society with sensitivity analysis and a regulatory pathway.

---

## 2. Target users (personas)

### 2.1 Owner-resident *(primary user)*
- **Profile:** owns the flat; long-term stake in the society; typical age 30-60; disposable income for household services and small savings.
- **What they get:** full app — bulk buy, vendor marketplace, service polls, event polls, job blog, **and** the lending module (borrow and lend, 2× maintenance cap).
- **What they give:** identity verification, on-time maintenance payment history, active participation.
- **Primary benefit:** their maintenance charge stretches further (discounts + no vendor markup) *and* they get a small, safe way to help or be helped by neighbours financially without going near loan sharks or credit cards.

### 2.2 Tenant / temporary resident *(secondary user)*
- **Profile:** rents in the society; typical urban rental cycle 11-24 months; may still be a long-term resident of the city.
- **What they get:** full access to bulk buy, vendor marketplace, service polls, event polls, job blog.
- **What they do NOT get:** the lending module — no borrowing, no lending, no visibility into individual lending balances.
- **Why the exclusion:** legal cleanliness (owners have a stronger stake; skin-in-the-game filter for financial risk) and practical reality (tenants churn).
- **Primary benefit:** cheaper household services, plugged into the neighbourhood without needing an owner introduction.

### 2.3 Society committee / admin
- **Profile:** elected residents managing the RWA.
- **What they get:** admin dashboard — vendor approval, dispute mediation, lending pool caps, aggregated financials (never individual balances of other residents), governance polls.
- **What they do:** two-person authorisation on payouts from the society escrow account. Set society-level caps (lending, vendor spend, poll thresholds).
- **Benefit:** cleaner accounting than the current spreadsheet-and-WhatsApp workflow. AGM financial statement auto-generated.

### 2.4 Society treasurer
- **Profile:** committee member with signing authority on the RWA bank account.
- **What they get:** treasury dashboard — inbound receipts, outbound payouts (requiring their co-authorisation), reconciliation view against the bank statement.
- **Benefit:** audit trail replaces trust. Reduces the classic RWA fraud vector.

### 2.5 Vendor (geotagged)
- **Profile:** local plumbers, electricians, painters, grocers, deep-cleaners, AMC providers, tuition teachers, professionals (CA, legal). Small businesses or individuals within a defined service radius.
- **What they get:**
  - Publish minimum-booking offers to a whole society at once.
  - Respond to resident-initiated polls that tag them.
  - Receive consolidated payment from the society account (one payout per group job, not 20).
  - A portable rating and record that follows them across societies.
- **What they give:** verification (documents, licence where applicable, insurance where applicable), anti-circumvention agreement, rating exposure.
- **Benefit:** much lower customer-acquisition cost than JustDial / UrbanCompany. One visit day = many jobs. No fight for search ranking; participation is by invitation and reputation.

### 2.6 Employer / hiring resident *(job blog v1)*
- **Profile:** any resident with a role to fill — could be a hiring manager, a small business owner, or a domestic role (childcare, tutor).
- **What they get:** a moderated bulletin-board post inside the society (or the society network), with their identity and company email verified.
- **Benefit:** better signal-to-noise than LinkedIn or Naukri for a small volume of high-quality intra-society leads.

### 2.7 Job-seeking resident *(job blog v1)*
- **Profile:** anyone in the society open to work — students, career-break returners, professionals looking to switch.
- **What they get:** posts they can browse; ability to post their own availability with resident attribution.
- **Benefit:** hyperlocal, trust-graph-scoped opportunities that don't need a formal recruiter.

### 2.8 Researcher / dissertation reader *(dissertation context)*
- **Not a product user**, but a stakeholder for the deliverable.
- **What they get:** a working prototype demonstrating the coordination core, a simulated lending module with sensitivity analysis, and a regulatory pathway document.

---

## 3. Features — built in v1

Each feature: **who uses it → what it does → how it works → what benefit it delivers → what revenue it drives (if any)**.

### 3.1 Trust graph, identity, and roles *(foundation)*

- **Users:** everyone.
- **What it does:** anchors every account to a verified flat, a role (owner / tenant / committee / treasurer / vendor / employer / job-seeker), a tenure clock, and a consent ledger.
- **How it works:**
  - Onboarding requires the committee to confirm the applicant's flat number and status (owner vs tenant, ownership doc or rental agreement).
  - KYC tier: standard (Aadhaar/PAN + selfie) for owners and vendors; light attestation for tenants.
  - Tenure clock ticks continuously; unlocks or locks features by threshold.
  - Consent ledger: every vendor access, every referral view, every disclosure is a logged, revocable consent event.
- **Benefit:** every downstream feature can *safely* trust "this user is who they say they are, in this flat, in this society, right now."
- **Revenue:** none directly; enables everything.

### 3.2 Society-escrow ledger *(financial backbone)*

- **Users:** committee, treasurer (write); everyone (their own view).
- **What it does:** every rupee that flows through the platform touches the society's bank account, not the platform's.
- **How it works:**
  - The RWA opens a dedicated bank account (or a sub-account with a licensed Payment Aggregator partner).
  - The platform runs a **double-entry ledger** on top of that account, with **sub-accounts** for: bulk-buy holdings, lending pool, voucher pool, dispute holds.
  - Every payout requires **two-person authorisation** — platform system-authorisation + treasurer.
  - Nightly reconciliation with the bank statement.
- **Benefit:**
  - No unregulated fund-holding by the platform (which avoids PA licensing on the platform's own balance sheet).
  - Auditable, tamper-evident finances for the RWA — replaces the classic "the treasurer's Excel sheet" model.
- **Revenue:** enables platform commission on flows; no direct revenue on this layer.

### 3.3 Bulk-buy engine *(the primary early revenue product)*

Two symmetric flows.

**Flow A — Vendor-initiated minimum-booking offer**
- **Users:** vendor (creates offer); residents (opt in); society (escrows and pays out).
- **What it does:** a vendor publishes: *"I will do X job cards at Y% discount if at least N residents commit within T days."*
- **How it works:**
  - Vendor sets: category, scope of one job card, unit price, discount %, minimum N, deadline T, target society/societies.
  - Residents see the offer inside their society feed; opt-in creates a commitment.
  - When N is met, the offer fires: residents' funds move to the society escrow (bulk-buy sub-account); vendor schedules the visit day.
  - After each job is signed off by its resident, the corresponding job card's funds become releasable.
  - At end-of-day (or end-of-milestone for larger jobs), the society treasurer + platform co-authorise a single consolidated payout to the vendor.
  - Platform commission auto-deducted; vendor gets net.
- **Benefit for residents:** real discount + coordinated visit day + platform-mediated warranty if paid on-platform.
- **Benefit for vendor:** 20 jobs in one visit day; near-zero acquisition cost per job.
- **Revenue:** platform takes commission (5-15% depending on category).

**Flow B — Resident-initiated poll (first-mover request)**
- **Users:** any resident (creates the poll); vendor (confirms/declines); neighbours (join).
- **What it does:** a resident needs a service, so they **tag a vendor** from the geotagged directory and open a poll: *"getting my kitchen deep-cleaned by X on Saturday — join if you want the same, we get their group price if we hit their minimum."*
- **How it works:**
  - Poll creator picks: service type, target date window, tagged vendor, proposed slot.
  - Vendor receives an access-request notification; either confirms the minimum-booking rule that would apply (e.g. "5 flats same day for group price") or declines.
  - Poll opens to neighbours; joins accumulate; if the vendor's minimum is met inside the poll's window, the poll auto-schedules and moves into escrow exactly like Flow A.
  - If the minimum isn't met, the poll expires; joiners are notified; no money moves.
- **Benefit for residents:** they don't have to wait for a vendor to advertise — anyone can *pull* the group buy into existence.
- **Benefit for vendor:** demand signal from residents themselves, not from cold outreach.
- **Revenue:** same commission model as Flow A.

**Common properties**
- **Job card:** atomic unit — one flat's worth of work, fixed scope/price/SLA.
- **Two-tier flow for large jobs:** for jobs above a society-set threshold (e.g. ₹50,000), payment is milestone-based (30% start, 40% midpoint, 30% completion, with defect-liability retention).
- **Weekly recurring bulk-buy:** for staples/groceries — residents set a recurring subscription; the nearest geotagged vendor offers an app-only weekly rate; auto-consolidated delivery day.
- **Event polls:** the same mechanic used for non-financial events (a Diwali celebration, a housekeeping-staff pooled bonus, a shared hire of a cleaning van). Zero money or committee-escrowed money.

### 3.4 Geotagged vendor marketplace *(the reputation layer)*

- **Users:** vendors (register); residents (discover, review); committee (approve, moderate).
- **What it does:** the directory that Flow A and Flow B pull from.
- **How it works:**
  - Vendor onboards with: location (geotagged), service radius, categories, credentials, references. Committee approves.
  - Vendor cannot see resident directory — access is per-transaction and consent-based (a resident's opt-in to a poll is that consent).
  - Ratings: post-job rating by the resident + optional committee rating. Vendors below a threshold lose access.
  - Verification tiers: unverified → society-attested → platform-audited (documents, insurance, past-job proofs).
  - Vendor record shown to residents before they join a poll: past ratings, on-time %, dispute rate, categories, price band.
- **Benefit for residents:** vetted vendors, transparent history, no cold marketplace surprises.
- **Benefit for vendors:** portable reputation across societies, once earned.
- **Revenue:** small onboarding fee for platform-audited tier; commission on transactions.

### 3.5 Owner-only micro-lending — **designed and simulated**, not live *(the FinTech research contribution)*

This is the module where the dissertation's research contribution lives. It is **designed in full**, **simulated on synthetic data**, and **analysed against India's regulatory framework**. It is **not deployed as a live product** in v1 because that would require NBFC-P2P registration (₹2 crore paid-up capital) or an NBFC-P2P partnership.

- **Users (in the simulated system):** owner-residents only. Tenants completely excluded — cannot lend, cannot borrow, cannot view balances.
- **What it does:** provides a capped, structured way for one owner-resident to lend to another, with repayment expressed as an adjustment against future maintenance dues or as vouchers redeemable in the bulk-buy marketplace.
- **How it works (as designed):**
  - **Hard cap:** any single borrower's total outstanding on-platform loans ≤ 2× their monthly maintenance charge to the society.
  - **Repayment options** (ranked):
    1. **Maintenance adjustment** — the borrower's future maintenance dues are debited by an extra amount for N months; the equivalent credit lands on the lender's maintenance account. No cash moves between the two; the society's monthly maintenance run reconciles the transfer.
    2. **Vendor voucher** — the borrower's repayment is issued as a voucher usable in the bulk-buy marketplace; lender receives it and redeems on their next group buy.
    3. **Bank transfer** — fallback, used only when the lender declines both non-cash options.
  - **Terms:** short tenor (≤ 90 days); zero or low interest (society-set ceiling; likely 0% or a nominal fee); no rollover.
  - **Default handling:** reminder → committee mediation → lien on the defaulter's next maintenance dues → escalation.
  - **Volume cap:** society-level monthly total is capped so the aggregate doesn't cross a threshold that would look like commercial lending.
  - **Consent + disclosure:** the borrower discloses to the lender only what is required for the loan; committee sees aggregates, not identities of lender-borrower pairs on individual loans.
- **Benefit (simulated):** a resident short on cash for a school fee or a medical expense has a safer, dignified alternative to gold loans and credit cards, capped small enough to keep the risk survivable.
- **Revenue:** none live in v1. In a future live version routed through an NBFC-P2P partner, the platform earns a matching fee.
- **What the dissertation demonstrates on synthetic data:**
  - Sensitivity of the lending pool's health to opt-in rate, default rate, and maintenance amount.
  - Regulatory pathway (NBFC-P2P partner model) with legal-analysis annotations.
  - Comparison of the three repayment options on friction, retention, and default probability.

### 3.6 Job blog *(v1 version of the referral idea)*

- **Users:** any resident.
- **What it does:** a moderated bulletin-board where residents post roles they are hiring for or their own availability.
- **How it works:**
  - Poster's identity is always their real resident name + flat + society (attribution is public).
  - Hiring posts additionally require a **verified company email** (email verification link).
  - Rate-limit: 1 job post per resident per month (soft), configurable per society.
  - Committee can flag and remove posts.
  - No commission engine, no auto-matching in v1.
- **Benefit:** strictly better signal-to-noise than LinkedIn/Naukri for a small volume of high-quality hyperlocal leads. Adds warmth (a real neighbour) to a professional interaction.
- **Revenue:** none in v1. In v2 (future), commissions on successful hires split with the referrer.

### 3.7 Event polls *(free-tier community feature)*

- **Users:** any resident.
- **What it does:** creates a poll for anything that needs a minimum RSVP — a movie night, a Diwali dinner, a housekeeping-staff pooled bonus, a shared cab to an airport at 5am.
- **How it works:** same poll mechanic as Flow B, without money flowing (or with committee-escrowed money if it's a shared purchase).
- **Benefit:** low-cost community engagement; drives platform habit; costs almost nothing to build once the poll infra exists.
- **Revenue:** none directly. Retention driver.

### 3.8 Governance and dispute resolution *(admin foundation)*

- **Users:** committee, treasurer, any resident (can file a dispute).
- **What it does:** structured workflow for approvals, votes, and disputes.
- **How it works:**
  - Committee dashboard: approve vendors, set caps, review flagged posts, moderate disputes.
  - Governance polls: proposals require committee sign-off, then a society-wide vote if the constitution demands it.
  - Dispute ladder: resident-vendor / resident-resident (lending, in the simulated system) / vendor-society, each with a defined escalation path.
  - Audit log: every governance action is timestamped and immutable.
- **Benefit:** replaces WhatsApp politics with structured process. Reduces committee-turnover shock.
- **Revenue:** none directly; a compliance backbone.

### 3.9 Notifications and communication *(cross-cutting)*

- **Users:** everyone.
- **What it does:** timely notifications on polls, offers, payouts, disputes.
- **How it works:** in-app + SMS + email; category-level opt-outs.
- **Benefit:** engagement without spam.

---

## 4. Non-goals for v1

These decisions are deliberate. They keep scope honest.

- **No live P2P lending with real money.** Simulated only, on synthetic data. Regulatory pathway documented.
- **No employer-side commercial referral portal.** Job blog only.
- **No CSR partnerships in the build scope.** Reference framework documented; not implemented.
- **No digital ROSCA / chit fund** in v1. Documented as future.
- **No group insurance** in v1. Documented as future.
- **No security / visitor / gate management.** MyGate/NoBrokerHood own that; we sit on top or beside, not compete.
- **No mobile-first native apps** committed in the plan — mobile-web responsive is enough for a synthetic-data demonstration. Native is a real-product decision, not a dissertation decision.

---

## 5. Future plans (deferred, documented, not built)

### 5.1 Live micro-lending via NBFC-P2P partnership
- Migrate the simulated lending module to a live product by routing loans through a licensed NBFC-P2P partner.
- Partner underwrites regulatory compliance under RBI's Master Direction 2017 (revised August 2024) — ₹2 crore paid-up capital, trustee-operated escrow, T+1 fund retention, no credit enhancement, ₹50 lakh aggregate lender exposure cap.
- Platform continues to run the matching, capping, and maintenance-adjustment reconciliation.

### 5.2 Full referral portal with commissions
- Employer-verified job posts pay platform on hire.
- Retention-linked payouts to the referrer (offer, 90-day retention, 365-day retention milestones).
- Cash-coupon incentives redeemable in the bulk-buy marketplace.
- Trust-graph-scoped routing.
- Anti-fraud reserve, hire-attribution window.

### 5.3 Digital ROSCA / chit-group module
- 6-20 person rotating savings inside a society.
- Operates only via partnership with a registered chit company under Chit Funds Act 1982.

### 5.4 Group insurance
- Domestic-help accident and health cover underwritten across the society.
- Operates via an IRDAI-licensed partner (corporate agent, web aggregator, or POSP model).

### 5.5 CSR-sponsored inclusion layer
- Career pathways for domestic-worker children (internships, tuition, mentorship).
- Career-break re-entry programme for resident women.
- Corporate sponsor funds the layer under Section 135 of the Companies Act 2013; platform provides impact reporting.

### 5.6 Native mobile apps
- iOS and Android native builds when the product exits research phase.

### 5.7 Multi-society network effects
- Vendor reputation portable across societies.
- Inter-society bulk-buy for very high-ticket infrastructure (society-wide solar installation, EV charging, security overhaul).

### 5.8 API / SDK / integration mode
- Instead of standalone app, offer the FinTech features as an embedded module inside MyGate / ApnaComplex / ADDA via SDK. Solves the distribution problem.

---

## 6. Revenue model (dissertation-relevant, not implemented)

The dissertation's economic-model chapter models these streams; only the flows that touch the built features are demonstrated on synthetic data.

| Stream | Timing | Modelled? |
|---|---|---|
| Vendor commission on bulk-buy | v1 built | Yes — primary in synthetic-data eval |
| Society subscription fee (₹5-15/flat/month) | v1 built | Yes — secondary in synthetic-data eval |
| Vendor onboarding fee (audited tier) | v1 built | Optional in eval |
| NBFC-P2P partner-shared matching fee | future | Modelled as forward projection |
| Employer commission on successful hire | future | Modelled as forward projection |
| Insurance and ROSCA aggregator commissions | future | Discussed, not modelled |
| CSR sponsorship of inclusion layer | future | Discussed, not modelled |

Sensitivity analysis in the dissertation: adoption rate (30% / 60% / 90%), commission (5% / 10% / 15%), default rate (0% / 5% / 15%) — showing platform viability under realistic scenarios.

---

## 7. Success metrics *(dissertation deliverable)*

- **Technical demonstration**
  - End-to-end escrow flow demonstrated on a synthetic 200-flat society.
  - Zero-loss ledger reconciliation across a simulated month of activity.
  - Role-based access enforced across all built features.
- **Financial simulation**
  - Sensitivity analysis of platform economics across the parameters above.
  - Simulated lending module: default and recovery curves under three repayment options.
- **Analytical contribution**
  - Regulatory-pathway chapter analysing India's NBFC-P2P framework and state Money Lenders Acts against the maintenance-adjustment primitive.
  - Comparison chapter positioning the design against MyGate / ApnaComplex / NoBrokerHood / ADDA on features, revenue model, and legal exposure.

---

## 8. Risks and how the plan handles them

| Risk | Mitigation in this plan |
|---|---|
| P2P lending regulation triggers | Simulated only in v1; live version documented as NBFC-P2P partnership |
| Group buying's failed track record in India | Design centres services (which do coordinate well), not commodity groceries |
| RWA sales cycles kill go-to-market | Dissertation scope: synthetic-data eval, no live pilot required |
| Vendor circumvention post-first-visit | Recurring services + platform-mediated warranty + trust score |
| Committee fraud on society-held funds | Two-person authorisation + immutable audit log + nightly reconciliation |
| Job-blog impersonation and scams | Real resident attribution + verified company email + rate-limit + committee moderation |
| Data protection under DPDP Act 2023 | Consent ledger designed in from foundation; society as Data Fiduciary, platform as Processor |
| Trust score becoming a black-box gate | Hard rules primary; score is secondary and disclosable |

---

## 9. Open decisions still to make *(before we architect the system)*

Only architectural ones remain — no more product-scope questions.

1. **Frontend surface** — mobile-web responsive only, or PWA, or one native app? (Suggest: responsive web-first for the dissertation; leave native for future.)
2. **Payment aggregator** — do we simulate the PA integration or actually wire a sandbox (e.g. Razorpay test mode) for demonstration? (Suggest: sandbox — makes the demo concrete without any real fund movement.)
3. **Synthetic-society scale** — 200 flats standard, or 100 / 500 / 1,000 as parameters? (Suggest: 200 as the default demo; parameters expose adoption sensitivity.)
4. **Simulation horizon** — 3 months / 6 months / 12 months of simulated activity for the lending module? (Suggest: 12 months so seasonal effects and defaults have room.)
5. **Dispute-resolution automation vs. committee-only** — do we design an automated first pass (suggest a resolution based on history), or is every dispute manual to the committee? (Suggest: automated triage, manual final call.)

Once these five are answered, we can move to the system design.
