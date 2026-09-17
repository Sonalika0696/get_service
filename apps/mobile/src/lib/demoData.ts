import type {
  HomeAggregate,
  BillsPage,
  ResidentPollDetail,
  EventSummary,
  EventDetail,
  JobBlogPost,
  VendorDetail,
  ApprovalsResponse,
} from '@sft/api-client';

/**
 * Curated sample data shown in place of a live response when the
 * resident-facing hooks (useHome, useBillsHub, useResidentPolls, useEvents,
 * useJobPosts, useVendors, useApprovals — see sampleFallback.ts) settle with
 * nothing usable, whether that's a real error (the shared dev backend is
 * still being built out, so some routes aren't shipped yet) or a genuinely
 * empty payload. Shaped exactly like the real backend DTOs so it flows
 * through the same mapping code a real response does.
 *
 * This is meant to read like an actual resident's dashboard mid-way through
 * a real month — a mix of overdue and upcoming, a pool that already fired
 * and one that lapsed, vendors at different verification tiers, an event
 * that's full and one that's already happened — not a single flat "here's
 * one of everything" filler set. Every cross-reference (a bill's evidence
 * pointing at a poll, a poll's tagged vendor, a home stat matching the
 * detail lists) is kept internally consistent, the same way real data
 * would be.
 *
 * Kept in an Indian-society register, sentence case, no emoji.
 */

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const DEMO_SOCIETY_ID = 'demo-society';

/**
 * Vendors, spanning all three verification tiers so the directory and
 * request-detail screens show real variety rather than one uniform badge:
 *  - demo-vendor-1 (Plumbing/Cleaning): committee-attested, established.
 *  - demo-vendor-2 (Pest control): committee-attested.
 *  - demo-vendor-3 (Electrical): platform-audited — the top tier, tagged
 *    on the pool that actually fired.
 *  - demo-vendor-4 (Painting): newly onboarded, unverified and unrated yet
 *    — the pool tagging it lapsed without reaching its threshold.
 */
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
    gstin: '27AAFCA1234B1Z5',
    gstinVerifiedAt: daysFromNow(-95),
    verificationTier: 'SOCIETY_ATTESTED',
    ratingAvg: '4.6',
    ratingCount: 38,
    createdAt: daysFromNow(-120),
    updatedAt: daysFromNow(-6),
    categories: ['Plumbing', 'Cleaning'],
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
    gstin: '27AAGCP5678C1Z2',
    gstinVerifiedAt: daysFromNow(-80),
    verificationTier: 'SOCIETY_ATTESTED',
    ratingAvg: '4.4',
    ratingCount: 21,
    createdAt: daysFromNow(-90),
    updatedAt: daysFromNow(-3),
    categories: ['Pest control'],
  },
  {
    id: 'demo-vendor-3',
    societyId: DEMO_SOCIETY_ID,
    name: 'Sunrise Electricals & Decor',
    contactEmail: 'contact@sunriseelectricals.example.in',
    contactPhone: '+91 97600 22334',
    latitude: null,
    longitude: null,
    radiusKm: 10,
    gstin: '27AASCS9012D1Z8',
    gstinVerifiedAt: daysFromNow(-200),
    verificationTier: 'PLATFORM_AUDITED',
    ratingAvg: '4.8',
    ratingCount: 64,
    createdAt: daysFromNow(-260),
    updatedAt: daysFromNow(-5),
    categories: ['Electrical'],
  },
  {
    id: 'demo-vendor-4',
    societyId: DEMO_SOCIETY_ID,
    name: 'Shree Ganesh Painters',
    contactEmail: null,
    contactPhone: '+91 89990 44556',
    latitude: null,
    longitude: null,
    radiusKm: 6,
    gstin: null,
    gstinVerifiedAt: null,
    verificationTier: 'UNVERIFIED',
    ratingAvg: '0',
    ratingCount: 0,
    createdAt: daysFromNow(-9),
    updatedAt: daysFromNow(-9),
    categories: ['Painting'],
  },
];

