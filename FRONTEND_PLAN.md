# Frontend Implementation Plan

**Version 2.0 — two clients.** Companion to [ARCHITECTURE.md](ARCHITECTURE.md), the V2.0 Report of Understanding and the V2.0 Software Design Document. Decisions driving this rewrite are logged in [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).

Supersedes v1.0, which planned a single Next.js PWA with four route groups. That plan is void: it assumed a vendor login the backend could not support, and it included lending and voucher surfaces that are now out of scope.

**Delivery principle, retained from v1.0:** every phase leaves both clients runnable and usable. No phase is a refactor with nothing to show.

---

## 1. The two clients

| | **Resident app** | **Management web** |
|---|---|---|
| Stack | React Native + Expo, TypeScript | Next.js App Router, TypeScript |
| Users | Owner-occupier, owner-absentee, tenant | Committee, vendor, platform operator |
| Auth | Phone OTP → Bearer token in secure storage | Password + mandatory 2FA (SDD §5.1) |
| Character | Notification-driven, one-handed, in-the-moment | Deliberate, data-dense, desk-bound |
| Delivery | App stores (iOS + Android) | Web |

Committee members are residents too. They get the full resident app **plus** a light approvals inbox (§5, Phase F6). Everything data-dense — ledger, reconciliation, billing runs, roster — stays on web.

### Why split at all

The backend has enforced this boundary since Phase 0. `RoleKind` (COMMITTEE / TREASURER / DEPUTY_TREASURER) and `OccupancyRole` (OWNER_OCCUPIER / OWNER_ABSENTEE / TENANT) are separate systems, and every route is already gated along that line. The clients follow a seam that exists, rather than inventing one.

---

## 2. Division of labour

Explicit, because it shapes how every ticket is written.

**You own the surface.** Visual design, colour, typography, spacing, iconography, motion, brand, illustration, empty-state copy tone.

**This plan owns the substrate.** Information architecture, screen-to-endpoint contracts, state management, caching and invalidation, optimistic mutation, offline behaviour, perceived performance, accessibility structure (roles, labels, focus order, touch targets), and error taxonomy.

Concretely: this plan decides that the bills hub is one request returning one payload with every obligation pre-composed. It does not decide what that screen looks like.

---

## 3. Performance contract

The explicit ask is that the app feel seamless and that latency be engineered rather than hoped for. SDD §7 gives the targets; this section says how they are met.

### 3.1 Budgets

| Target | Source |
|---|---|
| **p95 < 500 ms** on read endpoints | SDD §7 |
| Full billing run, 400 flats, **< 60 s** | SDD §7 |
| Cold start to meaningful content: **< 1 s** | This plan |
| Screen transition to interactive: **< 100 ms** on cached data | This plan |

The 500 ms is an end-to-end budget on a mid-range Android over mobile data. Mobile RTT alone consumes 100–200 ms, so the server-side allowance is roughly: **DB work < 200 ms, serialisation < 50 ms.** Any endpoint that cannot hold that becomes a worker job with a push notification on completion, not a slow request.

### 3.2 One screen, one request

The single biggest lever on mobile. Every primary screen is backed by exactly one aggregate endpoint returning a payload shaped for that screen — never a generic resource the client must fan out from.

| Screen | Endpoint | Composes |
|---|---|---|
| Home | `GET /me/home` | Amount due, actions needed, joinable requests, my requests, upcoming events |
| Bills hub | `GET /me/bills` | Maintenance, electricity, water, group-buy contributions, event charges (M11) |
| Request detail | `GET /requests/:id` | Participants, threshold progress, vendor, frozen card, charge sheet |
| Approvals inbox | `GET /me/approvals` | Pending payouts, corpus movements, ratification queue |

The bills hub is the one to watch: it composes obligations from six modules. It must resolve as a single query with joins, not six service calls in a loop. This gets a dedicated read model if the join cost exceeds budget.

### 3.3 The rest of the substrate

- **Cursor pagination everywhere**, never offset. Lists mutate under the user; offset pagination duplicates and skips rows.
- **Conditional requests.** `ETag` / `If-None-Match` on every list endpoint. An unchanged list costs a 304 and no body.
- **Persisted read cache.** TanStack Query persisted to MMKV. The app opens to last-known state instantly and revalidates in the background — this, more than raw latency, is what makes an app feel instant.
- **Optimistic mutations with rollback** on join-request, event opt-in, charge-sheet acknowledgement, vendor rating. The user never waits on a round trip to see their own action land.
- **Offline mutation queue.** Mutations taken offline queue and replay on reconnect. Safe because the backend already enforces idempotency keys on journal entries — a replayed mutation cannot double-post.
- **Push, never poll.** Vendor confirmed, threshold reached, bill published, sign-off due, approval pending. No polling loops draining battery or burning data.
- **Explicit per-screen DTOs.** No endpoint returns a nested entity graph "in case the client needs it". Over-fetching is the default failure mode of a generated client, and it is expensive on mobile data.
- **Cold start never blocks on auth.** Token reads from secure storage synchronously; the cached shell renders immediately; session validation happens in parallel and only downgrades the UI if it fails.

