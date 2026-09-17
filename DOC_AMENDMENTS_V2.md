# Amendments to the Report of Understanding and Software Design Document

Replacement text for the V2.0 documents, section by section. Apply to the Word originals; formatting and front matter are unchanged. Rationale for each change is in [DECISIONS_V2_SCOPE.md](DECISIONS_V2_SCOPE.md).

Legend: **REPLACE** — substitute the named section · **INSERT** — add a new section · **DELETE** — remove entirely

---

# Part A — Report of Understanding

## A1. INSERT after §2.2 — new §2.3

> **2.3 Withdrawal of community voting and social features**
>
> Version 2.0 as first drafted retained advisory polls open to all residents and binding general-body polls restricted to owners. Both are withdrawn, together with the resident-facing social surface built around them.
>
> The reasoning is one of product focus rather than regulation. The platform's contribution is financial operations — procurement, billing, collection and audit. A resident opinion-polling surface adds a second, unrelated product with its own moderation and engagement burden, and nothing in the financial modules depends on it. Governance is retained in full; what is withdrawn is *resident voting*, not committee accountability.
>
> The approval ladder that previously terminated in a binding general-body poll now terminates in a committee majority, specified in M14. This preserves the check on large expenditure without asking residents to vote.

*(Renumber the existing §2.3 "What replaces them" to §2.4.)*

## A2. REPLACE §3, rule R2 row

> | **R2** | The platform never holds customer funds in its own name. | Collections are routed through an RBI-authorised payment aggregator, which holds funds in transit under its own licence and settles to the society's bank account. The society's own dues are held by the society. The platform is a system of record at every point and is never a custodian, so no payment aggregator authorisation is engaged by the platform itself. |

## A3. REPLACE M4, paragraphs 4–6 (booking, breakup, settlement)

> **Booking confirmation:** service engagements are formed at the level of a *pooled request*, not an individual flat (see M7). When the committee assigns a vendor to a pooled request, the request appears in the vendor's queue. The vendor confirms or declines and proposes a window; on confirmation the applicable pricing card is frozen against the pool and pushed to every participating resident's Bills and Payments view before any work begins.
>
> **Visit-charge breakup:** on completion the vendor submits an itemised charge sheet against the frozen card for the engagement. Any line that departs from the card is flagged automatically and requires acknowledgement by the participating residents, or committee adjudication if disputed.
>
> **Settlement:** the society pays the vendor from the relevant sub-ledger after acknowledgement, under the approval ladder defined in M14.
>
> The intent is to eliminate the most common source of friction in society service bookings, which is the undisclosed or retrospectively inflated visit charge. Transparency is enforced structurally: the price is fixed and visible before the work, and departures from it are surfaced rather than buried. Because engagements are pooled, the same frozen card governs every participating flat, and a vendor cannot quote differently to different neighbours for identical work.

## A4. REPLACE M7 in full

> **M7. Service Requests, Pooling and Collective Procurement**
>
> The platform's core resident loop, and the mechanism through which all vendor work is engaged. There is no individual service booking; every engagement is pooled.
>
> Two entry points converge on the same pool:
>
> - **Resident-initiated.** Any resident may raise a request at any time — a failing air-conditioner, a plumbing leak, a pest problem — specifying category, description and preferred window. The request is visible to the society, and any neighbour facing the same problem joins it.
> - **Committee-initiated.** The committee may open a request on the society's behalf for scheduled or repeating procurement: annual maintenance contracts, festival bulk orders, seasonal tanker supply.
>
> A **participation threshold configured per service category** determines whether a pool proceeds. The threshold reflects where aggregation actually helps: an emergency plumbing call may proceed at one participant, a bulk grocery order at fifteen. Below threshold at the closing date the pool lapses and any contributions are returned.
>
> **The committee sources the vendor.** Once a pool is viable, the committee selects a vendor from the directory and assigns the engagement. The vendor confirms, the pricing card freezes against the pool, and every participant is notified. Competitive vendor bidding is not implemented; the saving arises from aggregated volume against a published card rather than from price competition between vendors.
>
> Participating residents pay into a ring-fenced sub-ledger of the society's own account. The society holds the funds as agent for its members under its bye-laws; the platform records but does not hold. Release to the vendor occurs on confirmed delivery and acknowledgement of the charge sheet, under the M14 approval ladder, less any dispute hold-back.
>
> Expenditure above the configured threshold routes to the approval ladder in M14.

## A5. REPLACE M8, first two bullets

