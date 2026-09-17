/**
 * Response shapes for the endpoints the web app currently consumes. These
 * mirror the NestJS DTOs and Prisma models by hand until
 * shared/openapi.json is generated and packages/api-client ships a typed
 * client (FRONTEND_PLAN §4). When that lands, replace these with the
 * generated types.
 */

export type PrincipalKind = 'RESIDENT' | 'VENDOR' | 'OPERATOR';

/** Principal-agnostic identity echo from GET /auth/session. */
export interface SessionResponse {
  principalKind: PrincipalKind;
  id: string;
  name: string;
  email: string;
  societyId?: string;
  occupancyRole?: string;
  roleKinds?: string[];
  vendorId?: string;
  societyIds?: string[];
}

export interface OfficerIdentity {
  id: string;
  name: string;
  email: string;
  principalKind: PrincipalKind;
}

export interface ResidentIdentity {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kycTier: string;
  societyId: string;
  occupancyRole: string;
  roleKinds: string[];
}

export type SocietyStatus = 'ACTIVE' | 'ARCHIVED' | 'ONBOARDING';

export interface Society {
  id: string;
  name: string;
  address: string;
  status: SocietyStatus;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlatImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  areaFactorSum?: number;
}

/** Ledger sub-ledger balance. `balance` is a rupee decimal string (major units). */
export interface AccountBalance {
  kind: string;
  balance: string;
}

export interface LedgerResponse {
  balances: AccountBalance[];
  balancesIntact: boolean;
}

/** One-call KPI aggregate for the committee/treasurer dashboard. */
export interface SocietyDashboardKpis {
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
  accountBalances: AccountBalance[];
}

/** One-call KPI aggregate for the platform operator dashboard. */
export interface OperatorDashboardKpis {
  societies: { active: number; total: number };
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
}

export interface Occupancy {
  id: string;
  userId: string;
  flatId: string;
  occupancyRole: string;
  status: string;
  createdAt: string;
}

export type VerificationTier = 'UNVERIFIED' | 'SOCIETY_ATTESTED' | 'PLATFORM_AUDITED';

/** Mirrors Prisma Vendor + its category list. Decimal fields serialize as strings. */
export interface VendorDetail {
  id: string;
  name: string;
  categories: string[];
  verificationTier: VerificationTier;
  contactEmail: string | null;
  contactPhone: string | null;
  radiusKm: string | number | null;
  gstin: string | null;
  gstinVerifiedAt: string | null;
  ratingAvg: string | number;
  ratingCount: number;
  createdAt: string;
}

export interface CreateVendorInput {
  name: string;
  categories: string[];
  contactEmail?: string;
  contactPhone?: string;
  radiusKm?: number;
  gstin?: string;
}

/** approve() returns the vendor plus a human note explaining the GSTIN outcome. */
export type ApproveVendorResult = VendorDetail & { note: string };

/* --------------------------------------------------- pooling (M7) --- */

export type OfferStatus = 'OPEN' | 'FIRED' | 'EXPIRED' | 'CANCELLED';
export type PollStatus = 'OPEN' | 'FIRED' | 'EXPIRED' | 'CLOSED' | 'CANCELLED';
export type JobCardTier = 'SMALL' | 'LARGE';
export type OfferRecurrence = 'NONE' | 'WEEKLY';

export interface DiscountRung {
  minN: number;
  pct: number;
}

/** Committee offer (Flow A) plus live pooling counters. Decimals serialize as strings. */
export interface OfferDetail {
  id: string;
  societyId: string;
  vendorId: string;
  category: string;
  title: string;
  description: string | null;
  unitPrice: string | number;
  discountLadder: DiscountRung[];
  minCommitments: number;
  deadline: string;
  status: OfferStatus;
  appliedDiscountPct: string | number | null;
  firedAt: string | null;
  tier: JobCardTier;
  recurring: OfferRecurrence;
  createdAt: string;
  commitmentCount: number;
  currentTierPct: number | null;
  nextTierAt: number | null;
}

