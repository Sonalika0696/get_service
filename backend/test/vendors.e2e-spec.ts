import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, RoleKind, VerificationTier } from '../src/generated/prisma/enums.js';

/**
 * Phase 2 (vendor marketplace) Definition of Done, end-to-end against real
 * Postgres:
 *   committee onboards a vendor with a valid-looking GSTIN -> approve flips
 *   UNVERIFIED -> SOCIETY_ATTESTED and stamps gstinVerifiedAt; a vendor
 *   whose GSTIN doesn't check out (or has none) stays UNVERIFIED; the
 *   directory is society-scoped with a working category filter; resident
 *   ratings lazily recompute the vendor's ratingAvg/ratingCount; and only a
 *   COMMITTEE member can onboard or approve a vendor.
 *
 * GstinApiService talks to a deterministic offline stub whenever
 * GSTIN_API_ENABLED is false (the default, including in this test run) — no
 * network call is made. A 15-char GSTIN that doesn't start with "00" comes
 * back Active; one starting with "00" comes back Inactive. See
 * src/infra/gstinapi/gstinapi.service.ts.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

const ACTIVE_GSTIN = '29ABCDE1234F1Z5'; // 15 chars, doesn't start with "00" -> stub returns Active
const INACTIVE_GSTIN = '00ABCDE1234F1Z5'; // 15 chars, starts with "00" -> stub returns Inactive

describe('Vendors (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let cookieName: string;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  let otherFlatId: string;
  const userIds: string[] = [];
  const vendorIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  /** Signs a brand-new resident up in the given society/flat, verifies their OTP, and returns a cookie-jar agent logged in as them. */
  async function signupAndLogin(email: string, sId: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId: sId, flatId, role })
      .expect(201);

    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);


    // Phase 6.3 ratification gate: a self-registered occupancy starts
    // PENDING and UserContextService blocks it entirely (401) until a
    // committee officer ratifies it. This fixture helper isn't testing
    // the ratification gate itself (see ratification.e2e-spec.ts for
    // that) — it's standing up a normal, already-approved resident for
    // every other suite, so ratify directly via Prisma, matching how
    // other suites poke fixture state directly (e.g. identity.e2e-spec.ts
    // backdating otp.createdAt).
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeCommittee(sId: string, userId: string) {
    await prisma.role.create({ data: { societyId: sId, userId, kind: RoleKind.COMMITTEE } });
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;
    // Sanity check: the whole point of this suite is that GSTIN lookups run
    // against the offline stub, not a live API.
    expect(app.get(AppConfigService).env.GSTIN_API_ENABLED).toBe(false);

    const society = await prisma.society.create({ data: { name: 'Vendors Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 4; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `V-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }

    const otherSociety = await prisma.society.create({ data: { name: 'Vendors Test Society (other)', address: 'n/a' } });
    otherSocietyId = otherSociety.id;
    const otherFlat = await prisma.flat.create({
      data: { societyId: otherSocietyId, unitNo: `OV-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
    });
    otherFlatId = otherFlat.id;
  });

  afterAll(async () => {
    // FK-respecting cleanup, children before parents. Phase 7.1: Vendor no
    // longer carries societyId, so scope by the vendorIds this suite itself
    // created (tracked in the array above) instead — cascade would clean up
    // VendorCategory/VendorRating/VendorAccessRequest/VendorSocietyLink too,
    // but these stay explicit for clarity/ordering with the rest of the block.
    await prisma.vendorAccessRequest.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorRating.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorCategory.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.kycDocument.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyId, otherSocietyId] } } });

    await app.close();
  });

  it('a committee member onboards a vendor with an Active-looking GSTIN, and approve promotes it to SOCIETY_ATTESTED', async () => {
    const committee = await signupAndLogin(`vendor-committee-active-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);

    const createRes = await committee.agent
      .post('/api/v1/vendors')
      .send({ name: 'Ace Plumbing', categories: ['plumbing', 'electrical'], gstin: ACTIVE_GSTIN })
      .expect(201);
    const vendor = createRes.body as { id: string; verificationTier: string; categories: string[] };
    vendorIds.push(vendor.id);
    expect(vendor.verificationTier).toBe(VerificationTier.UNVERIFIED);
    expect(vendor.categories.sort()).toEqual(['electrical', 'plumbing']);

    const approveRes = await committee.agent.post(`/api/v1/vendors/${vendor.id}/approve`).expect(201);
    const approved = approveRes.body as { verificationTier: string; gstinVerifiedAt: string | null; note: string };
    expect(approved.verificationTier).toBe(VerificationTier.SOCIETY_ATTESTED);
    expect(approved.gstinVerifiedAt).not.toBeNull();

    const getRes = await committee.agent.get(`/api/v1/vendors/${vendor.id}`).expect(200);
    expect((getRes.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.SOCIETY_ATTESTED);
  });

  it('a vendor with a GSTIN starting "00" stays UNVERIFIED after approve; so does one with no GSTIN at all', async () => {
    const committee = await signupAndLogin(`vendor-committee-inactive-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);

    const withBadGstin = await committee.agent
      .post('/api/v1/vendors')
      .send({ name: 'Shaky Carpentry', categories: ['carpentry'], gstin: INACTIVE_GSTIN })
      .expect(201);
    vendorIds.push((withBadGstin.body as { id: string }).id);

    const approveBad = await committee.agent.post(`/api/v1/vendors/${(withBadGstin.body as { id: string }).id}/approve`).expect(201);
    expect((approveBad.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.UNVERIFIED);

    const withNoGstin = await committee.agent.post('/api/v1/vendors').send({ name: 'No Papers Movers', categories: ['moving'] }).expect(201);
    vendorIds.push((withNoGstin.body as { id: string }).id);

    const approveNone = await committee.agent.post(`/api/v1/vendors/${(withNoGstin.body as { id: string }).id}/approve`).expect(201);
    expect((approveNone.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.UNVERIFIED);
  });

  it('the vendor directory is society-scoped, and the category filter works', async () => {
    const committeeA = await signupAndLogin(`vendor-committee-dir-a-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committeeA.userId);
    const committeeB = await signupAndLogin(`vendor-committee-dir-b-${randomUUID()}@example.com`, otherSocietyId, otherFlatId, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(otherSocietyId, committeeB.userId);

    const vendorA = await committeeA.agent.post('/api/v1/vendors').send({ name: 'Directory Painters', categories: ['painting'] }).expect(201);
    vendorIds.push((vendorA.body as { id: string }).id);
    const vendorB = await committeeB.agent.post('/api/v1/vendors').send({ name: 'Other Society Painters', categories: ['painting'] }).expect(201);
    vendorIds.push((vendorB.body as { id: string }).id);

    const resident = await signupAndLogin(`vendor-resident-dir-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.TENANT);

    const list = await resident.agent.get('/api/v1/vendors').expect(200);
    const ids = (list.body as { id: string }[]).map((v) => v.id);
    expect(ids).toContain((vendorA.body as { id: string }).id);
    expect(ids).not.toContain((vendorB.body as { id: string }).id);

    // A resident of society A can never even fetch society B's vendor directly.
    await resident.agent.get(`/api/v1/vendors/${(vendorB.body as { id: string }).id}`).expect(404);

    const filtered = await resident.agent.get('/api/v1/vendors').query({ category: 'painting' }).expect(200);
    expect((filtered.body as { id: string }[]).map((v) => v.id)).toContain((vendorA.body as { id: string }).id);

    const filteredMiss = await resident.agent.get('/api/v1/vendors').query({ category: 'roofing' }).expect(200);
    expect((filteredMiss.body as { id: string }[]).map((v) => v.id)).not.toContain((vendorA.body as { id: string }).id);
  });

  it('resident ratings lazily recompute ratingAvg/ratingCount, and a non-committee resident gets 403 onboarding or approving a vendor', async () => {
    const committee = await signupAndLogin(`vendor-committee-rate-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);

    const vendorRes = await committee.agent.post('/api/v1/vendors').send({ name: 'Rated Electricians', categories: ['electrical'] }).expect(201);
    const vendorId = (vendorRes.body as { id: string }).id;
    vendorIds.push(vendorId);

    const resident = await signupAndLogin(`vendor-resident-rate-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.TENANT);

    // Non-committee residents are locked out of onboarding and approval.
    await resident.agent.post('/api/v1/vendors').send({ name: 'Should Fail', categories: ['x'] }).expect(403);
    await resident.agent.post(`/api/v1/vendors/${vendorId}/approve`).expect(403);

    await resident.agent.post(`/api/v1/vendors/${vendorId}/rate`).send({ rating: 4, comment: 'Good work' }).expect(201);
    const secondRateRes = await resident.agent.post(`/api/v1/vendors/${vendorId}/rate`).send({ rating: 5 }).expect(201);
    const rated = secondRateRes.body as { ratingAvg: string | number; ratingCount: number };
    expect(rated.ratingCount).toBe(2);
    expect(Number(rated.ratingAvg)).toBeCloseTo(4.5, 2);

    const getRes = await resident.agent.get(`/api/v1/vendors/${vendorId}`).expect(200);
    const detail = getRes.body as { ratingAvg: string | number; ratingCount: number };
    expect(detail.ratingCount).toBe(2);
    expect(Number(detail.ratingAvg)).toBeCloseTo(4.5, 2);

    // Access-request stub: any resident can raise one.
    await resident.agent.post(`/api/v1/vendors/${vendorId}/access-request`).send({ purpose: 'Need a quote for a rewiring job' }).expect(201);

    // KYC stub: any authenticated resident can record document metadata.
    await resident.agent.post('/api/v1/kyc/documents').send({ kind: 'ID_PROOF', fileName: 'aadhaar.pdf' }).expect(201);
  });

  /**
   * Phase 7.1 (BACKEND_PLAN.md Phase 7 item 1): the whole point of splitting
   * Vendor from VendorSocietyLink is that one vendor identity can now serve
   * several societies. An offer may only be created for a vendor actually
   * LINKED to the offer's society — this is the same rule bulk-buy always
   * had (vendor.societyId === societyId), now expressed as a
   * VendorSocietyLink existence check instead of a single-column compare.
   */
  it('an offer can be created for a vendor linked to the society, and is rejected for a society the vendor is NOT linked to', async () => {
    const committeeA = await signupAndLogin(`vendor-multi-committee-a-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committeeA.userId);
    const committeeB = await signupAndLogin(`vendor-multi-committee-b-${randomUUID()}@example.com`, otherSocietyId, otherFlatId, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(otherSocietyId, committeeB.userId);

    // Onboarded in society A only; then manually linked to society B too
    // (multi-society LINKING itself — adding a SECOND link to an existing
    // vendor — is 7.2/7.3 self-service territory, not built in this phase;
    // here we simulate the end state directly via Prisma, same as other
    // suites poke fixture state that has no route yet).
    const multiVendor = await committeeA.agent.post('/api/v1/vendors').send({ name: 'Multi-Society Movers', categories: ['moving'] }).expect(201);
    const multiVendorId = (multiVendor.body as { id: string }).id;
    vendorIds.push(multiVendorId);
    await prisma.vendorSocietyLink.create({ data: { vendorId: multiVendorId, societyId: otherSocietyId } });

    const futureIso = new Date(Date.now() + 86_400_000).toISOString();
    const baseOffer = { category: 'Groceries', title: 'Bulk order', unitPrice: 500, discountLadder: [{ minN: 2, pct: 5 }], deadline: futureIso };

    // Society B's committee CAN offer through the multi-society vendor —
    // it's actually linked there now.
    const okOffer = await committeeB.agent.post('/api/v1/offers').send({ ...baseOffer, vendorId: multiVendorId }).expect(201);
    expect((okOffer.body as { vendorId: string }).vendorId).toBe(multiVendorId);

    // A vendor onboarded ONLY in society A is rejected when society B's
    // committee tries to offer through it — not linked there.
    const soloVendor = await committeeA.agent.post('/api/v1/vendors').send({ name: 'Society A Only Plumbers', categories: ['plumbing'] }).expect(201);
    const soloVendorId = (soloVendor.body as { id: string }).id;
    vendorIds.push(soloVendorId);
    await committeeB.agent.post('/api/v1/offers').send({ ...baseOffer, vendorId: soloVendorId }).expect(404);

    // ...but society A's own committee CAN, through the very same vendor.
    const ownSocietyOffer = await committeeA.agent.post('/api/v1/offers').send({ ...baseOffer, vendorId: soloVendorId }).expect(201);
    expect((ownSocietyOffer.body as { vendorId: string }).vendorId).toBe(soloVendorId);
  });

  /**
   * Phase 7.1: Vendor.ratingAvg/ratingCount stay the GLOBAL aggregate they
   * always were — unaffected by a vendor now serving several societies.
   * Residents of two DIFFERENT (both linked) societies rate the same
   * vendor; the aggregate is one number, identical no matter which
   * society's directory it's read from.
   */
  it('the global rating aggregate is unchanged by the vendor/society split — ratings from two different linked societies aggregate into one number', async () => {
    const committeeA = await signupAndLogin(`vendor-rate-committee-a-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committeeA.userId);

    const vendorRes = await committeeA.agent.post('/api/v1/vendors').send({ name: 'Cross-Society Rated Vendor', categories: ['cleaning'] }).expect(201);
    const crossVendorId = (vendorRes.body as { id: string }).id;
    vendorIds.push(crossVendorId);
    await prisma.vendorSocietyLink.create({ data: { vendorId: crossVendorId, societyId: otherSocietyId } });

    const residentA = await signupAndLogin(`vendor-rate-resident-a-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.TENANT);
    const residentB = await signupAndLogin(`vendor-rate-resident-b-${randomUUID()}@example.com`, otherSocietyId, otherFlatId, OccupancyRole.TENANT);

    await residentA.agent.post(`/api/v1/vendors/${crossVendorId}/rate`).send({ rating: 4 }).expect(201);
    const secondRate = await residentB.agent.post(`/api/v1/vendors/${crossVendorId}/rate`).send({ rating: 2 }).expect(201);
    const rated = secondRate.body as { ratingAvg: string | number; ratingCount: number };
    expect(rated.ratingCount).toBe(2);
    expect(Number(rated.ratingAvg)).toBeCloseTo(3, 2);

    // Read back from BOTH societies' directories — same global row, same numbers.
    const fromA = (await residentA.agent.get(`/api/v1/vendors/${crossVendorId}`).expect(200)).body as { ratingAvg: string | number; ratingCount: number };
    const fromB = (await residentB.agent.get(`/api/v1/vendors/${crossVendorId}`).expect(200)).body as { ratingAvg: string | number; ratingCount: number };
    expect(fromA.ratingCount).toBe(2);
    expect(fromB.ratingCount).toBe(2);
    expect(Number(fromA.ratingAvg)).toBeCloseTo(3, 2);
    expect(Number(fromB.ratingAvg)).toBeCloseTo(3, 2);
  });
});