/**
 * Resident-raised pools across every stage of the Flow B lifecycle:
 *  - demo-request-1, demo-request-5: OPEN, still gathering neighbours.
 *  - demo-request-2: OPEN, close to its threshold (27 of 30).
 *  - demo-request-3: FIRED — vendor confirmed, threshold cleared, booked.
 *    Its bookingId ties to the two demo-bill lines below (materials +
 *    installation), so the bill's evidence and the pool's own detail agree.
 *  - demo-request-4: EXPIRED — closed without reaching its threshold,
 *    tagged to the unverified painter, so a lapsed pool looks like a real
 *    lapsed pool rather than being omitted from the sample set entirely.
 */
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
  {
    id: 'demo-request-3',
    societyId: DEMO_SOCIETY_ID,
    creatorId: 'demo-resident-3',
    pollType: 'BULK_BUY_RESIDENT',
    title: 'Diwali lighting, common areas',
    description: 'Festive lighting and decor for the main gate and clubhouse lawn.',
    category: 'Electrical',
    minCommitments: 12,
    closesAt: daysFromNow(-7),
    status: 'FIRED',
    firedAt: daysFromNow(-5),
    closedAt: null,
    taggedVendorId: 'demo-vendor-3',
    vendorConfirmedAt: daysFromNow(-6),
    vendorDeclinedAt: null,
    vendorConfirmedMinimum: 12,
    vendorUnitPrice: '265.00',
    vendorDiscountLadder: null,
    createdAt: daysFromNow(-16),
    updatedAt: daysFromNow(-5),
    commitmentCount: 16,
    hasJoined: false,
    bookingId: 'demo-booking-1',
  },
  {
    id: 'demo-request-4',
    societyId: DEMO_SOCIETY_ID,
    creatorId: 'demo-resident-4',
    pollType: 'BULK_BUY_RESIDENT',
    title: 'Common corridor repainting, block B',
    description: 'Touch-up repainting for the block B corridors and staircase.',
    category: 'Painting',
    minCommitments: 15,
    closesAt: daysFromNow(-4),
    status: 'EXPIRED',
    firedAt: null,
    closedAt: daysFromNow(-4),
    taggedVendorId: 'demo-vendor-4',
    vendorConfirmedAt: null,
    vendorDeclinedAt: null,
    vendorConfirmedMinimum: null,
    vendorUnitPrice: null,
    vendorDiscountLadder: null,
    createdAt: daysFromNow(-19),
    updatedAt: daysFromNow(-4),
    commitmentCount: 6,
    hasJoined: false,
    bookingId: null,
  },
  {
    id: 'demo-request-5',
    societyId: DEMO_SOCIETY_ID,
    creatorId: 'demo-resident-5',
    pollType: 'BULK_BUY_RESIDENT',
    title: 'Borewell servicing, block C',
    description: 'Annual borewell motor and pipeline servicing for block C.',
    category: 'Plumbing',
    minCommitments: 10,
    closesAt: daysFromNow(8),
    status: 'OPEN',
    firedAt: null,
    closedAt: null,
    taggedVendorId: 'demo-vendor-1',
    vendorConfirmedAt: null,
    vendorDeclinedAt: null,
    vendorConfirmedMinimum: null,
    vendorUnitPrice: '300.00',
    vendorDiscountLadder: null,
    createdAt: daysFromNow(-4),
    updatedAt: daysFromNow(-1),
    commitmentCount: 5,
    hasJoined: false,
    bookingId: null,
  },
];

