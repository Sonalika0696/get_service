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
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, PrincipalKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.2 (identity) Definition of Done, end-to-end against real
 * Postgres — see BACKEND_PLAN.md Phase 6.2:
 *   a resident signs up and logs in by PHONE OTP (delivered through the
 *   stubbed SmsService — never a real network call); a vendor authenticates
 *   with password + mandatory TOTP (and is rejected on a wrong/absent TOTP
 *   code); an operator authenticates, reaches an operator-only route that
 *   403s a resident, and bypasses SocietyScopeGuard; @ResidentOnly() /
 *   @VendorOnly() / @OperatorOnly() each 403 the wrong principal; and a
 *   bearer token reaches an authenticated route with no cookie at all.
 *
 * VENDOR/OPERATOR User rows are created directly via Prisma (no self-serve
 * account-creation route exists yet — that's Phase 6.3's admin/operator
 * console CRUD), exactly like every other suite in this repo creates Role
 * rows directly to set up a COMMITTEE fixture.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

class CapturingSms {
  sent: SendSmsInput[] = [];
  async send(input: SendSmsInput): Promise<SmsSendResult> {
    this.sent.push(input);
    return { id: `test_${randomUUID()}`, status: 'stub_logged' };
  }
}

function extractOtpFromEmail(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

function extractOtpFromSms(sms: SendSmsInput): string {
  const match = sms.body.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured SMS: ${sms.body}`);
  return match[1];
}

function extractCookieToken(setCookie: string | string[] | undefined, cookieName: string): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = cookies.find((c) => c.startsWith(`${cookieName}=`));
  if (!raw) throw new Error(`No "${cookieName}" cookie in Set-Cookie headers: ${JSON.stringify(setCookie)}`);
  const match = raw.match(new RegExp(`^${cookieName}=([^;]+)`));
  if (!match) throw new Error(`Could not parse token out of cookie: ${raw}`);
  return decodeURIComponent(match[1]);
}

/** A code that is NOT the given TOTP code — for the wrong-code negative control. */
function otherCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('Identity — Phase 6.2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let sms: CapturingSms;
  let cookieName: string;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  let vendorRowId: string;
  const extraVendorIds: string[] = [];

  beforeAll(async () => {
    mailer = new CapturingMailer();
    sms = new CapturingSms();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .overrideProvider(SmsService)
      .useValue(sms)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;
    // Sanity check: the whole point of this suite's phone-OTP tests is that
    // delivery runs against the offline SMS stub, never a real gateway.
    expect(app.get(AppConfigService).env.SMS_ENABLED).toBe(false);

    const society = await prisma.society.create({ data: { name: 'Identity Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 2; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `ID-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }

    const otherSociety = await prisma.society.create({ data: { name: 'Identity Test Society (other)', address: 'n/a' } });
    otherSocietyId = otherSociety.id;

    const vendorRow = await prisma.vendor.create({ data: { societyId, name: 'Identity Test Vendor Co' } });
    vendorRowId = vendorRow.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendorRowId, ...extraVendorIds] } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyId, otherSocietyId] } } });

    await app.close();
  });

  it('a resident signs up and logs in by phone OTP, delivered via the stubbed SMS sender', async () => {
    const phone = `+9199${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `resident-phone-${randomUUID()}@example.com`;

    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Phone Resident', email, phone, societyId, flatId: flatIds[0], role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    // The signup OTP went out over SMS (phone was supplied), not email —
    // proving the stub captured it rather than any real gateway sending it.
    const signupSms = sms.sent.filter((s) => s.to === phone);
    expect(signupSms.length).toBeGreaterThan(0);
    const signupCode = extractOtpFromSms(signupSms.at(-1)!);
    expect(mailer.sent.some((m) => m.to === email)).toBe(false);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ phone, code: signupCode }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);

    const afterSignup = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterSignup.phoneVerifiedAt).not.toBeNull();
    expect(afterSignup.principalKind).toBe(PrincipalKind.RESIDENT);

    // Phase 6.3: a freshly-signed-up occupancy is PENDING ratification and
    // UserContextService blocks it (401) — see ratification.e2e-spec.ts for
    // that gate in isolation. This suite is about phone OTP, not
    // ratification, so ratify directly via Prisma to unblock the `GET /me`
    // assertion further down, same as every other suite's signupAndLogin.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    // Now a SEPARATE login (not the signup verification): back-date the
    // consumed OTP row past the 60s resend cooldown (same technique other
    // suites use — poking Prisma directly for fixture state — rather than
    // sleeping the test for a minute), then request+verify a fresh code.
    await prisma.otp.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 120_000) } });

    await request(app.getHttpServer()).post('/api/v1/auth/otp').send({ phone }).expect(204);
    const loginSms = sms.sent.filter((s) => s.to === phone);
    expect(loginSms.length).toBeGreaterThan(signupSms.length);
    const loginCode = extractOtpFromSms(loginSms.at(-1)!);
    expect(loginCode).not.toBe(signupCode);

    const loginAgent = request.agent(app.getHttpServer());
    const loginRes = await loginAgent.post('/api/v1/auth/verify').send({ phone, code: loginCode }).expect(201);
    expect((loginRes.body as { id: string }).id).toBe(userId);

    // The freshly-logged-in session actually authenticates on a real resident route.
    const meRes = await loginAgent.get('/api/v1/me').expect(200);
    expect((meRes.body as { id: string; societyId: string }).societyId).toBe(societyId);
  });

  it('email and phone cannot both be given in one OTP request', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/otp').send({ email: 'a@example.com', phone: '+911234567890' }).expect(400);
  });

  describe('vendor and operator: password + mandatory TOTP 2FA', () => {
    async function provisionAndEnroll(principalKind: 'VENDOR' | 'OPERATOR', email: string, password: string) {
      const user = await prisma.user.create({
        data: {
          name: `Officer ${email}`,
          email,
          principalKind,
          vendorId: principalKind === 'VENDOR' ? vendorRowId : null,
        },
      });
      userIds.push(user.id);

      await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
      const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);

      const completeRes = await request(app.getHttpServer())
        .post('/api/v1/auth/officer/enroll/complete')
        .send({ email, code: startCode, password })
        .expect(201);
      const { totpSecret } = completeRes.body as { totpSecret: string; otpauthUrl: string };
      expect(typeof totpSecret).toBe('string');
      expect(completeRes.body).toHaveProperty('otpauthUrl');

      const enrollTotpCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
      await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollTotpCode }).expect(204);

      const enrolled = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(enrolled.totpEnabledAt).not.toBeNull();
      expect(enrolled.passwordHash).not.toBeNull();

      return { userId: user.id, totpSecret };
    }

    it('a vendor authenticates with password + TOTP, and a wrong/absent TOTP code is rejected', async () => {
      const email = `vendor-officer-${randomUUID()}@example.com`;
      const password = 'correct horse battery staple';
      const { userId, totpSecret } = await provisionAndEnroll('VENDOR', email, password);

      const validCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });

      // Negative controls first — neither should create a session.
      await request(app.getHttpServer()).post('/api/v1/auth/officer/login').send({ email, password, totpCode: otherCode(validCode) }).expect(401);
      await request(app.getHttpServer()).post('/api/v1/auth/officer/login').send({ email, password }).expect(401);
      await request(app.getHttpServer()).post('/api/v1/auth/officer/login').send({ email, password: 'wrong password', totpCode: validCode }).expect(401);

      const freshCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
      const agent = request.agent(app.getHttpServer());
      const loginRes = await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: freshCode }).expect(201);
      expect(loginRes.body).toMatchObject({ id: userId, principalKind: PrincipalKind.VENDOR });
      expect(loginRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);

      // The session is a real VendorPrincipal — reaches the vendor-only identity route.
      const meRes = await agent.get('/api/v1/vendors/me').expect(200);
      expect(meRes.body).toEqual({ vendorId: vendorRowId, societyId });

      // ...but not a resident-only one.
      await agent.get('/api/v1/me').expect(403);
    });

    it('an operator authenticates, reaches an operator-only route (a resident is 403d), and bypasses SocietyScopeGuard', async () => {
      const email = `operator-${randomUUID()}@example.com`;
      const password = 'operator super secret passphrase';
      const { userId, totpSecret } = await provisionAndEnroll('OPERATOR', email, password);
      const code = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });

      const operatorAgent = request.agent(app.getHttpServer());
      const loginRes = await operatorAgent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: code }).expect(201);
      expect(loginRes.body).toMatchObject({ id: userId, principalKind: PrincipalKind.OPERATOR });

      const pingRes = await operatorAgent.get('/api/v1/operator/ping').expect(200);
      expect(pingRes.body).toEqual({ ok: true, operatorId: userId });

      // Bypasses SocietyScopeGuard even for a society id that doesn't exist.
      const bogusSid = randomUUID();
      await operatorAgent.get(`/api/v1/operator/societies/${bogusSid}/ping`).expect(200);

      // A resident is 403'd off the operator-only route, and off the scoped
      // route once their own society doesn't match :sid (no bypass for them).
      const residentAgent = await residentAgentFixture();
      await residentAgent.get('/api/v1/operator/ping').expect(403);
      await residentAgent.get(`/api/v1/operator/societies/${otherSocietyId}/ping`).expect(403);
      // ...but their own society's :sid is fine.
      await residentAgent.get(`/api/v1/operator/societies/${societyId}/ping`).expect(200);
    });
  });

  it('@ResidentOnly / @VendorOnly / @OperatorOnly each reject the wrong principal with 403', async () => {
    const residentAgent = await residentAgentFixture();
    const vendorAgent = await officerAgentFixture('VENDOR');
    const operatorAgent = await officerAgentFixture('OPERATOR');

    // ResidentOnly (GET /me)
    await residentAgent.get('/api/v1/me').expect(200);
    await vendorAgent.get('/api/v1/me').expect(403);
    await operatorAgent.get('/api/v1/me').expect(403);

    // VendorOnly (GET /vendors/me)
    await vendorAgent.get('/api/v1/vendors/me').expect(200);
    await residentAgent.get('/api/v1/vendors/me').expect(403);
    await operatorAgent.get('/api/v1/vendors/me').expect(403);

    // OperatorOnly (GET /operator/ping)
    await operatorAgent.get('/api/v1/operator/ping').expect(200);
    await residentAgent.get('/api/v1/operator/ping').expect(403);
    await vendorAgent.get('/api/v1/operator/ping').expect(403);
  });

  it('accepts a bearer token in place of the session cookie', async () => {
    const phone = `+9198${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `resident-bearer-${randomUUID()}@example.com`;

    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Bearer Resident', email, phone, societyId, flatId: flatIds[1], role: OccupancyRole.TENANT })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const verifyRes = await request(app.getHttpServer()).post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    const token = extractCookieToken(verifyRes.headers['set-cookie'], cookieName);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    // A brand-new, cookie-less request carrying only the bearer header.
    const bearerRes = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect((bearerRes.body as { id: string }).id).toBe(userId);

    // No credentials at all still 401s (bearer isn't a bypass of auth itself).
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
  });

  /** Signs a brand-new resident up in the shared society/flat, verifies by phone, and returns a cookie-jar agent logged in as them. */
  async function residentAgentFixture() {
    const phone = `+9197${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `resident-fixture-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Fixture Resident', email, phone, societyId, flatId: flatIds[0], role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return agent;
  }

  /**
   * Provisions + fully enrolls a VENDOR/OPERATOR account and returns a
   * cookie-jar agent logged in as them. User.vendorId is unique (one login
   * per Vendor identity), so a VENDOR fixture gets its own fresh Vendor row
   * rather than reusing the suite-level `vendorRowId`.
   */
  async function officerAgentFixture(principalKind: 'VENDOR' | 'OPERATOR') {
    const email = `${principalKind.toLowerCase()}-fixture-${randomUUID()}@example.com`;
    const password = 'a reasonably long fixture password';

    let linkedVendorId: string | null = null;
    if (principalKind === 'VENDOR') {
      const vendor = await prisma.vendor.create({ data: { societyId, name: `Fixture Vendor ${randomUUID()}` } });
      extraVendorIds.push(vendor.id);
      linkedVendorId = vendor.id;
    }

    const user = await prisma.user.create({
      data: {
        name: `Fixture ${principalKind}`,
        email,
        principalKind,
        vendorId: linkedVendorId,
      },
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
    return agent;
  }
});
