# Frontend Implementation Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Sequenced, incremental, single-feature-first. Every phase leaves the app **runnable and usable**.

Delivery principle: **the app is usable at Phase 1** — you can log in and post a job. Every phase after adds one feature on top of a working app, never breaking earlier flows.

Phase numbering mirrors [BACKEND_PLAN.md](BACKEND_PLAN.md) so frontend and backend can be developed in lockstep. Progress is tracked in [SUPERVISOR.md](SUPERVISOR.md).

---

## Phase 0 — Foundation *(nothing user-visible yet)*

**Goal:** Next.js app runs, connects to the backend, has the design system in place.

- [ ] Scaffold Next.js 16 App Router in `frontend/`, TypeScript strict mode
- [ ] Tailwind + shadcn/ui base primitives installed (button, input, card, dialog, toast)
- [ ] `app/layout.tsx` with root providers: theme, TanStack Query, toaster
- [ ] `lib/api/` typed API client generated from `shared/openapi.json` (empty for now)
- [ ] `.env.local.example` with `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`
- [ ] Health-check landing at `/`: renders "Society FinTech" title + backend health probe result
- [ ] Global 404 and error boundary
- [ ] Storybook or a `/dev/ui` playground route with shadcn primitives so the design system is visually verified

**Definition of done:** `pnpm --filter frontend dev` opens `http://localhost:3000` and shows the health probe green.

---

## Phase 1 — Auth and Job Blog *(first usable page)*

**Goal:** a resident can sign up, verify via OTP, log in, post a job, browse jobs, and get flagged posts moderated by committee.

- [ ] `(auth)` route group: `/login`, `/signup`, `/verify`
  - Session cookie set on verify; SSR reads it for redirect
- [ ] `(resident)` route group with `AppShell` (top bar, sidebar, user menu)
- [ ] `/dashboard` placeholder page listing what's available (Job Blog only at this point)
- [ ] `/jobs`:
  - List view (kind filter: hiring / seeking)
  - `[postId]` detail view
  - `/jobs/new` create form (hiring vs seeking radio)
    - Hiring: company email input → "we'll verify" message → after post, a pending banner until email verified
    - Rate-limit copy visible in the form
- [ ] `(committee)` route group: `/admin/jobs` — flag/unflag/remove posts
- [ ] Toasts for actions; loading skeletons on the list
- [ ] Role-based server-side redirect in each group's `layout.tsx`
- [ ] Guard component: `<RequireRole role="COMMITTEE">…</RequireRole>` for client-side gates

**Definition of done:** the demo flow — signup → OTP → post a job → verify company email → post visible — works end-to-end in a fresh clone.

---

## Phase 2 — Vendor Marketplace

**Goal:** residents browse vendors; committee onboards them; residents see vendor records with ratings.

- [ ] `(resident)/marketplace` list view: filters by category, radius, tier
- [ ] `(resident)/marketplace/[vendorId]` vendor record page:
  - Rating aggregate, on-time %, dispute rate (all backed by the aggregate, even if numbers are small)
  - Category chips, service radius map (static image or a lightweight Leaflet embed if trivial)
  - "Request access" / rating stub button (real ratings become active in Phase 4)
- [ ] `(committee)/admin/vendors`:
  - Vendor onboarding form: name, contact, geolocation, radius, categories, tier
  - Approve / suspend / audit-tier bump
- [ ] `(vendor)` route group scaffolded (login shell) — full vendor tools come in Phase 4

**Definition of done:** a committee onboards a vendor; residents see it and can view its record.

---

## Phase 3 — Event polls (poll mechanic, no money)

**Goal:** any resident can create an event poll; neighbours can join; the poll fires on minimum or expires.

- [ ] `(resident)/polls` list view (event polls only at this stage)
- [ ] `/polls/new`: type = event; fields — title, description, min-commitments, deadline
- [ ] `[pollId]` detail: joiners list, join button, close-early button (creator only), state chip (open / fired / expired)
- [ ] Real-time-ish polling: TanStack Query with polling on the detail page
- [ ] Notifications shown in-app on join, fire, expire

**Definition of done:** the poll UX is complete and reusable. Adding bulk-buy Flow B in Phase 5 will slot in.

---

## Phase 4 — Bulk-Buy Flow A + Razorpay Checkout

**Goal:** the vendor-initiated offer end-to-end: a vendor publishes; residents commit through Razorpay Checkout; sign-off; treasurer co-authorises payout; commission math visible.

### 4A — Ledger + treasury views (read-only for residents; deep for treasurer)
- [ ] `(committee)/admin/treasury` page: sub-account balances, recent entries, filter by kind
- [ ] Reconciliation view stub (real reconciliation lights up in Phase 4B–4C)

### 4B — Razorpay Checkout wrapper
- [ ] `components/razorpay/Checkout.tsx`: initializes Razorpay Checkout with an order created via backend, resolves on payment success/failure, retries safely
- [ ] Fallback UI when Razorpay script fails to load

### 4C — Vendor offer flow
- [ ] `(vendor)/vendor/offers` list
- [ ] `(vendor)/vendor/offers/new`: category, unit price, discount %, min N, deadline, recurring toggle
- [ ] `(resident)/offers` list (Flow A visible)
- [ ] `(resident)/offers/[offerId]`: commit button opens Razorpay Checkout
- [ ] On success: commitment card appears in the resident's dashboard with status chip

