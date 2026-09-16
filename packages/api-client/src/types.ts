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
