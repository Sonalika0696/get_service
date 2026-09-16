import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { generate as generateTotpCode } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, PrincipalKind, RoleKind, VerificationTier } from '../src/generated/prisma/enums.js';

/**
 * Phase 7.3 (BACKEND_PLAN.md Phase 7 items 6-8) Definition of Done,
 * end-to-end against real Postgres:
 *   - a vendor manages its own profile (contact/geo/radius, categories) and
 *     declares a settlement account + trade licence, reading them back only
 *     through its own self-service surface — never through the
 *     resident/committee-facing directory routes, and never addressable for
 *     another vendor's row;
 *   - an operator promotes a SOCIETY_ATTESTED vendor with a GSTIN or trade
 *     licence on file to PLATFORM_AUDITED, idempotently and audited; a
 *     non-operator is 403'd; and the promotion precondition (must already
 *     be SOCIETY_ATTESTED, must carry a GSTIN or trade licence) is enforced.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpFromEmail(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

const ACTIVE_GSTIN = '29ABCDE1234F1Z5'; // 15 chars, doesn't start with "00" -> the offline GSTIN stub returns Active

describe('Vendor portal — Phase 7.3 profile, settlement, trade licence, PLATFORM_AUDITED promotion (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  let flatId: string;
  const userIds: string[] = [];
  const vendorIds: string[] = [];

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

    const society = await prisma.society.create({ data: { name: 'Vendor Portal 7.3 Society', address: 'n/a' } });
    societyId = society.id;
    const flat = await prisma.flat.create({ data: { societyId, unitNo: `VP73-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatId = flat.id;
  });

  afterAll(async () => {
    await prisma.vendorCategory.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  /** Creates a fresh Vendor row linked to `societyId`, provisions + enrolls a VENDOR principal for it, and returns a logged-in cookie-jar agent plus the vendor id. */
  async function vendorAgentFixture(name: string) {
    const vendor = await prisma.vendor.create({ data: { name } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId } });

    const email = `vp73-vendor-${randomUUID()}@example.com`;
    const password = 'a reasonably long fixture password';
    const user = await prisma.user.create({
      data: { name: 'Vendor Portal Officer', email, principalKind: PrincipalKind.VENDOR, vendorId: vendor.id },
    });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
    return { agent, vendorId: vendor.id };
  }

  /** Provisions + enrolls an OPERATOR principal and returns a logged-in cookie-jar agent. */
  async function operatorAgentFixture() {
    const email = `vp73-operator-${randomUUID()}@example.com`;
    const password = 'a reasonably long operator password';
    const user = await prisma.user.create({ data: { name: 'Vendor Portal Operator', email, principalKind: PrincipalKind.OPERATOR } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
    return agent;
  }

  /** Signs a brand-new resident up (email OTP) in the fixture society, ratifies the occupancy directly, and returns a cookie-jar agent logged in as them. */
  async function residentAgentFixture() {
    const email = `vp73-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `VP73 Resident ${email}`, email, societyId, flatId, role: OccupancyRole.TENANT })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = mailer.sent.filter((m) => m.to === email && m.subject === 'Your verification code').at(-1)!;
    const code = extractOtpFromEmail(otpMail);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { agent, userId };
  }

  it('a vendor manages its own profile — contact/geo/radius, categories add/remove, settlement account + trade licence read back — none of it addressable for or leaked to anyone else', async () => {
    const { agent: vendorA, vendorId: vendorAId } = await vendorAgentFixture('Self-Service Plumbing Co');
    const { agent: vendorB, vendorId: vendorBId } = await vendorAgentFixture('Other Vendor Co');
    await prisma.vendorCategory.createMany({ data: [{ vendorId: vendorAId, category: 'plumbing' }] });

    // --- Profile update: contact, geo, radius, trade licence, settlement account.
    const updateRes = await vendorA
      .patch('/api/v1/vendors/me/profile')
      .send({
        contactEmail: 'vendor-a-contact@example.com',
        contactPhone: '+919812345678',
        latitude: 19.076,
        longitude: 72.8777,
        radiusKm: 12.5,
        tradeLicenceNumber: 'TL-2026-000123',
        settlementAccountName: 'Self-Service Plumbing Co',
        settlementAccountNumber: '123456789012',
        settlementIfsc: 'HDFC0001234',
      })
      .expect(200);
    const updated = updateRes.body as Record<string, unknown>;
    expect(updated.contactEmail).toBe('vendor-a-contact@example.com');
    expect(updated.contactPhone).toBe('+919812345678');
    expect(Number(updated.radiusKm)).toBeCloseTo(12.5, 2);
    expect(updated.tradeLicenceNumber).toBe('TL-2026-000123');
    expect(updated.settlementAccountName).toBe('Self-Service Plumbing Co');
    expect(updated.settlementAccountNumber).toBe('123456789012');
    expect(updated.settlementIfsc).toBe('HDFC0001234');

    // Reads back identically through GET /vendors/me/profile.
    const profileRes = await vendorA.get('/api/v1/vendors/me/profile').expect(200);
    const profile = profileRes.body as Record<string, unknown>;
    expect(profile.settlementAccountNumber).toBe('123456789012');
    expect(profile.tradeLicenceNumber).toBe('TL-2026-000123');
    expect(profile.id).toBe(vendorAId);

    // --- Category self-service: add, then remove.
    const addCatRes = await vendorA.post('/api/v1/vendors/me/categories').send({ category: 'landscaping' }).expect(201);
    expect((addCatRes.body as { categories: string[] }).categories.sort()).toEqual(['landscaping', 'plumbing']);
    // Idempotent re-add — no duplicate, no error.
    const addCatAgainRes = await vendorA.post('/api/v1/vendors/me/categories').send({ category: 'landscaping' }).expect(201);
    expect((addCatAgainRes.body as { categories: string[] }).categories.sort()).toEqual(['landscaping', 'plumbing']);

    const removeCatRes = await vendorA.delete('/api/v1/vendors/me/categories/landscaping').expect(200);
    expect((removeCatRes.body as { categories: string[] }).categories).toEqual(['plumbing']);
    // Idempotent remove of something already gone — still 200, not 404.
    await vendorA.delete('/api/v1/vendors/me/categories/landscaping').expect(200);

    // --- Cannot address another vendor's row: the DTO has no vendorId field
    // at all, and the global ValidationPipe (whitelist + forbidNonWhitelisted)
    // rejects a body that tries to smuggle one in.
    await vendorA.patch('/api/v1/vendors/me/profile').send({ vendorId: vendorBId, contactEmail: 'x@example.com' }).expect(400);

    // vendorB's own profile update never touches vendorA's row.
    await vendorB.patch('/api/v1/vendors/me/profile').send({ contactEmail: 'vendor-b-contact@example.com' }).expect(200);
    const vendorAStillIntact = await vendorA.get('/api/v1/vendors/me/profile').expect(200);
    expect((vendorAStillIntact.body as { contactEmail: string }).contactEmail).toBe('vendor-a-contact@example.com');
    // ...and vendorB cannot read vendorA's self-service profile at all (it's always "my own", never parameterized by id).
    const vendorBProfile = await vendorB.get('/api/v1/vendors/me/profile').expect(200);
    expect((vendorBProfile.body as { id: string }).id).toBe(vendorBId);

    // --- Settlement account never leaks through the resident/committee-facing directory routes.
    const { agent: residentAgent } = await residentAgentFixture();
    const publicGetRes = await residentAgent.get(`/api/v1/vendors/${vendorAId}`).expect(200);
    const publicBody = publicGetRes.body as Record<string, unknown>;
    expect(publicBody.settlementAccountNumber).toBeUndefined();
    expect(publicBody.settlementAccountName).toBeUndefined();
    expect(publicBody.settlementIfsc).toBeUndefined();
    // Trade licence and GSTIN-style fields are fine to surface publicly (same tier as gstin/gstinVerifiedAt today).
    expect(publicBody.tradeLicenceNumber).toBe('TL-2026-000123');

    const publicListRes = await residentAgent.get('/api/v1/vendors').expect(200);
    for (const v of publicListRes.body as Record<string, unknown>[]) {
      expect(v.settlementAccountNumber).toBeUndefined();
    }

    // A vendor-only route: an operator or resident cannot reach it at all.
    await residentAgent.get('/api/v1/vendors/me/profile').expect(403);
    const operatorAgent = await operatorAgentFixture();
    await operatorAgent.get('/api/v1/vendors/me/profile').expect(403);
  });

  it('an operator promotes a SOCIETY_ATTESTED vendor to PLATFORM_AUDITED, idempotently and audited; a non-operator is 403d; the precondition is enforced', async () => {
    const committee = await (async () => {
      const email = `vp73-committee-${randomUUID()}@example.com`;
      const signupRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ name: `VP73 Committee ${email}`, email, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
        .expect(201);
      const userId = (signupRes.body as { userId: string }).userId;
      userIds.push(userId);
      const otpMail = mailer.sent.filter((m) => m.to === email && m.subject === 'Your verification code').at(-1)!;
      const code = extractOtpFromEmail(otpMail);
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
      await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
      await prisma.role.create({ data: { societyId, userId, kind: RoleKind.COMMITTEE } });
      return agent;
    })();

    // Onboard + approve a vendor to SOCIETY_ATTESTED (the automatic GSTIN-Active path).
    const createRes = await committee.post('/api/v1/vendors').send({ name: 'Promotable Plumbing', categories: ['plumbing'], gstin: ACTIVE_GSTIN }).expect(201);
    const vendorId = (createRes.body as { id: string }).id;
    vendorIds.push(vendorId);
    const approveRes = await committee.post(`/api/v1/vendors/${vendorId}/approve`).expect(201);
    expect((approveRes.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.SOCIETY_ATTESTED);

    const operatorAgent = await operatorAgentFixture();
    const { agent: vendorAgent } = await vendorAgentFixture('Bystander vendor');
    const { agent: residentAgent } = await residentAgentFixture();

    // Non-operator principals are 403'd outright.
    await vendorAgent.post(`/api/v1/operator/vendors/${vendorId}/promote`).expect(403);
    await residentAgent.post(`/api/v1/operator/vendors/${vendorId}/promote`).expect(403);

    // Operator promotes.
    const promoteRes = await operatorAgent.post(`/api/v1/operator/vendors/${vendorId}/promote`).expect(201);
    expect((promoteRes.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.PLATFORM_AUDITED);
    expect((promoteRes.body as Record<string, unknown>).settlementAccountNumber).toBeUndefined();

    const auditRows = await prisma.auditLog.findMany({ where: { subjectId: vendorId, action: 'VENDOR_PROMOTE_PLATFORM_AUDITED' } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].societyId).toBe(societyId);

    // Idempotent: promoting again is still a 200/PLATFORM_AUDITED, and does NOT write a second audit entry.
    const promoteAgainRes = await operatorAgent.post(`/api/v1/operator/vendors/${vendorId}/promote`).expect(201);
    expect((promoteAgainRes.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.PLATFORM_AUDITED);
    const auditRowsAfterRepeat = await prisma.auditLog.findMany({ where: { subjectId: vendorId, action: 'VENDOR_PROMOTE_PLATFORM_AUDITED' } });
    expect(auditRowsAfterRepeat).toHaveLength(1);

    // Precondition: a fresh UNVERIFIED vendor cannot be promoted straight to PLATFORM_AUDITED (must pass through SOCIETY_ATTESTED).
    const freshRes = await committee.post('/api/v1/vendors').send({ name: 'Unverified Movers', categories: ['moving'] }).expect(201);
    const freshVendorId = (freshRes.body as { id: string }).id;
    vendorIds.push(freshVendorId);
    await operatorAgent.post(`/api/v1/operator/vendors/${freshVendorId}/promote`).expect(400);

    // Precondition: a vendor forced to SOCIETY_ATTESTED with neither a GSTIN nor a trade licence on file is refused.
    await prisma.vendor.update({ where: { id: freshVendorId }, data: { verificationTier: VerificationTier.SOCIETY_ATTESTED } });
    await operatorAgent.post(`/api/v1/operator/vendors/${freshVendorId}/promote`).expect(400);

    // ...but it succeeds once a trade licence (no GSTIN needed) is on file.
    await prisma.vendor.update({ where: { id: freshVendorId }, data: { tradeLicenceNumber: 'TL-2026-000999' } });
    const promotedViaLicenceRes = await operatorAgent.post(`/api/v1/operator/vendors/${freshVendorId}/promote`).expect(201);
    expect((promotedViaLicenceRes.body as { verificationTier: string }).verificationTier).toBe(VerificationTier.PLATFORM_AUDITED);

    // A non-existent vendor id is a clean 404.
    await operatorAgent.post(`/api/v1/operator/vendors/${randomUUID()}/promote`).expect(404);
  });
});