### 4D — Job cards, sign-off, payout
- [ ] `(resident)/dashboard`: "My upcoming services" card list — each with sign-off action
- [ ] Sign-off dialog with rating capture (writes to vendor rating aggregate)
- [ ] `(vendor)/vendor/jobs`: today's jobs, per-flat completion mark
- [ ] `(committee)/admin/treasury/payouts`: pending payouts, treasurer co-authorise button
- [ ] Large-job milestone UI: milestone cards with per-stage authorise action

**Definition of done:** the demo — vendor posts offer → 3 residents commit with Razorpay test cards → funds visible in escrow view → sign-off → treasurer authorises → payout → ledger balanced.

---

## Phase 5 — Bulk-Buy Flow B (resident-initiated polls with vendor tagging)

**Goal:** a resident picks a vendor from the marketplace and pulls a group buy into existence.

- [ ] `/polls/new` gains a `type = bulk_buy` variant with vendor picker
- [ ] Vendor-side inbox: `(vendor)/vendor/offers` gains an "Incoming poll tags" list; accept/decline with confirmed minimum
- [ ] On fire: reuses the Phase 4 Razorpay + escrow + payout path
- [ ] Weekly-recurring subscription entry point on `/marketplace/[vendorId]` for eligible categories (staples, cleaning)

**Definition of done:** the two flows sit side by side in the app; a resident can go either way from the same marketplace.

---

## Phase 6 — Voucher wallet

**Goal:** the wallet is visible; vouchers redeemable inside the bulk-buy commitment flow.

- [ ] `(resident)/wallet` page: balance, transactions, expiring vouchers, source labels (promo, lending-repayment [SIM])
- [ ] Commitment flow: "Apply vouchers" step before Razorpay Checkout; splits the payment
- [ ] Toast confirmations on redemption

**Definition of done:** a resident can pay part of a bulk-buy commitment with vouchers, the rest via Razorpay, and the UI accurately reflects both.

---

## Phase 7 — Governance and Disputes (automated triage UI)

**Goal:** disputes have a first-class UI; committee sees automated triage recommendations and accepts/overrides.

- [ ] `(resident)` per-job "Report an issue" button opens dispute intake
- [ ] Dispute types with guided form (missed SLA, quality, payment mismatch, no-show)
- [ ] `(committee)/admin/disputes`:
  - Queue with triage recommendation prominent
  - Accept / override with reason
  - History pane of the underlying job + payment events
- [ ] Governance: `(committee)/admin/governance` proposals + votes; society-wide vote page for residents when applicable

**Definition of done:** a disputed job's UX from open → triage → decision → refund/payout is smooth on both sides.

---

## Phase 8 — Simulation dashboard *(dissertation-facing)*

**Goal:** the top-level `/simulation` route renders the sensitivity analysis and scenario reports produced by the Python harness.

- [ ] `/simulation` root: scenario picker (baseline, low opt-in, high default, all-maintenance, all-voucher, mixed)
- [ ] Charts (Recharts):
  - Pool health over time
  - Default rate sensitivity heatmap
  - Repayment-option comparison
  - Aggregate KPIs
- [ ] `/simulation/report` renders a fuller report view suitable for embedding in dissertation screenshots
- [ ] "Reproducibility" panel: shows scenario seed, parameters, and timestamp of the underlying run

**Definition of done:** the dashboard reads real output from `simulation/outputs/report.json` and renders every chart the dissertation will cite.

---

## Phase 9 — Lending UI (owner-only, simulation-labelled)

**Goal:** the lending module exists in the app as a first-class product surface — clearly labelled *simulation-only*.

- [ ] `(resident)/lending` — gated to `OWNER` role only; tenants see a "Not available on your account" panel with the rationale
- [ ] Non-dismissible **SIMULATION — NO REAL MONEY** banner on every lending route
- [ ] Borrower flow: `/lending/request` → amount (capped, hard rules validated client-side) → purpose → repayment mode picker (Maintenance Adjustment / Voucher / Bank Transfer)
- [ ] Lender flow: `/lending` shows outstanding pledges, active loans, projected returns
- [ ] Maintenance-adjustment preview: shows next 6 months of adjusted maintenance charges on both sides
- [ ] Committee lending view: aggregates only, never per-resident balances
- [ ] Empty-state copy that ties clearly to the simulation dashboard for scenario data

**Definition of done:** a walkthrough of a simulated loan — request → agreement → maintenance-adjustment schedule — reads naturally, and the simulation banner is impossible to miss.

---

## Phase 10 — Reports, admin polish, accessibility

**Goal:** everything sharp enough for a dissertation viva.

- [ ] `(committee)/admin/reports`: monthly financial statement generator (renders + downloads PDF stub)
- [ ] `(committee)/admin/audit`: filterable audit log view
- [ ] Empty states for every list (no offers, no vendors, no disputes)
- [ ] Loading skeletons everywhere; no bare spinners
- [ ] Accessibility: keyboard navigation on all critical flows; ARIA labels on charts; contrast checks
- [ ] Responsive pass: 375px phone width tested for every route
- [ ] Dark mode audit (theme tokens correct in both)

**Definition of done:** the app looks and behaves like a production product, not a prototype.

---

## Standing tasks (every phase)

- Regenerate the typed API client after any backend contract change.
- Add a Playwright happy-path test for the new flow.
- Update `SUPERVISOR.md` as each item completes.
- Copy is written like a real product — no lorem ipsum, no dev jargon leaking to the user.
- Every new page has a proper `<title>` and a working back-link.
