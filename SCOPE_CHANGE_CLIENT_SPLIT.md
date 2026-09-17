# Scope Change Proposal — Client Architecture Split

**Status:** Awaiting supervisor decision
**Raised:** 2026-09-16
**Affects:** [PRODUCT_PLAN.md](PRODUCT_PLAN.md) §5.6, [DESIGN.md](DESIGN.md) §out-of-scope, [FRONTEND_PLAN.md](FRONTEND_PLAN.md) (all phases)
**Decision needed before:** any frontend work begins (currently ⚪ not started)

---

## 1. The ask in one paragraph

Split the client layer into two surfaces instead of one: a **management website** for committee, treasurer, vendors and the platform operator; and a **member surface** for residents, designed mobile-first. This proposal commits only to the *backend* work that both options require. It does **not** commit to building a native mobile app — that decision is deliberately deferred, and the fallback remains the responsive web app already planned.

---

## 2. Where the project stands

| Track | Status |
|---|---|
| Backend Phases 0–5 | 🟢 Complete, e2e-green (75 unit + 39 e2e against real Postgres) |
| Backend Phases 6–10 | ⚪ Vouchers, disputes, lending, reports — not started |
| Frontend, all phases | ⚪ Not started |

Nothing has been built against the current frontend plan, so changing it now costs no rework.

## 3. Why this is being raised now

### 3.1 The backend already encodes the split

The domain model separates two distinct role systems: `RoleKind` (`COMMITTEE`, `TREASURER`, `DEPUTY_TREASURER`) for governance, and `OccupancyRole` (`OWNER_OCCUPIER`, `OWNER_ABSENTEE`, `TENANT`) for residency. Every route is already gated along that line. The proposed client split follows a boundary the API has enforced since Phase 0 — it is not a new abstraction.

### 3.2 The two plans currently contradict each other

FRONTEND_PLAN Phase 4C specifies a vendor-authored offer flow (`(vendor)/vendor/offers/new`, with the discount-ladder editor). The backend gates `POST /offers` to `@Roles(COMMITTEE)`, and the SUPERVISOR demo bar describes it as "a committee posts a vendor offer."

**A vendor login is assumed by the frontend plan and is currently impossible in the backend.** This is a live inconsistency that must be resolved before Phase 2 frontend work regardless of the outcome of this proposal.

### 3.3 Identity is structurally single-audience

`UserContextService.load()` resolves a user by finding their active `Occupancy` and returns `null` if there is none. `AuthGuard` converts that to `401 'No active society membership'`. `CurrentUserContext` requires `societyId` and `occupancyRole` as non-optional fields.

The practical consequence: **a user who does not live in a flat cannot authenticate at all.** That rules out vendors and any platform-level operator. It also means no society, flat, occupancy or role-assignment endpoints exist anywhere in the API — societies are currently created only by the seed script.

### 3.4 The original decision predates the relevant phases

The "mobile-web responsive is enough" decision (PRODUCT_PLAN §5.6, DESIGN.md) was sound when taken. It predates Phases 4–5, which added escrow payment, resident job-card sign-off, and time-boxed polls that auto-fire on reaching a commitment minimum. Those mechanics are notification-driven and time-sensitive: a resident's core interactions are now *"respond to a thing that just happened,"* which is a mobile interaction pattern rather than a presentation-layer detail.

---

## 4. What is proposed

### 4.1 Committed now — backend only

This work is required by the vendor portal and operator console, and is **not wasted** if the member client ships as responsive web:

1. **Principal model rework.** Replace the implicit "resident of one society" identity with a discriminated `RESIDENT | VENDOR | OPERATOR` principal. Touches `UserContextService`, `AuthGuard`, `SocietyScopeGuard`, `CurrentUserContext`.
2. **Vendor as a platform entity.** `Vendor` currently carries a `societyId`, so a vendor serving multiple societies needs one row per society and their rating aggregate fragments across them. Split into `Vendor` + `VendorSocietyLink`.
3. **Society management endpoints.** Society, flat, occupancy and role-assignment CRUD — the entire management half of the website, which has no backend today.
4. **Bearer-token auth.** Accept `Authorization: Bearer` alongside the existing session cookie. The existing DB-backed opaque session tokens already support this; it is a change in one guard.
5. **OpenAPI generation.** `shared/openapi.json` is referenced by FRONTEND_PLAN Phase 0 but does not exist (`shared/types` and `shared/constants` are empty). With more than one client this moves from convenience to necessity.
6. **Audit log read endpoint.** The hash-chained `AuditLog` and `AuditService.verifyChain` exist and are e2e-proven, but nothing exposes them. FRONTEND_PLAN Phase 10 already plans the verification page — one of the four stated novelty claims.

### 4.2 Explicitly *not* committed

- No native iOS/Android build is committed by this proposal.
- Push notifications and a native payments SDK are deferred with it.
- If the native app is not built, the member surface ships as the responsive web app already planned, and items 1–6 above are still fully used.

---

## 5. Cost, risk, and what it buys

**Cost.** One backend phase of identity and society-management work, inserted before frontend Phase 1. Items 1–3 are the bulk of it; items 4–6 are small.

**Risk.** The honest risk is surface proliferation: the plan goes from one unbuilt client to as many as four (admin web, vendor portal, operator console, member app), while backend Phases 6–10 remain unbuilt. This is mitigated by deferring the native decision — the first three are sections of a single Next.js app, which is what FRONTEND_PLAN already describes.

**What it buys the demonstration.**
- Resolves the vendor-login contradiction blocking frontend Phase 2.
- Makes the vendor portal in FRONTEND_PLAN Phases 2/4/5 buildable as written.
- Lets the audit-chain verification page (novelty claim) actually be built.
- Enables an end-to-end demo that includes society onboarding, rather than starting from a seeded database.

**What it costs the demonstration if rejected.** The vendor-facing half of FRONTEND_PLAN must be cut or re-specified as committee-proxied, and the identity limitation remains an acknowledged constraint in the write-up.

---

## 6. Decision requested

1. **Approve the backend work in §4.1** — required under every option, including keeping the current responsive-web scope.
2. **Note the deferral in §4.2** — the native mobile decision returns for a separate call after backend Phases 6–10, with responsive web as the standing fallback.

If only item 1 is approved, the project continues on the documented responsive-web plan with the vendor and operator surfaces made buildable. No part of §4.1 is contingent on the native app.

---

## 7. Proposed client split (for reference)

Reference detail for the decision above, not part of the ask.

### Management website — committee, treasurer, vendor, operator

| Area | Backend today |
|---|---|
| Society setup: config, flats, maintenance amounts | ❌ none |
| Resident roster: occupancies, move-in/out, delegation | ❌ none |
| Role management: assign COMMITTEE / TREASURER | ❌ none |
| Audit trail review + chain verification | ❌ service exists, unexposed |
| Vendor management: onboard, approve, GSTIN, tier | ✅ |
| Offer authoring: ladders, milestones, retention | ✅ |
| Treasury: ledger, reconciliation, adjustments, refunds | ✅ |
| Payouts: authorise payout and milestones, release retention | ✅ |
| Moderation: flag / remove job posts | ✅ |

### Member surface — resident

| Area | Backend today |
|---|---|
| Auth, profile, KYC upload | ✅ |
| Bulk-buy offers: browse, commit, pay (Flow A) | ✅ |
| Resident-initiated polls with vendor tagging (Flow B) | ✅ |
| Governance: vote, create, join events | ✅ |
| Vendors: browse, rate, request access | ✅ |
| Job blog: browse, post | ✅ |
| Job cards: sign off | ⚠️ sign-off only; no "my jobs" list |
| Home feed: what needs my action | ❌ no aggregate endpoint |
| Committee approvals inbox (time-sensitive actions only) | ❌ no aggregate endpoint |

The member surface is largely built. The management surface is roughly half missing — and the missing half is the part with no backend at all.
