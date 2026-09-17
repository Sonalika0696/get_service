/**
 * DTOs mirroring the shipped backend contracts. Hand-authored today; will be
 * replaced by the generated client once the backend emits shared/openapi.json.
 * Field types match `backend/prisma/schema.prisma` and the *Service.toDetail /
 * toPublic mappers.
 */

// ------------ Vendors (backend/src/modules/vendors) ------------

export type VerificationTier =
  | 'UNVERIFIED'
  | 'SOCIETY_ATTESTED'
  | 'PLATFORM_AUDITED';

export type VendorDetail = {
  id: string;
  societyId: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  gstin: string | null;
  gstinVerifiedAt: string | null;
  verificationTier: VerificationTier;
  ratingAvg: string | number; // Prisma Decimal serialises as string on the wire
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
  categories: string[];
};

export type ListVendorsQuery = {
  category?: string;
  q?: string;
};

export type RateVendorBody = {
  rating: number; // 1..5
  comment?: string;
};

// ------------ Job blog / community feed (backend/src/modules/job-blog) ------------

export type JobBlogKind = 'HIRING' | 'SEEKING';
export type JobBlogStatus = 'ACTIVE' | 'FLAGGED' | 'REMOVED';

export type JobBlogPost = {
  id: string;
  societyId: string;
  posterId: string;
  kind: JobBlogKind;
  title: string;
  body: string;
  status: JobBlogStatus;
  expiresAt: string;
  companyEmail: string | null;
  companyEmailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJobPostBody =
  | { kind: 'SEEKING'; title: string; body: string }
  | { kind: 'HIRING'; title: string; body: string; companyEmail: string };

// ------------ Resident-initiated bulk-buy polls (Flow B, M7 pooling) ------------

export type PollType = 'EVENT' | 'BULK_BUY_RESIDENT';

export type PollStatus = 'OPEN' | 'FIRED' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';

/** GET /bulk-buy/polls, GET /bulk-buy/polls/:id — the API-facing shape. */
export type ResidentPollDetail = {
  id: string;
  societyId: string;
  creatorId: string;
  pollType: PollType;
  title: string;
  description: string | null;
  category: string | null;
  minCommitments: number | null;
  closesAt: string;
  status: PollStatus;
  firedAt: string | null;
  closedAt: string | null;
  taggedVendorId: string | null;
  vendorConfirmedAt: string | null;
  vendorDeclinedAt: string | null;
  vendorConfirmedMinimum: number | null;
  vendorUnitPrice: string | number | null;
  vendorDiscountLadder: unknown;
  createdAt: string;
  updatedAt: string;

  commitmentCount: number;
  hasJoined?: boolean;
  bookingId: string | null;
};

export type CreateResidentPollBody = {
  taggedVendorId: string;
  category: string;
  title: string;
  description?: string;
  proposedMinimum: number;
  closesAt: string; // ISO-8601
};

// ------------ Bills hub (M11 + partial M12, FRONTEND_PLAN §3.2) ------------

/**
 * Who collects and holds the money for this obligation. FRONTEND_PLAN §5.F5:
 * "the rail is labelled, because who holds the money differs by obligation
 * type". SDD compliance invariant I2 forbids the platform from holding funds
 * ever, so every rail here is either the society's own account or the
 * vendor's, never ours.
 */
export type PaymentRail =
  | 'SOCIETY_UPI'      // Society collects: maintenance, water, electricity, event charges
  | 'BULK_BUY_ESCROW'  // Society-held escrow for a pooled request, released to vendor on sign-off
  | 'VENDOR_DIRECT';   // Vendor collects direct (rare — e.g. some third-party utility)

/**
 * What kind of obligation a bill line is. Drives the icon, the copy, and
 * which evidence link renders on the detail screen.
 */
export type BillKind =
  | 'MAINTENANCE'
  | 'ELECTRICITY'
  | 'WATER'
  | 'BULK_BUY_SHARE'
  | 'EVENT_CHARGE'
  | 'ADJUSTMENT';

export type BillStatus = 'DUE' | 'OVERDUE' | 'PAID' | 'PARTIAL' | 'DISPUTED';

/**
 * `evidenceRef` names the source-of-truth artifact behind the amount. The
 * bill detail screen turns it into a deep link (e.g. bulk-buy poll for
 * BULK_BUY_SHARE, a meter reading id for ELECTRICITY once M5 lands).
 */
export type EvidenceRef =
  | { kind: 'POLL'; pollId: string }
  | { kind: 'BOOKING'; bookingId: string }
  | { kind: 'METER_READING'; readingId: string }
  | { kind: 'EVENT'; eventId: string }
  | { kind: 'FROZEN_CARD'; cardId: string }
  | { kind: 'JOURNAL'; entryId: string };

export type BillLine = {
  id: string;
  kind: BillKind;
  title: string;
  /**
   * The one-line rationale the resident should read *before* they pay.
   * "0.7 kWh common-area share × slab 2 × 12 flats" beats "electricity".
   */
  basis: string;
  amountMinor: number;
  currency: string;
  dueOn: string;
  status: BillStatus;
  rail: PaymentRail;
  evidence?: EvidenceRef;
};

export type BillsHubResponse = {
  asOf: string;
  totalDueMinor: number;
  currency: string;
  lines: BillLine[];
};

// ------------ Home + Bills aggregates (shipped: GET /me/home, GET /me/bills) ------------

/** One row in HomeAggregate.joinableServiceRequests — a resident-poll the
 * caller hasn't joined yet, trimmed to what the home hero needs. */
export type JoinableServiceRequest = {
  id: string;
  title: string;
  status: string;
  participantCount: number;
  threshold: number | null;
};

/**
 * `GET /me/home`. Money is a DECIMAL rupee STRING in MAJOR units (e.g.
 * "12450.00") — convert with a helper at the hook boundary, never display
 * it raw. `upcomingEvents` is always `[]` until Phase 11 ships the events
 * aggregate.
 */
export type HomeAggregate = {
  amountDue: string;
  overdueCount: number;
  actionsNeeded: number;
  joinableServiceRequests: JoinableServiceRequest[];
  upcomingEvents: unknown[];
};

/** One row of `GET /me/bills`. Money fields are DECIMAL rupee STRINGS in
 * MAJOR units, same convention as HomeAggregate.amountDue. `kind` is a
 * coarser split than the client's own BillKind — mapped onto it in
 * useBills.ts (that mapping is an exhaustive switch, so widening this union
 * again will surface a compile error there rather than silently
 * mis-rendering the new kind). EVENT/HEALTH_CAMP added 2026-09-17
 * (backend commit 75cf88a). */
export type BillsPageItem = {
  id: string;
  kind: 'MAINTENANCE' | 'PROCUREMENT' | 'ELECTRICITY' | 'WATER' | 'EVENT' | 'HEALTH_CAMP';
  title: string;
  label: string;
  amountDue: string;
  amountPaid: string;
  status: string;
  dueDate: string | null;
  basis: string;
  evidenceType: string;
  evidenceId: string;
};

/** `GET /me/bills?cursor=&limit=&kind=` — cursor-paginated + ETag. A single
 * first page is enough for the app today; `nextCursor` is there for the
 * infinite-scroll follow-up. */
export type BillsPage = {
  items: BillsPageItem[];
  nextCursor: string | null;
};

// ------------ Payments (Phase 4B — shipped) ------------

export type CreateOrderBody = {
  amount: number;   // MAJOR units (rupees) — backend converts to paise at Razorpay boundary
  purpose?: string;
};

export type CreateOrderResult = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

export type PaymentStatus =
  | 'CREATED'
  | 'AUTHORISED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED';

export type Payment = {
  id: string;
  societyId: string;
  residentId: string;
  orderId: string;
  amount: string | number;
  currency: string;
  status: PaymentStatus;
  purpose: string | null;
  createdAt: string;
  updatedAt: string;
};

// ------------ Identity + auth (Phase 6.2 — shipped) ------------

/** Matches backend/prisma/schema.prisma:enum OccupancyRole. */
export type OccupancyRole = 'OWNER_OCCUPIER' | 'OWNER_ABSENTEE' | 'TENANT';

export type RequestOtpBody = { phone: string } | { email: string };

export type VerifyOtpBody =
  | { phone: string; code: string }
  | { email: string; code: string };

export type VerifyOtpResult = {
  id: string;
  name: string;
  email: string;
};

export type SignupBody = {
  name: string;
  email: string;
  phone?: string;
  societyId: string;
  flatId: string;
  role: OccupancyRole;
};

/** Response from GET /me (resident-only). */
export type MeResponse = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kycTier: string;
  societyId: string;
  occupancyRole: string;
  roleKinds: string[];
};