/** Resident-initiated poll (Flow B) plus live counters and vendor-confirmation state. */
export interface ResidentPollDetail {
  id: string;
  societyId: string;
  creatorId: string;
  title: string;
  description: string | null;
  category: string | null;
  minCommitments: number | null;
  closesAt: string;
  status: PollStatus;
  firedAt: string | null;
  taggedVendorId: string | null;
  vendorConfirmedAt: string | null;
  vendorDeclinedAt: string | null;
  vendorConfirmedMinimum: number | null;
  vendorUnitPrice: string | number | null;
  vendorDiscountLadder: DiscountRung[] | null;
  createdAt: string;
  commitmentCount: number;
  bookingId: string | null;
}

export interface CreateOfferInput {
  vendorId: string;
  category: string;
  title: string;
  description?: string;
  unitPrice: number;
  discountLadder: DiscountRung[];
  deadline: string;
  recurring?: OfferRecurrence;
}

export interface VendorConfirmInput {
  confirmedMinimum: number;
  unitPrice: number;
  discountLadder?: DiscountRung[];
}

/* ------------------------------------------ collections (M11/M12) --- */

/** An unmatched inbound credit awaiting treasurer allocation. Shape is provisional until the PSP settlement feed lands. */
export interface UnmatchedCredit {
  id?: string;
  amount?: string | number;
  reference?: string;
  receivedAt?: string;
  [k: string]: unknown;
}

export interface ReconciliationReport {
  date: string;
  ledgerEntryCount: number;
  /** Day's net change across the EXTERNAL (PSP/bank) boundary, as a decimal string. */
  ledgerNetExternal: string;
  settlementRows: unknown[];
  matched: unknown[];
  unmatched: UnmatchedCredit[];
  note: string;
}

/* -------------------------------------------- governance (M14) --- */

export type RoleKind = 'COMMITTEE' | 'TREASURER' | 'DEPUTY_TREASURER';

export interface SocietyRole {
  id: string;
  societyId: string;
  userId: string;
  kind: RoleKind;
  createdAt: string;
}

/** Per-society approval-ladder thresholds (amounts in rupees). */
export interface ApprovalConfig {
  lowerThreshold: number;
  upperThreshold: number;
  majorityFraction: number;
}

/** Result of re-verifying the hash-chained audit log. */
export interface AuditVerifyResult {
  ok: boolean;
  verifiedThrough: number;
  /** Hex-encoded recomputed chain tail. */
  tailHash: string;
  firstDivergence: { id: string; sequence: number } | null;
}

/* ----------------------------------------- vendor self-service (Phase 7) --- */

/** VENDOR identity echo. Post-7.1 a vendor may serve many societies. */
export interface VendorSelf {
  vendorId: string;
  societyIds: string[];
}

/**
 * The vendor's OWN full profile (GET /vendors/me/profile). This is the only
 * projection that returns the settlement-account trio; the resident-facing
 * VendorDetail deliberately omits it. Decimal fields serialize as strings.
 */
