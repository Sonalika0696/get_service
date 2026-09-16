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
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, PrincipalKind, SocietyStatus } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.3 platform-operator console — BACKEND_PLAN.md Phase 6.3 items 1-3;
 * DECISIONS_V2_SCOPE.md §1.4. Society CRUD/lifecycle, VENDOR/OPERATOR
 * account provisioning, and flat-register CSV import — all OPERATOR-only.
 *
 * The very first operator account in this suite is provisioned directly via
 * Prisma, exactly like identity.e2e-spec.ts's officerAgentFixture — there is
 * no self-serve account creation, and (deliberately) no way to provision an
 * operator except through another operator, so the first one is always a
 * platform bootstrap step outside this API, not a route this suite can
 * exercise from nothing.
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

describe('Operator console — Phase 6.3 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let sms: CapturingSms;

  let homeSocietyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const societyIds: string[] = [];
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

    const society = await prisma.society.create({ data: { name: 'Operator Console Home Society', address: 'n/a' } });
    homeSocietyId = society.id;
    societyIds.push(homeSocietyId);
  });

  afterAll(async () => {
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.vendorCategory.deleteMany({ where: { vendorId: { in: extraVendorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: extraVendorIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  async function bootstrapOperatorAgent() {
    const email = `bootstrap-operator-${randomUUID()}@example.com`;
    const password = 'bootstrap operator passphrase';
    const user = await prisma.user.create({ data: { name: 'Bootstrap Operator', email, principalKind: PrincipalKind.OPERATOR } });
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
    return { agent, userId: user.id };
  }

  /** A fully ratified resident of the home society — the 403 negative control on every operator-only route. */
  async function residentAgentFixture() {
    const flat = await prisma.flat.create({ data: { societyId: homeSocietyId, unitNo: `OC-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatIds.push(flat.id);
    const phone = `+9192${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `operator-console-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Resident', email, phone, societyId: homeSocietyId, flatId: flat.id, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return agent;
  }

  describe('society CRUD + lifecycle', () => {
    it('an operator creates, updates, archives and reactivates a society; a resident is 403d off every route', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const residentAgent = await residentAgentFixture();

      await residentAgent.post('/api/v1/operator/societies').send({ name: 'Nope', address: 'nope' }).expect(403);

      const createRes = await operatorAgent.post('/api/v1/operator/societies').send({ name: 'New Society', address: '221B Baker St' }).expect(201);
      const society = createRes.body as { id: string; status: string };
      societyIds.push(society.id);
      expect(society.status).toBe(SocietyStatus.ACTIVE);

      // The audit chain got a genesis entry keyed on the NEW society's own id
      // (there was no society to scope to before this call — see
      // SocietiesService.create's doc comment).
      const auditRows = await prisma.auditLog.findMany({ where: { societyId: society.id, action: 'SOCIETY_CREATE' } });
      expect(auditRows).toHaveLength(1);

      await residentAgent.get(`/api/v1/operator/societies/${society.id}`).expect(403);

      const updateRes = await operatorAgent.patch(`/api/v1/operator/societies/${society.id}`).send({ name: 'Renamed Society' }).expect(200);
      expect((updateRes.body as { name: string }).name).toBe('Renamed Society');
      await residentAgent.patch(`/api/v1/operator/societies/${society.id}`).send({ name: 'Nope' }).expect(403);

      const archiveRes = await operatorAgent.post(`/api/v1/operator/societies/${society.id}/archive`).expect(201);
      expect((archiveRes.body as { status: string }).status).toBe(SocietyStatus.ARCHIVED);
      // Archiving twice is rejected, not silently repeated.
      await operatorAgent.post(`/api/v1/operator/societies/${society.id}/archive`).expect(409);
      await residentAgent.post(`/api/v1/operator/societies/${society.id}/archive`).expect(403);

      const reactivateRes = await operatorAgent.post(`/api/v1/operator/societies/${society.id}/reactivate`).expect(201);
      expect((reactivateRes.body as { status: string }).status).toBe(SocietyStatus.ACTIVE);

      const listRes = await operatorAgent.get('/api/v1/operator/societies').expect(200);
      expect((listRes.body as { id: string }[]).some((s) => s.id === society.id)).toBe(true);
    });
  });

  describe('VENDOR/OPERATOR account provisioning', () => {
    it('provisions a VENDOR account that can enroll and log in for real, and rejects a second login for the same vendor', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const vendor = await prisma.vendor.create({ data: { name: `Provisioned Vendor Co ${randomUUID()}` } });
      extraVendorIds.push(vendor.id);
      await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId: homeSocietyId } });

      const email = `provisioned-vendor-${randomUUID()}@example.com`;
      const provisionRes = await operatorAgent.post('/api/v1/operator/accounts').send({ name: 'Provisioned Vendor', email, principalKind: 'VENDOR', vendorId: vendor.id }).expect(201);
      const provisioned = provisionRes.body as { id: string; principalKind: string };
      userIds.push(provisioned.id);
      expect(provisioned.principalKind).toBe(PrincipalKind.VENDOR);

      const auditRows = await prisma.auditLog.findMany({ where: { societyId: homeSocietyId, action: 'VENDOR_ACCOUNT_PROVISION', subjectId: provisioned.id } });
      expect(auditRows).toHaveLength(1);

      // A second login provisioned against the SAME vendor is rejected.
      await operatorAgent
        .post('/api/v1/operator/accounts')
        .send({ name: 'Dup', email: `dup-${randomUUID()}@example.com`, principalKind: 'VENDOR', vendorId: vendor.id })
        .expect(409);

      // The provisioned row is a real, usable OfficerAuthService login — unchanged by this phase.
      const password = 'a provisioned vendor passphrase';
      await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
      const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
      const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
      const { totpSecret } = completeRes.body as { totpSecret: string };
      const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
      await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);
      const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
      const vendorAgent = request.agent(app.getHttpServer());
      await vendorAgent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
      const meRes = await vendorAgent.get('/api/v1/vendors/me').expect(200);
      expect(meRes.body).toEqual({ vendorId: vendor.id, societyIds: [homeSocietyId] });
    });

    it('rejects VENDOR provisioning with no vendorId, and OPERATOR provisioning WITH one', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      await operatorAgent.post('/api/v1/operator/accounts').send({ name: 'No Vendor', email: `no-vendor-${randomUUID()}@example.com`, principalKind: 'VENDOR' }).expect(400);

      const vendor = await prisma.vendor.create({ data: { name: `Stray Vendor ${randomUUID()}` } });
      extraVendorIds.push(vendor.id);
      await operatorAgent
        .post('/api/v1/operator/accounts')
        .send({ name: 'Bad Operator', email: `bad-operator-${randomUUID()}@example.com`, principalKind: 'OPERATOR', vendorId: vendor.id })
        .expect(400);
    });

    it('a resident cannot provision accounts', async () => {
      const residentAgent = await residentAgentFixture();
      await residentAgent.post('/api/v1/operator/accounts').send({ name: 'x', email: `x-${randomUUID()}@example.com`, principalKind: 'OPERATOR' }).expect(403);
    });
  });

  describe('flat register CSV import', () => {
    it('imports new flats, and re-importing the same unitNo updates rather than duplicates (idempotent-friendly upsert)', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const society = await prisma.society.create({ data: { name: 'Flat Import Society', address: 'n/a' } });
      societyIds.push(society.id);

      const importRes = await operatorAgent
        .post(`/api/v1/operator/societies/${society.id}/flats/import`)
        .send({ csv: 'unitNo,maintenanceAmount\nA-101,1500.50\nA-102,1600\n' })
        .expect(201);
      expect(importRes.body).toEqual({ created: 2, updated: 0, total: 2 });

      const flatsAfter = await prisma.flat.findMany({ where: { societyId: society.id }, orderBy: { unitNo: 'asc' } });
      expect(flatsAfter).toHaveLength(2);
      expect(Number(flatsAfter[0].maintenanceAmount)).toBe(1500.5);

      // Audit entry carries a compact summary, not the raw CSV.
      const auditRows = await prisma.auditLog.findMany({ where: { societyId: society.id, action: 'FLAT_IMPORT' } });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].payload).toEqual({ created: 2, updated: 0, total: 2 });

      // Re-import: one amount corrected, one new flat added -> upsert, not duplicate/reject.
      const importRes2 = await operatorAgent
        .post(`/api/v1/operator/societies/${society.id}/flats/import`)
        .send({ csv: 'unitNo,maintenanceAmount\nA-101,1750\nA-103,1200\n' })
        .expect(201);
      expect(importRes2.body).toEqual({ created: 1, updated: 1, total: 2 });

      const flatsFinal = await prisma.flat.findMany({ where: { societyId: society.id } });
      expect(flatsFinal).toHaveLength(3);
      const a101 = flatsFinal.find((f) => f.unitNo === 'A-101')!;
      expect(Number(a101.maintenanceAmount)).toBe(1750);
    });

    it('rejects a file with a duplicate unitNo within itself, atomically — no rows written', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const society = await prisma.society.create({ data: { name: 'Flat Import Dup Society', address: 'n/a' } });
      societyIds.push(society.id);

      await operatorAgent.post(`/api/v1/operator/societies/${society.id}/flats/import`).send({ csv: 'unitNo,maintenanceAmount\nB-1,1000\nB-1,2000\n' }).expect(400);

      const flatsAfter = await prisma.flat.findMany({ where: { societyId: society.id } });
      expect(flatsAfter).toHaveLength(0);
    });

    it('rejects a file with any malformed row, atomically — including rows after the bad one', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const society = await prisma.society.create({ data: { name: 'Flat Import Bad Row Society', address: 'n/a' } });
      societyIds.push(society.id);

      // Seed one good row first, via its own import.
      await operatorAgent.post(`/api/v1/operator/societies/${society.id}/flats/import`).send({ csv: 'unitNo,maintenanceAmount\nC-1,1000\n' }).expect(201);

      const badRes = await operatorAgent
        .post(`/api/v1/operator/societies/${society.id}/flats/import`)
        .send({ csv: 'unitNo,maintenanceAmount\nC-2,not-a-number\nC-3,500\n' })
        .expect(400);
      expect((badRes.body as { message?: { errors?: string[] } }).message).toBeDefined();

      // C-3 was well-formed but never written — the whole file was atomic.
      const flatsAfter = await prisma.flat.findMany({ where: { societyId: society.id } });
      expect(flatsAfter).toHaveLength(1);
      expect(flatsAfter[0].unitNo).toBe('C-1');
    });

    it('a resident cannot import flats', async () => {
      const residentAgent = await residentAgentFixture();
      await residentAgent.post(`/api/v1/operator/societies/${homeSocietyId}/flats/import`).send({ csv: 'unitNo,maintenanceAmount\nZ-1,1000\n' }).expect(403);
    });
  });
});