/**
 * Bills: three unpaid lines (8200 + 3000 + 1250 = 12450.00) sum to exactly
 * `demoHomeAggregate.amountDue`, so Home and the Bills hub always agree even
 * in sample mode. The two Diwali lines (materials + installation) are both
 * evidenced against demo-request-3, the pool that actually fired above —
 * a fired pool showing up as a real charge, not just a status change. Two
 * paid maintenance lines keep the "All" segment and statement view from
 * looking like a brand-new account with no track record. The EVENT and
 * HEALTH_CAMP lines (both already paid, so neither touches the due total)
 * round out every kind the backend now returns — the paid event line even
 * ties back to demo-event-1, so a resident's own opt-in shows up as a real
 * charge in their statement, not just a status on the event card.
 */
export const demoBillsPage: BillsPage = {
  items: [
    {
      id: 'demo-bill-1',
      kind: 'MAINTENANCE',
      title: 'Monthly maintenance, September',
      label: 'Maintenance',
      amountDue: '8200.00',
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
      title: 'Diwali lighting, pooled purchase (materials)',
      label: 'Group buy',
      amountDue: '3000.00',
      amountPaid: '0.00',
      status: 'DUE',
      dueDate: daysFromNow(10),
      basis: 'Your share of a pooled decor order with 15 neighbours',
      evidenceType: 'POLL',
      evidenceId: 'demo-request-3',
    },
    {
      id: 'demo-bill-3',
      kind: 'PROCUREMENT',
      title: 'Diwali lighting, pooled purchase (installation)',
      label: 'Group buy',
      amountDue: '1250.00',
      amountPaid: '0.00',
      status: 'DUE',
      dueDate: daysFromNow(6),
      basis: 'Your share of the installation charge on the same booking',
      evidenceType: 'BOOKING',
      evidenceId: 'demo-booking-1',
    },
    {
      id: 'demo-bill-4',
      kind: 'MAINTENANCE',
      title: 'Monthly maintenance, August',
      label: 'Maintenance',
      amountDue: '8200.00',
      amountPaid: '8200.00',
      status: 'PAID',
      dueDate: daysFromNow(-35),
      basis: 'Flat area 1050 sq ft x society maintenance rate',
      evidenceType: 'JOURNAL',
      evidenceId: 'demo-journal-0',
    },
    {
      id: 'demo-bill-5',
      kind: 'MAINTENANCE',
      title: 'Monthly maintenance, July',
      label: 'Maintenance',
      amountDue: '8200.00',
      amountPaid: '8200.00',
      status: 'PAID',
      dueDate: daysFromNow(-65),
      basis: 'Flat area 1050 sq ft x society maintenance rate',
      evidenceType: 'JOURNAL',
      evidenceId: 'demo-journal--1',
    },
    {
      id: 'demo-bill-6',
      kind: 'EVENT',
      title: 'Event – Diwali get-together, clubhouse lawn',
      label: 'Diwali get-together, clubhouse lawn',
      amountDue: '500.00',
      amountPaid: '500.00',
      status: 'PAID',
      dueDate: daysFromNow(18),
      basis: 'Per-flat opt-in charge for the clubhouse Diwali event',
      evidenceType: 'EventRegistration',
      evidenceId: 'demo-event-reg-1',
    },
    {
      id: 'demo-bill-7',
      kind: 'HEALTH_CAMP',
      title: 'Health camp – Free eye check-up camp',
      label: 'Self',
      amountDue: '200.00',
      amountPaid: '200.00',
      status: 'PAID',
      dueDate: daysFromNow(-12),
      basis: 'Consultation fee for the society-organised eye check-up camp',
      evidenceType: 'CampRegistration',
      evidenceId: 'demo-camp-reg-1',
    },
  ],
  nextCursor: null,
};