export interface VendorProfileDetail {
  id: string;
  name: string;
  categories: string[];
  verificationTier: VerificationTier;
  contactEmail: string | null;
  contactPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: string | number | null;
  gstin: string | null;
  gstinVerifiedAt: string | null;
  tradeLicenceNumber: string | null;
  tradeLicenceVerifiedAt: string | null;
  settlementAccountName: string | null;
  settlementAccountNumber: string | null;
  settlementIfsc: string | null;
  ratingAvg: string | number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

/** PATCH /vendors/me/profile — only the fields sent are changed. */
export interface UpdateVendorProfileInput {
  contactEmail?: string;
  contactPhone?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  tradeLicenceNumber?: string;
  settlementAccountName?: string;
  settlementAccountNumber?: string;
  settlementIfsc?: string;
}

export type PricingBasis = 'PER_VISIT' | 'PER_HOUR' | 'PER_UNIT' | 'PERCENTAGE';
export type PricingCardStatus = 'DRAFT' | 'PUBLISHED';

/** One priced line on a card. Decimal fields serialize as strings. */
export interface PricingLine {
  id: string;
  cardId: string;
  label: string;
  basis: PricingBasis;
  rate: string | number;
  minimum: string | number | null;
  conditions: string | null;
}

/**
 * A vendor's versioned price sheet for one category. Immutable once
 * PUBLISHED; a revision creates the next version and stamps supersededAt on
 * the previous current one.
 */
export interface PricingCardDetail {
  id: string;
  vendorId: string;
  category: string;
  version: number;
  gstRatePct: string | number;
  effectiveFrom: string;
  supersededAt: string | null;
  status: PricingCardStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PricingLine[];
}

export interface CreatePricingCardInput {
  category: string;
  gstRatePct: number;
  /** ISO date-time. */
  effectiveFrom: string;
}

export interface CreatePricingLineInput {
  label: string;
  basis: PricingBasis;
  rate: number;
  minimum?: number;
  conditions?: string;
}

export interface UpdatePricingLineInput {
  label?: string;
  basis?: PricingBasis;
  rate?: number;
  minimum?: number | null;
  conditions?: string | null;
}

export interface RevisePricingCardInput {
  gstRatePct: number;
  effectiveFrom: string;
}

/* ------------------------------------------- ledger cashflow (Phase 9) --- */

export type CashflowRange = '7d' | '30d' | '90d' | '12m';

/** One day's bucket in a GET /ledger/cashflow series. Amounts are rupee decimal strings. */
export interface CashflowBucket {
  date: string;
  income: string;
  expense: string;
  net: string;
}

export interface CashflowSeries {
  range: CashflowRange;
  from: string;
  to: string;
  series: CashflowBucket[];
}

/* ------------------------------------ bank statements (Phase 9.5) --- */

export type BankStatementLineStatus = 'UNMATCHED' | 'MATCHED' | 'ALLOCATED' | 'IGNORED';

/** The seven Phase 9.1 sub-ledger pockets a bank-statement credit may be allocated into. */
export type PocketKind = 'MAINTENANCE' | 'ELECTRICITY' | 'WATER' | 'EVENTS' | 'WELFARE' | 'SINKING' | 'CORPUS';

export interface BankStatementLineDetail {
  id: string;
  societyId: string;
  valueDate: string;
  amount: string;
  narration: string;
  reference: string | null;
  matchedFlatId: string | null;
  status: BankStatementLineStatus;
  allocatedById: string | null;
  allocatedAt: string | null;
  createdAt: string;
}

export interface BankStatementLinesPage {
  items: BankStatementLineDetail[];
  nextCursor: string | null;
}

export interface BankStatementIngestResult {
  ingested: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

export interface AllocateBankStatementLineInput {
  flatId?: string;
  pocketKind: PocketKind;
}

/* ------------------------------------- pocket transfers (Phase 9.6) --- */

export type PocketTransferStatus = 'PENDING' | 'EXECUTED' | 'CANCELLED';

/** The transfer row plus a live authorisation readout. */
export interface PocketTransferDetail {
  id: string;
  societyId: string;
  fromKind: PocketKind;
  toKind: PocketKind;
  amount: string;
  reasonCode: string;
  note: string | null;
  status: PocketTransferStatus;
  requestedById: string;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Count of DISTINCT officers who have authorised this transfer so far. */
  authorisedCount: number;
  /** The number of DISTINCT officers required, evaluated as of this read. */
  requiredApprovers: number;
}

export interface PocketTransferPage {
  items: PocketTransferDetail[];
  nextCursor: string | null;
}

export interface RequestTransferInput {
  fromKind: PocketKind;
  toKind: PocketKind;
  amount: number;
  reasonCode: string;
  note?: string;
}
