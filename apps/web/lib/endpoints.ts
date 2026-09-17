import { api } from './api';
import type {
  AccountBalance,
  ApprovalConfig,
  ApproveVendorResult,
  AuditVerifyResult,
  CreateOfferInput,
  CreatePricingCardInput,
  CreatePricingLineInput,
  CreateVendorInput,
  FlatImportResult,
  LedgerResponse,
  Occupancy,
  OfferDetail,
  OfferStatus,
  OfficerIdentity,
  OperatorDashboardKpis,
  PricingCardDetail,
  ResidentIdentity,
  ResidentPollDetail,
  ReconciliationReport,
  RevisePricingCardInput,
  SessionResponse,
  Society,
  SocietyDashboardKpis,
  SocietyRole,
  UpdatePricingLineInput,
  UpdateVendorProfileInput,
  VendorConfirmInput,
  VendorDetail,
  VendorProfileDetail,
  VendorSelf,
} from './types';

/* ---------------------------------------------------------------- auth --- */

export const auth = {
  /** Operator + vendor: password + mandatory TOTP. */
  officerLogin: (email: string, password: string, totpCode: string) =>
    api.post<OfficerIdentity>('/auth/officer/login', { email, password, totpCode }),

  /** Committee/treasurer are residents: request an email OTP on web... */
  requestOtp: (email: string) => api.post<void>('/auth/otp', { email }),
  /** ...then exchange it for a session cookie. */
  verifyOtp: (email: string, code: string) =>
    api.post<{ id: string; name: string; email: string }>('/auth/verify', { email, code }),

  logout: () => api.post<void>('/auth/logout'),

  /** Principal-agnostic identity echo — authoritative for the signed-in user. */
  session: () => api.get<SessionResponse>('/auth/session'),

  /** DEV ONLY: issue a session for a seeded account by email (no OTP/2FA). 403 in production. */
  devLogin: (email: string) => api.post<{ id: string; name: string; email: string }>('/auth/dev/login', { email }),
};

/* ----------------------------------------------------------- dashboard --- */

export const dashboard = {
  /** Committee/treasurer KPI aggregate for one society (one call). */
  society: (sid: string) => api.get<SocietyDashboardKpis>(`/dashboard/society/${sid}`),
  /** Operator platform-wide KPI aggregate (one call). */
  operator: () => api.get<OperatorDashboardKpis>('/dashboard/operator'),
};

/* ------------------------------------------------------------ identity --- */

export const identity = {
  /** Resident identity echo (committee/treasurer). 401 if not a resident. */
  me: () => api.get<ResidentIdentity>('/me'),
  /** Vendor identity echo. Post-7.1 a vendor may be linked to many societies. */
  vendorMe: () => api.get<VendorSelf>('/vendors/me'),
};

/* -------------------------------------- vendor self-service (Phase 7) --- */

export const vendor = {
  /** The calling vendor's own full profile (includes the settlement trio). */
  profile: () => api.get<VendorProfileDetail>('/vendors/me/profile'),
  /** PATCH semantics: only the fields supplied are changed. */
  updateProfile: (input: UpdateVendorProfileInput) =>
    api.patch<VendorProfileDetail>('/vendors/me/profile', input),
  addCategory: (category: string) =>
    api.post<VendorProfileDetail>('/vendors/me/categories', { category }),
  removeCategory: (category: string) =>
    api.del<VendorProfileDetail>(`/vendors/me/categories/${encodeURIComponent(category)}`),
};

/* --------------------------------------- pricing cards (Phase 7.2) --- */

export const pricing = {
  /** Every card this vendor owns, across categories and versions. */
  mine: () => api.get<PricingCardDetail[]>('/pricing-cards/mine'),
  get: (id: string) => api.get<PricingCardDetail>(`/pricing-cards/${id}`),
  /** Create the first (version 1) DRAFT for a category. */
  create: (input: CreatePricingCardInput) => api.post<PricingCardDetail>('/pricing-cards', input),
  addLine: (id: string, input: CreatePricingLineInput) =>
    api.post<PricingCardDetail>(`/pricing-cards/${id}/lines`, input),
  updateLine: (id: string, lineId: string, input: UpdatePricingLineInput) =>
    api.patch<PricingCardDetail>(`/pricing-cards/${id}/lines/${lineId}`, input),
  deleteLine: (id: string, lineId: string) =>
    api.del<PricingCardDetail>(`/pricing-cards/${id}/lines/${lineId}`),
  /** Publish a DRAFT; supersedes the previous current version for its category. */
  publish: (id: string) => api.post<PricingCardDetail>(`/pricing-cards/${id}/publish`),
  /** Open the next-version DRAFT from a vendor's current published card. */
  revise: (id: string, input: RevisePricingCardInput) =>
    api.post<PricingCardDetail>(`/pricing-cards/${id}/revise`, input),
};