> - **Event creation is restricted to the managing committee.** Residents do not create events. The committee specifies the title and all descriptive content, the capacity, the registration window, the **per-flat opt-in charge**, and the refund policy — in full, at the point of creation.
> - Charging is **per flat** on opt-in, with configurable concessions. The refund policy is fixed at creation and cannot be varied afterwards, which removes the discretion that ordinarily causes disputes when an event is cancelled or under-subscribed.

## A5b. REPLACE M3, bullets 2–3 (dual authorisation, approval routing)

*M3 remains the committee's privileged surface. The approval rules themselves move to M14, so M3 must no longer describe escalation to a general-body poll — left unamended, M3 and M14 would contradict each other.*

> - Every outbound payment and every corpus movement is governed by the three-rung approval ladder specified in **M14**: a single officer for routine amounts, two officers of distinct identity above the lower threshold, and a configurable committee majority above the upper threshold. The initiating and approving identities are all recorded.
> - Approval routing compares each amount against the thresholds held in society configuration and assigns the required rung automatically. There is no escalation to a general-body poll; the committee majority is the highest rung.

## A6. REPLACE M14 in full, and move it into Layer 3

> **M14. Governance and Approval**
>
> *(Layer 4 is dissolved. M14 moves into Layer 3 alongside the ledger and treasury, which is where its consequences land. M15 is withdrawn as a module — see A7.)*
>
> Governance in the platform is the control of expenditure, not the collection of opinion. There is no resident voting surface.
>
> A three-rung approval ladder governs every outbound payment and every corpus movement:
>
> | Rung | Condition | Authorisation required |
> |---|---|---|
> | 1 | Below the lower threshold | A single committee officer |
> | 2 | Above the lower threshold | Two officers of **distinct identity**; same-identity approval is rejected at the service layer |
> | 3 | Above the upper threshold | A **configurable majority of the committee roster** |
>
> Thresholds and the majority fraction are configuration held per society, so a bye-law amendment is a data change.
>
> Every instruction, every approval and every rejection is written to the hash chain with the acting identity. The chain therefore records not only that a payment was made but who proposed it, who approved it, and who declined.
>
> Dispute intake is retained: a resident may dispute a charge-sheet line, triage is automatic by category and amount, and final adjudication rests with the committee, recorded to the chain.

## A7. DELETE M15; INSERT a cross-cutting subsection at the end of §5

> **Cross-cutting: notifications**
>
> Notifications are infrastructure rather than a module, and are delivered alongside the feature that raises them rather than as a late-stage deliverable. Push to the resident application, with email and SMS fallback, carrying per-resident preferences and quiet-hours handling. Billing-cycle notices, payment confirmations, arrears reminders, pool-threshold and vendor-confirmation events, pricing-card disclosures and approval requests.
>
> An emergency broadcast path bypasses quiet hours, is restricted to committee officers, and is logged.
>
> Committee dashboards are delivered with the modules whose data they summarise.