export const demoHomeAggregate: HomeAggregate = {
  amountDue: '12450.00',
  overdueCount: 1,
  actionsNeeded: 2,
  joinableServiceRequests: [
    { id: 'demo-request-1', title: 'Kitchen tap leak, block A', status: 'OPEN', participantCount: 2, threshold: 4 },
    { id: 'demo-request-2', title: 'Quarterly pest control, common areas', status: 'OPEN', participantCount: 27, threshold: 30 },
    { id: 'demo-request-5', title: 'Borewell servicing, block C', status: 'OPEN', participantCount: 5, threshold: 10 },
  ],
  // Loosely typed on the real DTO (Phase 11 hasn't shipped this yet); a
  // couple of preview entries here just give the "Upcoming events" stat
  // tile something real to count in sample mode.
  upcomingEvents: [
    { id: 'demo-event-2', title: 'Republic Day flag hoisting & breakfast', startsAt: daysFromNow(6) },
    { id: 'demo-event-3', title: 'Society annual sports day', startsAt: daysFromNow(2) },
  ],
};

/**
 * Events across every status the UI needs to render distinctly:
 *  - demo-event-1: comfortably UPCOMING, plenty of capacity left.
 *  - demo-event-2: UPCOMING but nearly full — a few flats already waitlisted.
 *  - demo-event-3: FULL — the viewer themselves is waitlisted (see
 *    demoEventDetails below), so the waitlist-position UI has something
 *    real to show.
 *  - demo-event-4: CLOSED — already happened, the viewer opted in and paid,
 *    so a resident's event history isn't empty either.
 */
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
  {
    id: 'demo-event-2',
    title: 'Republic Day flag hoisting & breakfast',
    startsAt: daysFromNow(6),
    perFlatMinor: 15000,
    currency: 'INR',
    status: 'UPCOMING',
    optedInCount: 58,
    capacity: 60,
  },
  {
    id: 'demo-event-3',
    title: 'Society annual sports day',
    startsAt: daysFromNow(2),
    perFlatMinor: 20000,
    currency: 'INR',
    status: 'FULL',
    optedInCount: 120,
    capacity: 120,
  },
  {
    id: 'demo-event-4',
    title: 'Independence Day celebration',
    startsAt: daysFromNow(-30),
    perFlatMinor: 10000,
    currency: 'INR',
    status: 'CLOSED',
    optedInCount: 95,
    capacity: 100,
  },
];

/** Full detail per sample event, keyed by id — backs `useEvent(id)`'s sample
 * fallback so opening an event from the sample list works instead of
 * erroring, the same way sample vendors/polls already do. */
export const demoEventDetails: Record<string, EventDetail> = {
  'demo-event-1': {
    ...demoEvents[0],
    description: 'An evening of lights, music and snacks on the clubhouse lawn — all flats welcome.',
    registrationOpensAt: daysFromNow(-10),
    registrationClosesAt: daysFromNow(16),
    refundPolicy: {
      label: 'Full refund until 48h before',
      detail: 'Full refund until 48 hours before the event; 50% after; none once it starts.',
    },
    concessions: [{ label: 'Senior citizen (60+)', amountOffMinor: 25000 }],
    waitlistCount: 0,
    myOptIn: { state: 'NONE' },
  },
  'demo-event-2': {
    ...demoEvents[1],
    description: 'Flag hoisting at 8am followed by a community breakfast in the clubhouse.',
    registrationOpensAt: daysFromNow(-14),
    registrationClosesAt: daysFromNow(4),
    refundPolicy: {
      label: 'Full refund until 48h before',
      detail: 'Full refund until 48 hours before the event; 50% after; none once it starts.',
    },
    concessions: [{ label: 'Kids under 12', amountOffMinor: 15000 }],
    waitlistCount: 3,
    myOptIn: { state: 'NONE' },
  },
  'demo-event-3': {
    ...demoEvents[2],
    description: 'A full day of track and field events for residents of all ages, followed by prize distribution.',
    registrationOpensAt: daysFromNow(-20),
    registrationClosesAt: daysFromNow(-1),
    refundPolicy: {
      label: 'No refunds',
      detail: 'Registration fee is non-refundable once the event reaches capacity.',
    },
    concessions: [],
    waitlistCount: 9,
    myOptIn: { state: 'WAITLISTED', position: 4 },
  },
  'demo-event-4': {
    ...demoEvents[3],
    description: 'Flag hoisting, cultural performances and a community lunch.',
    registrationOpensAt: daysFromNow(-45),
    registrationClosesAt: daysFromNow(-31),
    refundPolicy: {
      label: 'Full refund until 48h before',
      detail: 'Full refund until 48 hours before the event; 50% after; none once it starts.',
    },
    concessions: [],
    waitlistCount: 0,
    myOptIn: { state: 'OPTED_IN', paid: true },
  },
};

