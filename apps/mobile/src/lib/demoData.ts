import type {
  HomeAggregate,
  BillsPage,
  ResidentPollDetail,
  EventSummary,
  JobBlogPost,
  VendorDetail,
} from '@sft/api-client';

/**
 * Curated sample data shown in place of a live response when the
 * resident-facing hooks (useHome, useBillsHub, useResidentPolls, useEvents,
 * useJobPosts — see sampleFallback.ts) settle with nothing usable, whether
 * that's a real error (right now the shared dev DB gets wiped often enough
 * that authed calls 401 with "session expired or invalid") or a genuinely
 * empty payload. Shaped exactly like the real backend DTOs so it flows
 * through the same mapping code a real response does.
 *
 * Kept in an Indian-society register, sentence case, no emoji — this is
 * meant to look like a plausible resident's dashboard, not a placeholder.
 */

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const DEMO_SOCIETY_ID = 'demo-society';

export const demoHomeAggregate: HomeAggregate = {
  amountDue: '12450.00',
  overdueCount: 1,
  actionsNeeded: 2,
  joinableServiceRequests: [
    {
      id: 'demo-request-1',
      title: 'Kitchen tap leak, block A',
      status: 'OPEN',
      participantCount: 2,
      threshold: 4,
    },
    {
      id: 'demo-request-2',
      title: 'Quarterly pest control, common areas',
      status: 'OPEN',
      participantCount: 27,
      threshold: 30,
    },
  ],
  upcomingEvents: [],
};

/**
 * The two unpaid lines (9450.00 + 3000.00) sum to exactly
 * `demoHomeAggregate.amountDue` ("12450.00"), so Home and Bills agree even
 * in sample mode. The third, already-paid line is there so the "All" segment
 * and payment history don't look empty.
 */
export const demoBillsPage: BillsPage = {
  items: [
    {
      id: 'demo-bill-1',
      kind: 'MAINTENANCE',
      title: 'Monthly maintenance, September',
      label: 'Maintenance',
      amountDue: '9450.00',
      amountPaid: '0.00',
      status: 'OVERDUE',
      dueDate: daysFromNow(-5),
      basis: 'Flat area 1050 sq ft x society maintenance rate',
      evidenceType: 'JOURNAL',
      evidenceId: 'demo-journal-1',
    },
    {
      id: 'demo-bill-2',
      kind: 'PROCUREMENT',
      title: 'Diwali lighting, pooled purchase',
      label: 'Group buy',
      amountDue: '3000.00',
      amountPaid: '0.00',
      status: 'DUE',
      dueDate: daysFromNow(10),
      basis: 'Your share of a pooled decor order with 14 neighbours',
      evidenceType: 'POLL',
      evidenceId: 'demo-request-1',
    },
    {
      id: 'demo-bill-3',
      kind: 'MAINTENANCE',
      title: 'Monthly maintenance, August',
      label: 'Maintenance',
      amountDue: '9450.00',
      amountPaid: '9450.00',
      status: 'PAID',
      dueDate: daysFromNow(-35),
      basis: 'Flat area 1050 sq ft x society maintenance rate',
      evidenceType: 'JOURNAL',
      evidenceId: 'demo-journal-0',
    },
  ],
  nextCursor: null,
};