### 3.4 Instrumentation

Server timing headers on every endpoint from Phase F0, and a p95 dashboard per endpoint from Phase F1. A budget nobody measures is a budget nobody meets. Any endpoint exceeding 500 ms p95 is a bug with the same priority as a functional defect.

---

## 4. Shared foundations

Both clients consume one generated API client. `shared/openapi.json` is referenced by the v1.0 plan but does not exist, and `shared/types` and `shared/constants` are empty directories — this is now blocking rather than cosmetic.

- **`shared/openapi.json`** generated from NestJS decorators; the typed client generated from it. Regenerated on every backend contract change, and CI fails if it drifts.
- **`shared/constants`** for enums that must agree across clients: service categories, occupancy roles, status vocabularies.
- **Design tokens** as a shared package — one source for colour, spacing and type scale, consumed by Tailwind on web and by the RN theme. You set the values; both clients read them.

---

## 5. Phases

Numbered `F0`–`F9` to avoid collision with backend phase numbers. Each phase names the modules it delivers and the backend phase that unblocks it.

| Frontend | Depends on backend | Modules |
|---|---|---|
| F0 Foundations | Phase 6 (OpenAPI generation) | — |
| F1 Identity and onboarding | **Phase 6** | M1, M2 |
| F2 Notice board and vendor directory | Phases 1–2 *(already shipped)* | M4 read-only |
| F3 Vendor portal and pricing cards | Phase 7 | M4 |
| F4 Service requests and pooling | Phase 8 | M7 |
| F5 Payments and the bills hub | Phase 9 | M11, M12 partial |
| F6 Approvals and the governance ladder | **Phase 6** | M14 |
| F7 Electricity and water billing | Phase 10 | M5, M6 |
| F8 Events, charge sheets and settlement | Phase 11 | M8, M4 |
| F9 Treasury, audit and polish | Phase 12 | M12, M13, M9, M10 |

F2 is deliberately early: it runs entirely on shipped endpoints, so the app has real content while Phase 7 and 8 backends are still being built. F6 can start as soon as Phase 6 lands, in parallel with F3–F5.

### F0 — Foundations *(nothing user-visible)*

**Modules:** —

- Monorepo: `apps/mobile` (Expo), `apps/web` (Next.js), `packages/api-client`, `packages/tokens`
- `shared/openapi.json` generated; typed client generated; CI drift check
- Mobile: Expo Router, secure token storage, persisted query cache, push registration scaffold, error boundary, offline banner
- Web: App Router, role-scoped layouts, TanStack Query, toast, error boundary
- Server-timing headers and the p95 dashboard
- `/dev/ui` playground on both clients so tokens are visually verifiable

**Done when:** both clients build, authenticate against a seeded backend, and the p95 dashboard reports live numbers.

---

### F1 — Identity and onboarding

**Modules:** M1, M2

- **Mobile:** phone OTP sign-in → claim a flat → "awaiting committee approval" state → approved. The pending state is a real screen, not a spinner; residents will sit in it for hours.
- **Web (committee):** ratification queue — approve or reject each claim against the imported flat register (mitigates the phantom-resident threat, SDD §5.3)
- **Web (committee):** flat register CSV import with validation that area factors sum to unity
- **Web (operator):** create a society, assign the first committee officer
- **Web:** password + 2FA enrolment for committee and vendor accounts

**Done when:** an operator creates a society, imports 90 flats, a resident signs up by phone, a committee member ratifies them, and the resident lands on an empty home screen.

---

### F2 — Notice board and vendor directory

**Modules:** M4 (read-only), notice board

Both are already backed by shipped, e2e-green endpoints — this phase is mostly client work and gives the app content early.

- **Mobile:** browse and post notices; vendor directory with category and radius filters; vendor detail with rating aggregate and verification tier
- **Web (committee):** notice moderation (flag / remove); vendor onboarding with GSTIN verification and tier promotion
- **Web (operator):** promote a vendor to `PLATFORM_AUDITED`

**Done when:** a resident browses vendors and posts a notice from their phone.

---

### F3 — Vendor portal and pricing cards

**Modules:** M4 (full)

- **Web (vendor):** sign in; publish a pricing card per category — visit charge, labour basis, materials handling, minimum charge, GST rate, conditions per line
- Card versioning UI: published cards are immutable; a revision creates a new version and the superseded one stays readable
- **Mobile:** view a vendor's current card before committing to anything

**Done when:** a vendor publishes a card, revises it, and both versions remain retrievable.

---

### F4 — Service requests and pooling

**Modules:** M7

The core resident loop, and the phase that defines the product.

- **Mobile:** raise a request (category, description, preferred window); browse open requests from neighbours; **join one you also need**; track threshold progress
- **Mobile:** request detail showing participants, progress toward the category threshold, and status
- **Web (committee):** request queue; configure the participation threshold **per category**; source and assign a vendor to a pooled request
- **Web (committee):** post a top-down group offer — annual contracts, festival bulk orders (retains shipped Flow A)
- **Web (vendor):** incoming engagement queue; confirm or decline; propose a slot. **Card freezes at confirmation** and the freeze is written to the audit chain
- **Push:** threshold reached; vendor confirmed — all participants notified