/** Matches backend/prisma/schema.prisma:enum RoleKind. */
export type RoleKind = 'COMMITTEE' | 'TREASURER' | 'DEPUTY_TREASURER';

// ------------ Approvals inbox (M14 governance ladder, FRONTEND_PLAN §3.2) ------------

/**
 * Kinds of pending items in a committee's approvals inbox. Each maps to a
 * concrete backend action endpoint (see useAuthorise*):
 *
 *   PAYOUT        - POST /bookings/:id/payout/authorise         (TREASURER)
 *   MILESTONE     - POST /bookings/:id/milestones/:mid/authorise (TREASURER)
 *   RETENTION     - POST /bookings/:id/retention/release        (TREASURER)
 *   RATIFICATION  - flat-claim ratification (committee), backend not shipped
 *   CORPUS        - cross-pocket / FD placement, backend not shipped
 */
export type ApprovalKind =
  | 'PAYOUT'
  | 'MILESTONE'
  | 'RETENTION'
  | 'RATIFICATION'
  | 'CORPUS';

export type ApprovalItem = {
  id: string;
  kind: ApprovalKind;
  title: string;
  /** One-line rationale — like BillLine.basis. */
  basis: string;
  counterparty: string;
  amountMinor: number | null;
  currency: string;
  createdAt: string;
  dueOn: string | null;
  /** How many distinct role-holder approvals the ladder requires. */
  requiredApprovers: number;
  /** How many have signed off already. */
  collectedApprovers: number;
  /** True if the calling user has already approved this item. */
  currentUserApproved: boolean;
  /** Which RoleKind can act on this — used to render "for treasurers" etc. */
  requiresRole: RoleKind;
  /**
   * Where the item lives. The mobile client turns this into a call to the
   * right backend POST route (see useAuthoriseX in mobile/src/hooks).
   */
  actionRef:
    | { kind: 'PAYOUT'; bookingId: string }
    | { kind: 'MILESTONE'; bookingId: string; milestoneId: string }
    | { kind: 'RETENTION'; bookingId: string }
    | { kind: 'RATIFICATION'; claimId: string }
    | { kind: 'CORPUS'; movementId: string };
};

