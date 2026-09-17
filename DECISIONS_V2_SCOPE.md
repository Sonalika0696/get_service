# V2.0 Scope Decisions — Working Log

Decisions taken in session, 2026-09-16, against the V2.0 Report of Understanding and Software Design Document. **Not yet applied to any document.** This log is the input to those amendments.

Status key: 🆕 new · ✏️ changes something already built · 🗑️ removes something already built · ✅ confirms existing

---

## 1. Client architecture

| # | Decision | Status |
|---|---|---|
| 1.1 | **Native mobile app for residents** (React Native + Expo). Supersedes the PWA specified in SDD §2.1 and §2.3. | 🆕 |
| 1.2 | **Website for committee, vendor and platform operator.** Next.js, three role-scoped sections. | ✅ |
| 1.3 | Committee members get a **light approvals inbox on mobile** for time-sensitive actions only. Ledger, reconciliation and roster stay on web. | 🆕 |
| 1.4 | **Platform operator console** — society onboarding, flat import, vendor tier promotion. Requires a role tier above the society scope. | 🆕 |
| 1.5 | **Vendors are first-class users with their own web login** (RoU M4). Blocked today: `UserContextService.load()` returns null without an `Occupancy`, so a non-resident cannot authenticate at all. | ✏️ |
| 1.6 | Non-functional targets adopted from SDD §7: **p95 < 500 ms on read endpoints**, full 400-flat billing run **< 60 s**. | 🆕 |

## 2. Removals

| # | Decision | Status |
|---|---|---|
| 2.1 | **Micro-lending removed.** Already withdrawn in RoU §2.1 (RBI NOF ₹2cr; 16 Aug 2024 closed-user-group prohibition). Repo still carries `AccountKind.LENDING_SIM` and FRONTEND_PLAN Phase 9. | 🗑️ |
| 2.2 | **Wallet, vouchers and society coupons removed.** Already withdrawn in RoU §2.2 (PSS Act 2007 stored-value boundary). Repo still carries `AccountKind.VOUCHER` and FRONTEND_PLAN Phase 6. | 🗑️ |
| 2.3 | **Referral incentives removed**; the Job Blog is retained as a non-financial notice board. | ✏️ |
| 2.4 | **Advisory polls removed.** Community sentiment voting is not wanted. | 🗑️ |
| 2.5 | **Binding general-body polls removed.** Consequence: `Vote`, `VoteChoice`, `PollWeightMode` and ownership-weighted tallying become dead code. | 🗑️ |
| 2.6 | **"Layer 4" dissolved as a layer.** Governance is retained; community voting and social interaction are not. Notifications become cross-cutting infrastructure rather than a late-stage module. | ✏️ |

**Retained despite earlier consideration:** Job Blog / notice board, and vendor rating comments (numeric ratings must stay — vendor tier promotion to *community-rated* depends on them).

## 3. Governance

| # | Decision | Status |
|---|---|---|
| 3.1 | Three-rung approval ladder retained, with **committee majority** replacing the general-body poll at the top rung. No resident votes anywhere in the product. | ✏️ |
| 3.2 | Rung 1 routine: single officer. Rung 2 above lower threshold: **two distinct officers** (SDD I7, same-identity approval rejected). Rung 3 above upper threshold: **configurable majority of the committee roster**. | 🆕 |
| 3.3 | Implementation extends the existing `PayoutAuthorisation` table from an implied two approvers to a configurable N. `DEPUTY_TREASURER` — defined but never checked today — becomes live. | ✏️ |
| 3.4 | Applies to outbound payouts **and** corpus movement / fixed-deposit placement. | 🆕 |

## 4. Service requests and group buying

| # | Decision | Status |
|---|---|---|
| 4.1 | **No solo bookings. Group only.** | ✏️ |
| 4.2 | Any resident may raise a **service request** (AC repair, plumbing) at any time. Other residents facing the same problem **join** the request. This is opt-in, not voting. | ✏️ |
| 4.3 | **The admin sources the vendor** once a request pools. No vendor bidding. Note: this drops the price-competition half of the collective-procurement argument; the saving now comes from aggregation alone, which SDD §9.2 must reflect. | ✏️ |
| 4.4 | On vendor confirmation, **all participants are notified**. | 🆕 |
| 4.5 | **Participation threshold is configurable per service category** — AC repair might proceed at 1, bulk grocery at 15. | 🆕 |
| 4.6 | **Pricing cards bind group pools, not per-flat visits.** M4's freeze → charge sheet → variance detection attaches to a pool's vendor engagement. `Booking` moves away from `(flat, vendor, slot)`. | ✏️ |

| 4.7 | **Both entry points retained.** Residents pull a service into existence (bottom-up request); the committee pushes one out (top-down offer — annual lift AMC, festival bulk order). Both converge on the same pool, vendor engagement and settlement path. Preserves shipped Phase 4C code. | ✅ |

## 5. Events