/** Pre-filtered to `kind: 'HIRING'`, matching what useJobPosts returns from
 * the real endpoint (it filters out SEEKING posts client-side). Three
 * posts at different points in their lifecycle — one long-lived, one about
 * to expire, one from an agency with a verified company email — so the
 * feed doesn't read as a single lonely listing. */
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
  {
    id: 'demo-job-2',
    societyId: DEMO_SOCIETY_ID,
    posterId: 'demo-resident-5',
    kind: 'HIRING',
    title: 'Need a reliable driver for school pickup and drop',
    body: 'Flat A-708 needs a part-time driver for school pickup/drop, Mon-Sat, 7:30-9am and 2-3:30pm. Own two-wheeler a plus.',
    status: 'ACTIVE',
    expiresAt: daysFromNow(3),
    companyEmail: null,
    companyEmailVerifiedAt: null,
    createdAt: daysFromNow(-12),
    updatedAt: daysFromNow(-12),
  },
  {
    id: 'demo-job-3',
    societyId: DEMO_SOCIETY_ID,
    posterId: 'demo-resident-2',
    kind: 'HIRING',
    title: 'Hiring a full-time house help, live-out',
    body: 'Flat C-115 is hiring a full-time live-out house help for cooking and cleaning, 8am-4pm, six days a week.',
    status: 'ACTIVE',
    expiresAt: daysFromNow(45),
    companyEmail: 'hr@example-domestic-agency.in',
    companyEmailVerifiedAt: daysFromNow(-1),
    createdAt: daysFromNow(-6),
    updatedAt: daysFromNow(-1),
  },
];

/**
 * Two committee approval items, both of the kinds `useAuthoriseApproval`
 * already treats as unshipped backend routes (RATIFICATION, CORPUS) — so
 * tapping either in sample mode surfaces the same honest "will be
 * actionable once the backend ships" message a real one would, without
 * needing a separate sample-vs-real guard on the mutation itself. Only
 * ever seen by a committee/treasurer-role resident (the screen itself is
 * role-gated — see useIsCommittee).
 */
export const demoApprovals: ApprovalsResponse = {
  asOf: new Date().toISOString(),
  items: [
    {
      id: 'demo-approval-1',
      kind: 'RATIFICATION',
      title: 'New tenant move-in: flat C-204',
      basis: 'Occupancy claim awaiting committee ratification against the imported flat register.',
      counterparty: 'Rohan Deshpande (C-204)',
      amountMinor: null,
      currency: 'INR',
      createdAt: daysFromNow(-2),
      dueOn: null,
      requiredApprovers: 1,
      collectedApprovers: 0,
      currentUserApproved: false,
      requiresRole: 'COMMITTEE',
      actionRef: { kind: 'RATIFICATION', claimId: 'demo-claim-1' },
    },
    {
      id: 'demo-approval-2',
      kind: 'CORPUS',
      title: 'Move ₹50,000 from sinking fund to corpus FD',
      basis: 'Quarterly surplus transfer per the approved investment policy.',
      counterparty: 'Society corpus account',
      amountMinor: 5000000,
      currency: 'INR',
      createdAt: daysFromNow(-1),
      dueOn: daysFromNow(5),
      requiredApprovers: 2,
      collectedApprovers: 1,
      currentUserApproved: false,
      requiresRole: 'TREASURER',
      actionRef: { kind: 'CORPUS', movementId: 'demo-movement-1' },
    },
  ],
};