export type ApprovalsResponse = {
  asOf: string;
  items: ApprovalItem[];
};

// ---- Shipped booking actions ----

/**
 * All three shipped authorise routes take no body — the caller identity comes
 * from the session, the target ids come from the URL. Placeholders exist here
 * so a future add (e.g. an optional `note` field) has a home to grow into.
 */
export type AuthorisePayoutBody = Record<string, never>;
export type AuthoriseMilestoneBody = Record<string, never>;
export type ReleaseRetentionBody = Record<string, never>;

/** BookingStatus subset the client actually reads. */
export type BookingStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

/** PayoutStatus subset the client actually reads. */
export type PayoutStatus = 'PENDING' | 'AUTHORISED' | 'PAID';

/** MilestoneStatus subset the client actually reads. */
export type MilestoneStatus = 'PENDING' | 'AUTHORISED' | 'PAID';

// ------------ Vendor pricing cards (Phase-shipped, FRONTEND_PLAN §5.F3) ------------
// Mirrors the web portal's live-verified shapes for
// GET /pricing-cards/vendors/:vendorId/categories/:category/current
// (and .../versions/:version for a specific older version — there is no
// "list all versions" endpoint, so the client has no history list).

/** How a pricing line's rate scales. */
export type PricingBasis = 'PER_VISIT' | 'PER_HOUR' | 'PER_UNIT' | 'PERCENTAGE';

/**
 * Card status. Published cards are immutable per plan; a revision creates a
 * new version and the previous one keeps its own row so history stays
 * inspectable ("published cards are immutable; a revision creates a new
 * version and the superseded one stays readable" — FRONTEND_PLAN §5.F3).
 */
export type PricingCardStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

export type PricingLine = {
  id: string;
  cardId: string;
  /** Human label — "Kitchen tap replacement", "Rewire single point". */
  label: string;
  basis: PricingBasis;
  /** Decimal rupee string/number in MAJOR units. */
  rate: string | number;
  /** Decimal rupee string/number in MAJOR units, when a minimum applies. */
  minimum: string | number | null;
  conditions: string | null;
};

export type PricingCardDetail = {
  id: string;
  vendorId: string;
  category: string;
  version: number;
  /** Decimal percentage string/number, e.g. "18" or 18. */
  gstRatePct: string | number;
  effectiveFrom: string;
  supersededAt: string | null;
  status: PricingCardStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PricingLine[];
};

// ------------ Events (M8, FRONTEND_PLAN §5.F8) ------------

export type EventStatus = 'UPCOMING' | 'FULL' | 'CLOSED' | 'CANCELLED';

export type RefundPolicy = {
  /** Fixed at creation, immutable thereafter (FRONTEND_PLAN §5.F8). */
  label: string;
  /** e.g. "Full refund until 48h before; 50% after; none once it starts". */
  detail: string;
};

/**
 * The caller's own relationship to an event: not opted in, opted in and
 * paid, opted in awaiting payment, or on the waitlist (with position).
 */
export type EventOptIn =
  | { state: 'NONE' }
  | { state: 'OPTED_IN'; paid: boolean }
  | { state: 'WAITLISTED'; position: number };