*(Section 5's opening sentence becomes: "Fourteen modules are grouped into three layers. Modules M1–M4 establish identity and access; M5–M11 carry money; M12–M14 provide the ledger, treasury and governance substrate.")*

## A8. REPLACE §6, roles matrix — affected rows only

**DELETE** the rows "Vote in advisory polls" and "Vote in binding polls".

**INSERT**:

> | Raise a service request | Yes | Yes | Yes, if delegated | Yes | No |
> | Join an open service request | Yes | Yes | Yes | Yes | No |
> | Create an event | No | No | No | Yes | No |
> | Approve expenditure, rung 2 | No | No | No | Yes, two distinct officers | No |
> | Approve expenditure, rung 3 | No | No | No | Yes, committee majority | No |
> | Assign a vendor to a pool | No | No | No | Yes | No |

*(The existing "Authorise expenditure" row is replaced by the two rung rows above.)*

## A9. REPLACE §7.3

> **7.3 Service requests and collective procurement**
>
> Participating residents pay into the ring-fenced sub-ledger of the society's account through an RBI-authorised payment aggregator, which settles to the society's bank account. Each flat holds a virtual account number that serves as the **attribution key** for its obligations; it is not itself a payment rail in this revision, and is reserved for direct bank transfer in a later one.
>
> On confirmed delivery, and following resident acknowledgement of the vendor's charge breakup against the frozen pricing card, the society settles the vendor under the M14 approval ladder, less any dispute hold-back. Where a pool fails to reach its category threshold, contributions are returned and the pool closes.

## A10. INSERT new §7.6

> **7.6 Platform revenue**
>
> The platform earns through a **vendor listing and subscription fee**, charged to vendors for directory presence and the ability to publish pricing cards. The fee is contracted and settled entirely outside the society's money rails.
>
> No commission is taken from any resident payment, any pooled contribution or any vendor settlement. The platform therefore holds no account in the society's chart of accounts, which is what makes invariant I2 enforceable by construction rather than by policy.
>
> The design tension is acknowledged in the dissertation: the platform earns from the party whose pricing it exists to make transparent. The mitigation is structural — pricing cards are immutable once published, card freezing is enforced at confirmation, and variance detection is automatic — so revenue cannot influence the transparency mechanism without a schema change visible in review.

## A11. REPLACE §8, adding to the non-goals list

> - Resident voting of any kind, advisory or binding, and any community opinion-polling surface.
> - Individual service bookings. Every vendor engagement is a pooled request.
> - Competitive vendor bidding. The committee sources vendors against published pricing cards.
> - Commission or any platform cut of a resident payment or vendor settlement.

---

# Part B — Software Design Document

## B1. REPLACE §1.2, final sentence; INSERT paragraph

> Version 2.0 as first drafted retained resident voting and specified a progressive web application serving all roles. Both are revised here: resident voting is withdrawn in favour of a committee-majority approval ladder, and the client tier is split into a native mobile application for residents and a web application for committee, vendor and platform-operator roles. Section 2.1 and section 2.3 state the revised client architecture.

## B2. REPLACE §2.1, "Client (SPA)" row — two rows

> | **Resident client** | Native mobile application, iOS and Android. Residents interact with the platform in response to events — a pool reaching its threshold, a vendor confirming, a bill publishing — which is a notification-driven pattern that a web client serves poorly. Offline-tolerant, with a persisted read cache and a replayable mutation queue. |
> | **Management client** | Web application serving committee, vendor and platform-operator roles. Data-dense work — billing runs, reconciliation, roster management, approval ladders, audit review — is desk-bound and benefits from screen area rather than portability. |

## B3. REPLACE §2.2, invariants I2, I6, I7; INSERT I8

> | **I2** | The platform holds no funds and earns no commission. | No platform-owned account exists in the chart of accounts. Every cash account belongs to the society or is external. Collection routes through an RBI-authorised payment aggregator, which holds funds in transit under its own licence. The posting layer rejects any journal crediting a platform account, because none exists. Platform revenue is contracted outside the society's rails. |
> | **I6** | Every balance is derived. | Balances are computed from journal lines by query. Where a materialised balance exists it is a rebuildable cache, written only by the posting layer, never by feature code, and asserted equal to the derived value by the test suite and by a scheduled worker. |
> | **I7** | Privileged actions are authorised proportionately. | Expenditure above the lower threshold requires two approvers of distinct identity; above the upper threshold, a configurable majority of the committee roster. The service rejects same-identity approval and rejects execution until the required count is met. |
> | **I8** | No resident voting surface exists. | No vote, ballot or tally entity exists in the schema. Participation in a pooled request or an event is an opt-in record, not a vote, and carries no weighting. |

## B4. REPLACE §2.3, Frontend row — two rows

> | Resident client | React Native with Expo, TypeScript | Native delivery on both platforms from one codebase, with push notification, secure credential storage and background revalidation available as first-class capabilities. Shares generated API types with the backend and the management client. |
> | Management client | Next.js with TypeScript, Tailwind CSS, TanStack Query | One framework serving three role-scoped interfaces; strong form handling for billing runs and approval ladders, where the data density is high and the device is a desktop. |

## B5. REPLACE §3.1, User row; §3.4, VirtualAccount row

> | User | phone, name, email, status, principal kind | Phone is the resident credential. Principal kind is resident, vendor or operator; a vendor or operator holds no occupancy, so identity must not be resolved through the flat. No mandatory government identifier. |

> | VirtualAccount | flat, account number, issued at, active | Issued by the society's bank. **Attribution key only** — it identifies the flat against an obligation or an inbound credit, and plays no part in authentication. Direct transfer to the virtual account is reserved for a later revision; collection in this revision runs through the payment aggregator. |

## B6. REPLACE §3.5, Poll and Vote rows

**DELETE** the `Poll` and `Vote` rows.

> | ServiceRequest | society, raised by flat, origin, category, description, window, threshold, status | Origin is resident or committee. Threshold is read from category configuration at creation and frozen on the request. |
> | Participation | request, flat, joined at, contribution, status | An opt-in record, not a vote. Carries no weight and no choice. |

## B7. REPLACE §4.2, second and third sentences

> Dual authorisation is implemented as a multi-phase state machine: an initiating officer creates a pending instruction, and approvers with distinct identities record approvals against it until the required count is met, at which point the payout or corpus movement executes. The service rejects approval by the initiating identity and by any identity that has already approved. The required count is derived from the amount: two approvers above the lower threshold, and a configured majority of the committee roster above the upper threshold. Execution is blocked until the count is satisfied; there is no general-body poll and no resident participates in the ladder.

## B8. REPLACE §4.3, steps 2–4

> 2. The committee assigns a vendor to a **pooled service request** that has reached its category threshold. There is no individual booking path.
> 3. The engagement appears in the vendor's authenticated queue. The vendor confirms and proposes a window.
> 4. At confirmation the platform freezes the current card version against the pool and writes the freeze to the audit chain. The frozen card renders for every participating flat before the visit.

## B9. REPLACE §4.6 in full

> **4.6 M7 Service requests and pooling**
>
> Requests carry an origin — resident or committee — and pool by category and window. A participation threshold configured per service category, and frozen onto the request at creation, determines viability: below it at closing the pool lapses and contributions are returned. Thresholds are set where aggregation helps, so an emergency call-out may be viable at a single participant while a bulk order is not.
>
> The committee assigns a vendor from the directory; there is no bidding. The vendor's published card is frozen against the pool at confirmation and governs every participating flat identically. Contributions post to a ring-fenced sub-ledger of the society's account, held as agent for participating members under the bye-laws. Release follows confirmed delivery and charge-sheet acknowledgement, under the M14 ladder, less any hold-back on a disputed line.

## B10. REPLACE §5.1, first bullet

> Phone OTP for residents. Password with mandatory second factor for committee officers and vendors, since both can move money or bind prices. Resident sessions issue a bearer token held in platform secure storage; management sessions are cookie-based with short idle expiry on privileged roles.

## B11. REPLACE §7 — add four rows

> | Resident client cold start | Meaningful content within 1 s | Opens to persisted cache; session validation does not block first paint. |
> | Screen transition | Interactive within 100 ms on cached data | Perceived responsiveness dominates measured latency on mobile. |
> | Read endpoint composition | One aggregate request per primary screen | Round trips, not server time, dominate latency on mobile networks. |
> | Mutation safety | Replayed mutations produce no duplicate effect | Idempotency keys; required for an offline mutation queue on unreliable connections. |

## B12. REPLACE §9.2, bullets 1–2

> - Bulk high-tension versus aggregate individual low-tension cost, which quantifies the collective-procurement saving that motivates the design. This is the principal economic result.
> - Sensitivity of that saving to tariff differential, common-area load fraction, and any regulatory cap on the margin a society may recover.
> - Aggregation saving on pooled service requests as a function of participation rate and category threshold, measured against published card rates. Because vendors do not bid, this isolates the volume effect from any price-competition effect, which the dissertation states as a scope boundary rather than an omission.

## B13. REPLACE §10 in full

> **10. Implementation Status**
>
> Implemented, tested and verified end to end against PostgreSQL: the NestJS application and configuration layer; the Prisma schema covering societies, flats, users, occupancies and roles; the **hash-chained audit log** with chain verification, including detection of a deliberately mutated historical row and safety under concurrent append; the **append-only double-entry ledger** with a conservation invariant; **payment integration** against the aggregator sandbox; the **collective procurement flow** from committee-published offer through resident commitment, escrow, sign-off and settlement, including milestone staging and defect-liability retention for large jobs; the vendor directory with GSTIN verification and rating aggregation; and the non-financial notice board with moderation. Seventy-five unit tests and thirty-nine end-to-end tests pass.
>
> Superseded by this revision and pending rework: the resident voting engine, which is withdrawn; per-payout commission, which is withdrawn with the revenue model in RoU §7.6; and the single-society identity assumption, which must be generalised before vendors or platform operators can authenticate.
>
> Not yet built: identity generalisation and society management, utility billing, collection and reconciliation, the vendor portal and pricing cards, service-request pooling, events, treasury, and the remaining collection modules.
>
> Implementation order departs from the order stated in version 2.0 as first drafted, which placed electricity billing first on the grounds that it exercises the ledger, the apportionment logic and the audit chain together. That rationale is now spent: the ledger and audit chain are built and independently verified. Sequencing is therefore by product dependency, beginning with identity generalisation, which blocks the vendor portal, the operator console and every client surface.