**Done when:** a resident raises "AC not cooling", two neighbours join, the committee assigns a vendor, the vendor confirms, and all three residents get a push with the frozen price.

---

### F5 — Payments and the bills hub

**Modules:** M11, part of M12

- **Mobile:** consolidated bills hub — every obligation for the flat in one list, ordered by due date. Each line shows its **computation basis** and links to underlying evidence: the meter reading, the apportionment formula, the pooled request, the frozen card
- **Mobile:** pay via UPI collect / Razorpay. Rail is labelled, because who holds the money differs by obligation type
- **Mobile:** full statement history, exportable
- **Web (committee):** collection status by flat and category; arrears ageing; unmatched-credit review queue

**Done when:** a resident sees maintenance, a group-buy contribution and an event charge in one view and clears all three in one payment session.

---

### F6 — Approvals and the governance ladder

**Modules:** M14 (rules), M3 (committee console surface)

- **Web (committee):** three-rung approval ladder — single officer routine; **two distinct officers** above the lower threshold; **configurable committee majority** above the upper threshold. Same-identity approval rejected and shown as rejected in the UI
- **Web (committee):** policy editor for thresholds, late fees and instalment forbearance — configuration, not code
- **Mobile:** committee **approvals inbox** — the one admin surface on mobile. Read the instruction, see the amount and counterparty, approve or decline. Nothing data-dense
- **Push:** approval pending, targeted at role holders

**Done when:** a payout above the upper threshold collects a committee majority across two officers' phones and one desktop, and the audit chain records every identity.

---

### F7 — Electricity and water billing

**Modules:** M5, M6

The heaviest web surface and the backend's highest-value module.

- **Web (committee):** billing cycle wizard following the SDD §4.4 pipeline — ingest readings (manual or CSV) → validate with anomaly flags → compute slabs → apportion common area → **reconcile against the bulk invoice** → publish
- Flagged meters halt the cycle with an explicit review step. A suspect reading must never silently become a bill
- **Web:** variance published, not absorbed — the reconciliation screen is resident-visible by design
- **Web (water):** three-source cost pool (municipal, tanker, borewell) with the blended per-kilolitre rate and its derivation
- **Mobile:** the flat's bill with its **computation trace** — the formula and inputs, not just the figure
- Long-running run executes as a worker job with progress; it never blocks a request

**Done when:** twelve months of synthetic readings produce twelve reconciled cycles, and a resident can trace any charge back to a reading.

---

### F8 — Events, charge sheets and settlement

**Modules:** M8, remainder of M4

- **Web (committee):** create an event — **admin-only**. Per-flat opt-in charge, capacity, registration window, concessions, and a **refund policy fixed at creation**
- **Mobile:** browse events; see the per-flat charge and refund policy *before* opting in; opt in and pay; waitlist with automatic promotion
- **Web (vendor):** submit an itemised charge sheet against the frozen card after work completes
- **Mobile:** charge sheet displayed beside the frozen card with **every out-of-card line flagged**; acknowledge or dispute
- **Web (committee):** adjudicate disputes with both documents as evidence; settle the vendor under the approval ladder, less any hold-back

**Done when:** a vendor submits a sheet with one out-of-card line, the resident disputes it, the committee adjudicates, and settlement reflects the decision.

---

### F9 — Treasury, audit and polish

**Modules:** M12, M13, M9, M10

- **Web (treasurer):** sub-ledger balances reconciling to the bank balance; cross-pocket journal requiring dual authorisation
- **Web (treasurer):** corpus fixed-deposit placement with maturity ladder, two approver identities required
- **Web:** **audit chain verification** — tail hash, "verify chain", and either "intact through row N" or "first divergence at row K". One of the four novelty claims, and still unexposed by any endpoint today
- Health camps (M9) and donations (M10) — both deliberately minimal
- Accessibility pass: WCAG 2.1 AA on resident-facing screens (SDD §7 — the resident population includes elderly users). Touch targets, focus order, screen-reader labels, contrast
- Empty states, skeletons everywhere, no bare spinners
- Localisation scaffold: English with the translation layer in place

**Done when:** the audit chain verifies from the UI, a tampered row is caught at the right position, and the accessibility audit passes.

---

## 6. Explicitly out of scope

Stated so they are not read as omissions. All follow from [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).

- Lending, credit, or any deferred-payment surface
- Wallet, vouchers, stored value, society coupons
- Advisory polls, binding general-body polls, any resident voting UI
- Solo service bookings — every engagement is a pooled request
- Vendor bidding — the committee sources vendors
- Referral matching and referral incentives
- Any screen displaying health information
- Family sub-accounts within a flat

---

## 7. Standing tasks, every phase

- Regenerate the API client on any backend contract change; CI fails on drift
- Every new endpoint carries a p95 measurement before the phase closes
- One Playwright happy path (web) and one Maestro flow (mobile) per phase
- Update [SUPERVISOR.md](SUPERVISOR.md) as items complete
- Copy reads like a product — no lorem ipsum, no dev jargon reaching the user
- Every mobile screen tested at 375 px; every list tested with 0, 1 and 200 items