export const demoResidentPolls: ResidentPollDetail[] = [
  {
    id: 'demo-request-1',
    societyId: DEMO_SOCIETY_ID,
    creatorId: 'demo-resident-1',
    pollType: 'BULK_BUY_RESIDENT',
    title: 'Kitchen tap leak, block A',
    description: 'Shared plumber visit for four flats with the same leaking-tap issue.',
    category: 'Plumbing',
    minCommitments: 4,
    closesAt: daysFromNow(6),
    status: 'OPEN',
    firedAt: null,
    closedAt: null,
    taggedVendorId: 'demo-vendor-1',
    vendorConfirmedAt: null,
    vendorDeclinedAt: null,
    vendorConfirmedMinimum: null,
    vendorUnitPrice: '450.00',
    vendorDiscountLadder: null,
    createdAt: daysFromNow(-3),
    updatedAt: daysFromNow(-1),
    commitmentCount: 2,
    hasJoined: false,
    bookingId: null,
  },
  {
    id: 'demo-request-2',
    societyId: DEMO_SOCIETY_ID,
    creatorId: 'demo-resident-2',
    pollType: 'BULK_BUY_RESIDENT',
    title: 'Quarterly pest control, common areas',
    description: 'Pooled quarterly pest treatment for the common areas and basement.',
    category: 'Pest control',
    minCommitments: 30,
    closesAt: daysFromNow(9),
    status: 'OPEN',
    firedAt: null,
    closedAt: null,
    taggedVendorId: 'demo-vendor-2',
    vendorConfirmedAt: null,
    vendorDeclinedAt: null,
    vendorConfirmedMinimum: null,
    vendorUnitPrice: '120.00',
    vendorDiscountLadder: null,
    createdAt: daysFromNow(-10),
    updatedAt: daysFromNow(-2),
    commitmentCount: 27,
    hasJoined: false,
    bookingId: null,
  },
];

export const demoEvents: EventSummary[] = [
  {
    id: 'demo-event-1',
    title: 'Diwali get-together, clubhouse lawn',
    startsAt: daysFromNow(18),
    perFlatMinor: 50000,
    currency: 'INR',
    status: 'UPCOMING',
    optedInCount: 34,
    capacity: 80,
  },
];

/** Pre-filtered to `kind: 'HIRING'`, matching what useJobPosts returns from
 * the real endpoint (it filters out SEEKING posts client-side). */
export const demoJobPosts: JobBlogPost[] = [
  {
    id: 'demo-job-1',
    societyId: DEMO_SOCIETY_ID,
    posterId: 'demo-resident-3',
    kind: 'HIRING',
    title: 'Looking for a part-time cook, weekday evenings',
    body: 'Flat B-402 is looking for an experienced part-time cook for weekday dinners. Reply with experience and availability.',
    status: 'ACTIVE',
    expiresAt: daysFromNow(20),
    companyEmail: null,
    companyEmailVerifiedAt: null,
    createdAt: daysFromNow(-2),
    updatedAt: daysFromNow(-2),
  },
];

/** Tagged by the sample polls (demo-vendor-1 = plumbing on demo-request-1,
 * demo-vendor-2 = pest control on demo-request-2), so "Open vendor profile"
 * from a sampled request resolves instead of 401ing. */
export const demoVendors: VendorDetail[] = [
  {
    id: 'demo-vendor-1',
    societyId: DEMO_SOCIETY_ID,
    name: 'AquaFix Plumbing Services',
    contactEmail: 'hello@aquafix.example.in',
    contactPhone: '+91 98200 11223',
    latitude: null,
    longitude: null,
    radiusKm: 8,
    gstin: null,
    gstinVerifiedAt: null,
    verificationTier: 'SOCIETY_ATTESTED',
    ratingAvg: '4.6',
    ratingCount: 38,
    createdAt: daysFromNow(-120),
    updatedAt: daysFromNow(-6),
    categories: ['Plumbing', 'Water tank cleaning'],
  },
  {
    id: 'demo-vendor-2',
    societyId: DEMO_SOCIETY_ID,
    name: 'GreenShield Pest Control',
    contactEmail: 'care@greenshield.example.in',
    contactPhone: '+91 90040 55667',
    latitude: null,
    longitude: null,
    radiusKm: 12,
    gstin: null,
    gstinVerifiedAt: null,
    verificationTier: 'SOCIETY_ATTESTED',
    ratingAvg: '4.4',
    ratingCount: 21,
    createdAt: daysFromNow(-90),
    updatedAt: daysFromNow(-3),
    categories: ['Pest control'],
  },
];
