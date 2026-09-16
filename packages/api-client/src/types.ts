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