/* ----------------------------------------------------------- operator --- */

export const operator = {
  listSocieties: (status?: string) =>
    api.get<Society[]>(`/operator/societies${status ? `?status=${status}` : ''}`),
  getSociety: (sid: string) => api.get<Society>(`/operator/societies/${sid}`),
  createSociety: (input: { name: string; address: string; latitude?: number; longitude?: number }) =>
    api.post<Society>('/operator/societies', input),
  archiveSociety: (sid: string) => api.post<Society>(`/operator/societies/${sid}/archive`),
  reactivateSociety: (sid: string) => api.post<Society>(`/operator/societies/${sid}/reactivate`),
  importFlats: (sid: string, csv: string) =>
    api.post<FlatImportResult>(`/operator/societies/${sid}/flats/import`, { csv }),
};

/* ---------------------------------------------------------- committee --- */

export const committee = {
  ledger: () => api.get<LedgerResponse>('/ledger'),
  pendingRatifications: (sid: string) => api.get<Occupancy[]>(`/society/${sid}/ratifications`),
  ratify: (sid: string, id: string, note?: string) =>
    api.post<Occupancy>(`/society/${sid}/ratifications/${id}/ratify`, { note }),
  reject: (sid: string, id: string, note?: string) =>
    api.post<Occupancy>(`/society/${sid}/ratifications/${id}/reject`, { note }),
  listVendors: (category?: string, q?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    const qs = params.toString();
    return api.get<VendorDetail[]>(`/vendors${qs ? `?${qs}` : ''}`);
  },
  getVendor: (id: string) => api.get<VendorDetail>(`/vendors/${id}`),
  /** Committee onboards a vendor. GSTIN is self-declared here, checked at approval. */
  onboardVendor: (input: CreateVendorInput) => api.post<VendorDetail>('/vendors', input),
  /** Runs the GSTIN check; an Active result promotes UNVERIFIED to SOCIETY_ATTESTED. */
  approveVendor: (id: string) => api.post<ApproveVendorResult>(`/vendors/${id}/approve`),
};

/* ------------------------------------------------ pooling (M7) --- */

export const pooling = {
  /* Flow A — committee offers */
  listOffers: (status?: OfferStatus) => api.get<OfferDetail[]>(`/offers${status ? `?status=${status}` : ''}`),
  getOffer: (id: string) => api.get<OfferDetail>(`/offers/${id}`),
  createOffer: (input: CreateOfferInput) => api.post<OfferDetail>('/offers', input),
  rollOffer: (id: string) => api.post<OfferDetail>(`/offers/${id}/roll`),

  /* Flow B — resident-initiated polls (committee acts for the vendor in v1) */
  listPolls: () => api.get<ResidentPollDetail[]>('/bulk-buy/polls'),
  getPoll: (id: string) => api.get<ResidentPollDetail>(`/bulk-buy/polls/${id}`),
  vendorConfirm: (id: string, input: VendorConfirmInput) =>
    api.post<ResidentPollDetail>(`/bulk-buy/polls/${id}/vendor-confirm`, input),
  vendorDecline: (id: string) => api.post<ResidentPollDetail>(`/bulk-buy/polls/${id}/vendor-decline`),
};

/* ------------------------------------------ collections (M11/M12) --- */

export const collections = {
  /** Daily bank/PSP reconciliation. TREASURER-only; 403 for other roles. */
  reconciliation: (date?: string) =>
    api.get<ReconciliationReport>(`/ledger/reconciliation${date ? `?date=${date}` : ''}`),
};

/* -------------------------------------------- governance (M14) --- */

export const governance = {
  /** Any resident may read the ladder that governs their society. */
  getApprovalConfig: () => api.get<ApprovalConfig>('/bulk-buy/approval-config'),
  /** COMMITTEE/TREASURER only. */
  setApprovalConfig: (input: ApprovalConfig) => api.put<ApprovalConfig>('/bulk-buy/approval-config', input),
  /** COMMITTEE only: the committee roster (for the ladder roster size). */
  listRoles: (sid: string) => api.get<SocietyRole[]>(`/society/${sid}/roles`),
};

/* -------------------------------------------- treasury / audit --- */

export const treasury = {
  /** Sub-ledger balances + the cheap integrity flag (COMMITTEE). */
  ledger: () => api.get<LedgerResponse>('/ledger'),
  /** Re-verify the hash-chained audit log end to end (any resident, society-scoped). */
  verifyChain: () => api.get<AuditVerifyResult>('/audit/verify'),
};

export type { AccountBalance };