| # | Decision | Status |
|---|---|---|
| 5.1 | **Events are created by admins only.** Removes M8's "or by a resident subject to committee approval". | ✏️ |
| 5.2 | Admin specifies **per-flat opt-in charge**, refund policy and all descriptive content at creation. | ✏️ |
| 5.3 | Refund policy is **fixed at creation**, not decided after cancellation (SDD §3.5). | ✅ |
| 5.4 | Residents opt in and join. Cultural and common community events. | 🆕 |

## 6. Money

| # | Decision | Status |
|---|---|---|
| 6.1 | **Virtual accounts are per-flat identifiers, not a payment rail.** This departs from V2.0, where the VA transfer is what keeps the platform out of the money path. | ✏️ |
| 6.2 | **Payment runs through UPI collect / Razorpay.** Invariant I2 still holds — Razorpay is an RBI-authorised aggregator holding funds in transit, not the platform — but the compliance argument in RoU §7 and SDD §2.2 must be restated to say so explicitly. | ✏️ |
| 6.3 | VA transfer as a collection mechanism is **deferred, not deleted**. | 🆕 |
| 6.6 | The VA is an **attribution key only — it plays no part in authentication.** Onboarding verification runs entirely through the admin ratification request; phone OTP is the sole resident credential. | 🆕 |
| 6.4 | **Revenue: vendor listing / subscription fee.** `COMMISSION_SINK` and per-payout commission splitting are removed, satisfying I2's "no platform-owned account". PRODUCT_PLAN's 5/10/15% commission sensitivity is replaced. | 🗑️ |
| 6.5 | **Consolidated bills hub (M11)** — maintenance, electricity, water, group-buy contributions, event charges in one payable view per flat. | 🆕 |

## 7. Identity

| # | Decision | Status |
|---|---|---|
| 7.1 | **Phone OTP becomes the primary credential** (RoU M2, SDD §3.1). Currently email OTP; `User.phone` is optional and must become the anchor. | ✏️ |
| 7.2 | Committee officers and vendors authenticate with **password + mandatory 2FA** (SDD §5.1) — a separate path from resident OTP. | 🆕 |
| 7.3 | **Committee ratification of every new resident account** against the imported flat register, before activation. Mitigates the phantom-resident threat (SDD §5.3). | 🆕 |
| 7.4 | Principal model becomes discriminated: **RESIDENT · VENDOR · OPERATOR**. | ✏️ |
| 7.5 | **Bearer-token auth** alongside the session cookie, for the native client. | ✏️ |
| 7.6 | `Vendor` splits into `Vendor` + `VendorSocietyLink` so a vendor serving several societies has one identity and one rating aggregate. | ✏️ |

## 8. Ledger and invariants

| # | Decision | Status |
|---|---|---|
| 8.1 | **SDD I6 violated today**: `Account.balance` is a stored, app-writable column. Either balances become derived-by-query, or I6 is restated to permit a rebuildable cache. | ✏️ |
| 8.2 | Hash-chained audit log retained as built and e2e-proven. **`AuditService.verifyChain` still has no endpoint** — SDD §4.10 requires one any resident can call. | ✏️ |
| 8.3 | Idempotency keys on journal entries retained. | ✅ |

## 9. Open questions

1. **Naming.** With voting removed, `Poll` is misleading — the entity is a request people *join*, and `Vote` becomes dead. Rename to `ServiceRequest` / `Pool` in the data model while keeping "poll" as the resident-facing word?
2. **Does the resident-facing app need a web fallback** for elderly residents on a desktop, or is mobile the only door for residents?
3. Unresolved from RoU §9: reference state for tariff/sub-metering, HT conversion modelling, named BBPOU vs generic, reading retention period, sub-meter deployment assumption.

## 10. Documents needing amendment

| Document | Change |
|---|---|
| `SCOPE_CHANGE_CLIENT_SPLIT.md` | Rewrite — it argues against an SDD that now explicitly specifies a PWA |
| Report of Understanding | Layer 4 dissolution, events admin-only, admin-sourced vendors, revenue model, VA role |
| Software Design Document | §2.1/§2.3 client, §2.2 I2 and I6, §3.5 poll entities, §4.2 escalation, §4.3 pooled bookings, §9.2 simulation, §10 implementation status |
| `FRONTEND_PLAN.md` | Full rewrite around two clients |
| `PRODUCT_PLAN.md` / `DESIGN.md` | Strip lending, wallet, vouchers; restate revenue and native-app position |
| `BACKEND_PLAN.md` | New phases: identity, billing, pricing cards, collections |
| `SUPERVISOR.md` | Phase remap |
| Prisma schema | Remove `VOUCHER` / `LENDING_SIM` / `COMMISSION_SINK`; remove `Vote`; add meters, readings, tariffs, cards, requests, events |

**SDD §10 is materially wrong** — it states only the foundation layer is built and "the remaining modules are not yet built", when Phases 1–5 are complete and e2e-green. Anyone reading it will underestimate progress.