export type EventSummary = {
  id: string;
  title: string;
  startsAt: string;
  perFlatMinor: number;
  currency: string;
  status: EventStatus;
  optedInCount: number;
  capacity: number | null;
};

export type EventDetail = EventSummary & {
  description: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string;
  refundPolicy: RefundPolicy | null;
  /** Concession lines, e.g. "Senior citizen: 50% off". Empty if none. */
  concessions: Array<{ label: string; amountOffMinor: number }>;
  waitlistCount: number;
  myOptIn: EventOptIn;
};

// ------------ Charge sheets (M8 settlement, FRONTEND_PLAN §5.F8) ------------

export type ChargeSheetStatus =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'DISPUTED'
  | 'SETTLED';

/**
 * One line on a vendor's post-work charge sheet. `withinCard` is false when
 * the line has no matching line on the frozen card — the mobile UI flags
 * every out-of-card line so the resident sees exactly what's new
 * (FRONTEND_PLAN §5.F8: "every out-of-card line flagged").
 */
export type ChargeSheetLine = {
  id: string;
  label: string;
  amountMinor: number;
  withinCard: boolean;
  /** The frozen-card line this maps to, when withinCard is true. */
  cardLineLabel: string | null;
  note: string | null;
};

export type FrozenCardLine = {
  label: string;
  amountMinor: number;
};

export type ChargeSheet = {
  id: string;
  bookingId: string;
  vendorName: string;
  status: ChargeSheetStatus;
  submittedAt: string;
  currency: string;
  lines: ChargeSheetLine[];
  totalMinor: number;
  /** The card the vendor was engaged under, frozen at confirmation. */
  frozenCard: {
    cardId: string;
    category: string;
    version: number;
    lines: FrozenCardLine[];
    totalMinor: number;
  };
  /** Present once the resident has acted. */
  disputeReason: string | null;
};

export type DisputeChargeSheetBody = {
  reason: string;
};

// ------------ Utility billing trace (M5 / M6, FRONTEND_PLAN §5.F7) ------------

export type Utility = 'ELECTRICITY' | 'WATER';

export type ReadingUnit = 'kWh' | 'kL';

/** One tier in a piecewise tariff. `toUnits: null` means "and above". */
export type SlabRow = {
  fromUnits: number;
  toUnits: number | null;
  /** Rate per unit in MINOR units (paise per kWh, paise per kL). */
  ratePerUnitMinor: number;
  consumedInThisSlab: number;
  chargeMinor: number;
};

export type MeterReading = {
  meterId: string;
  prevReading: number;
  currentReading: number;
  consumedUnits: number;
  unit: ReadingUnit;
  readingDate: string;
  /** Anomaly flags surfaced by the backend's ingest step (SDD §4.4). */
  flags: string[];
};

/**
 * Water only. The three-source cost pool blended into a single per-kL rate
 * (FRONTEND_PLAN §5.F7). Sum of `sources[].costMinor` divided by sum of
 * `sources[].volumeKL` should equal `blendedRatePerKLMinor` — the client
 * displays both so the derivation is auditable, not just believed.
 */
export type WaterSourceBlend = {
  sources: Array<{
    source: 'MUNICIPAL' | 'TANKER' | 'BOREWELL';
    volumeKL: number;
    costMinor: number;
  }>;
  totalVolumeKL: number;
  totalCostMinor: number;
  blendedRatePerKLMinor: number;
};

/**
 * Common-area apportionment. `basis` is a human-readable label of the rule
 * that split the pool ("per flat", "by area factor", "by occupancy count"),
 * mirroring SDD §4.4's flexible-apportionment language.
 */
export type CommonAreaShare = {
  totalCommonMinor: number;
  basis: string;
  /** Your normalised share (0..1) — the fraction of `totalCommonMinor` you owe. */
  yourFactor: number;
  yourShareMinor: number;
};

/**
 * Reconciliation of the society's own aggregation against the bulk invoice
 * from the utility provider. FRONTEND_PLAN §5.F7 is explicit that variance
 * is *published*, not absorbed — this block exists to make that legible.
 */
export type UtilityReconciliation = {
  societyTotalMinor: number;
  bulkInvoiceMinor: number;
  varianceMinor: number;
  variancePct: number;
};

export type UtilityBillTrace = {
  billId: string;
  utility: Utility;
  flatId: string;
  cycleId: string;
  periodStart: string;
  periodEnd: string;
  publishedAt: string;

  reading: MeterReading;
  slabs: SlabRow[];
  slabTotalMinor: number;

  commonArea: CommonAreaShare;
  waterBlend?: WaterSourceBlend;
  reconciliation?: UtilityReconciliation;

  totalMinor: number;
  currency: string;
};
