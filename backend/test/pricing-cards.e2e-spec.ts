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
import { OccupancyRole, PrincipalKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 7.2 (BACKEND_PLAN.md Phase 7 items 2-5) Definition of Done,
 * end-to-end against real Postgres: a vendor publishes a pricing card,
 * revises it twice, and all three versions remain independently
 * retrievable with the right lines and version numbers, with the
 * superseded ones carrying `supersededAt`. Plus: a published card/line
 * rejects mutation (400), publishing writes an audit entry, a PER_VISIT
 * line is required to publish, and reader authz negatives (non-linked
 * resident / operator / wrong vendor) 403.
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

describe('Pricing cards — Phase 7.2 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  let otherSocietyId: string;
  let flatId: string;
  let otherFlatId: string;
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

    const society = await prisma.society.create({ data: { name: 'Pricing Test Society', address: 'n/a' } });
    societyId = society.id;
    const flat = await prisma.flat.create({ data: { societyId, unitNo: `PC-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatId = flat.id;

    const otherSociety = await prisma.society.create({ data: { name: 'Pricing Test Society (other)', address: 'n/a' } });
    otherSocietyId = otherSociety.id;
    const otherFlat = await prisma.flat.create({ data: { societyId: otherSocietyId, unitNo: `OPC-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    otherFlatId = otherFlat.id;
  });

  afterAll(async () => {
    await prisma.pricingLine.deleteMany({ where: { card: { vendorId: { in: vendorIds } } } });
    await prisma.pricingCard.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyId, otherSocietyId] } } });

    await app.close();
  });

  /** Creates a fresh Vendor row linked to `sId`, provisions + enrolls a VENDOR principal for it, and returns a logged-in cookie-jar agent plus the vendor id. */
  async function vendorAgentFixture(sId: string) {
    const vendor = await prisma.vendor.create({ data: { name: `Pricing Vendor ${randomUUID()}` } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId: sId } });

    const email = `pricing-vendor-${randomUUID()}@example.com`;
    const password = 'a reasonably long fixture password';
    const user = await prisma.user.create({
      data: { name: 'Pricing Vendor Officer', email, principalKind: PrincipalKind.VENDOR, vendorId: vendor.id },
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
    const email = `pricing-operator-${randomUUID()}@example.com`;
    const password = 'a reasonably long operator password';
    const user = await prisma.user.create({ data: { name: 'Pricing Operator', email, principalKind: PrincipalKind.OPERATOR } });
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

  /** Signs a brand-new resident up (email OTP) in the given society/flat, ratifies the occupancy directly, and returns a cookie-jar agent logged in as them. */
  async function residentAgentFixture(sId: string, fId: string) {
    const email = `pricing-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Pricing Resident ${email}`, email, societyId: sId, flatId: fId, role: OccupancyRole.TENANT })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = mailer.sent.filter((m) => m.to === email && m.subject === 'Your verification code').at(-1)!;
    const code = extractOtpFromEmail(otpMail);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return agent;
  }

  const nowIso = () => new Date().toISOString();

  it('a vendor cannot publish a card with no PER_VISIT line (400)', async () => {
    const { agent } = await vendorAgentFixture(societyId);
    const createRes = await agent.post('/api/v1/pricing-cards').send({ category: 'no-visit-line', gstRatePct: 18, effectiveFrom: nowIso() }).expect(201);
    const cardId = (createRes.body as { id: string }).id;

    await agent.post(`/api/v1/pricing-cards/${cardId}/lines`).send({ label: 'Hourly labour', basis: 'PER_HOUR', rate: 300 }).expect(201);

    await agent.post(`/api/v1/pricing-cards/${cardId}/publish`).expect(400);
  });

  it('publish -> revise -> revise: all three versions independently retrievable, superseded ones carry supersededAt, mutation on a published card 400s, publish writes an audit entry, and reader authz negatives 403', async () => {
    const { agent: vendorAgent, vendorId } = await vendorAgentFixture(societyId);

    // --- v1: create draft, add a PER_VISIT line (first-class, not implicit) + a PER_HOUR line, publish.
    const v1Res = await vendorAgent.post('/api/v1/pricing-cards').send({ category: 'plumbing', gstRatePct: 18, effectiveFrom: nowIso() }).expect(201);
    const v1 = v1Res.body as { id: string; version: number; status: string };
    expect(v1.version).toBe(1);
    expect(v1.status).toBe('DRAFT');

    await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/lines`).send({ label: 'Visit charge', basis: 'PER_VISIT', rate: 150 }).expect(201);
    const v1WithHourly = await vendorAgent
      .post(`/api/v1/pricing-cards/${v1.id}/lines`)
      .send({ label: 'Labour', basis: 'PER_HOUR', rate: 250, minimum: 500 })
      .expect(201);
    expect((v1WithHourly.body as { lines: unknown[] }).lines).toHaveLength(2);

    const v1Published = await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/publish`).expect(201);
    const v1PublishedBody = v1Published.body as { status: string; publishedAt: string | null; supersededAt: string | null };
    expect(v1PublishedBody.status).toBe('PUBLISHED');
    expect(v1PublishedBody.publishedAt).not.toBeNull();
    expect(v1PublishedBody.supersededAt).toBeNull();

    // Immutability: publishing a card makes it and its lines immutable — 400, not 200/403.
    await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/lines`).send({ label: 'Too late', basis: 'PER_UNIT', rate: 10 }).expect(400);
    const v1Lines = (v1Published.body as { lines: { id: string }[] }).lines;
    await vendorAgent.patch(`/api/v1/pricing-cards/${v1.id}/lines/${v1Lines[0].id}`).send({ rate: 999 }).expect(400);
    await vendorAgent.delete(`/api/v1/pricing-cards/${v1.id}/lines/${v1Lines[0].id}`).expect(400);
    await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/publish`).expect(400); // already published

    // Publishing writes a PRICING_CARD_PUBLISHED audit entry, scoped to the
    // vendor's oldest VendorSocietyLink (here, its only link: societyId).
    const auditRows = await prisma.auditLog.findMany({ where: { subjectId: v1.id, action: 'PRICING_CARD_PUBLISHED' } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].societyId).toBe(societyId);
    expect(auditRows[0].subjectType).toBe('PricingCard');

    // --- Reader authz: the vendor itself and a resident of the linked society can read the current published card; a resident of an UNLINKED society, and an OPERATOR, cannot.
    const currentRes = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(200);
    expect((currentRes.body as { version: number }).version).toBe(1);

    const linkedResident = await residentAgentFixture(societyId, flatId);
    const residentCurrentRes = await linkedResident.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(200);
    expect((residentCurrentRes.body as { version: number }).version).toBe(1);

    const unlinkedResident = await residentAgentFixture(otherSocietyId, otherFlatId);
    await unlinkedResident.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(403);

    const operatorAgent = await operatorAgentFixture();
    await operatorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(403);
    await operatorAgent.post('/api/v1/pricing-cards').send({ category: 'plumbing', gstRatePct: 18, effectiveFrom: nowIso() }).expect(403);

    // A DIFFERENT vendor cannot read this vendor's cards through the public endpoint either.
    const { agent: otherVendorAgent } = await vendorAgentFixture(societyId);
    await otherVendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(403);
    // ...nor reach this vendor's draft-management surface by id.
    await otherVendorAgent.get(`/api/v1/pricing-cards/${v1.id}`).expect(404);

    // --- Revise to v2: only the vendor's own CURRENT published card can be revised.
    const v2Res = await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/revise`).send({ gstRatePct: 12, effectiveFrom: nowIso() }).expect(201);
    const v2 = v2Res.body as { id: string; version: number; status: string; lines: { basis: string }[] };
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('DRAFT');
    // Revision starts as a copy of the previous card's lines.
    expect(v2.lines.map((l) => l.basis).sort()).toEqual(['PER_HOUR', 'PER_VISIT']);

    // Cannot revise v1 again while v2 is pending, and cannot revise a DRAFT.
    await vendorAgent.post(`/api/v1/pricing-cards/${v1.id}/revise`).send({ gstRatePct: 12, effectiveFrom: nowIso() }).expect(400);
    await vendorAgent.post(`/api/v1/pricing-cards/${v2.id}/revise`).send({ gstRatePct: 12, effectiveFrom: nowIso() }).expect(400);

    await vendorAgent.post(`/api/v1/pricing-cards/${v2.id}/publish`).expect(201);

    // v1 is now superseded; v2 is current.
    const v1AfterSupersede = await vendorAgent.get(`/api/v1/pricing-cards/${v1.id}`).expect(200);
    expect((v1AfterSupersede.body as { supersededAt: string | null }).supersededAt).not.toBeNull();

    const currentAfterV2 = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(200);
    expect((currentAfterV2.body as { version: number }).version).toBe(2);

    // --- Revise to v3.
    const v3Res = await vendorAgent.post(`/api/v1/pricing-cards/${v2.id}/revise`).send({ gstRatePct: 5, effectiveFrom: nowIso() }).expect(201);
    const v3 = v3Res.body as { id: string; version: number };
    expect(v3.version).toBe(3);
    await vendorAgent.post(`/api/v1/pricing-cards/${v3.id}/publish`).expect(201);

    // --- DoD: all three versions independently retrievable, with the right lines/version numbers, superseded ones carrying supersededAt.
    const version1 = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/versions/1`).expect(200);
    const v1Body = version1.body as { version: number; status: string; supersededAt: string | null; gstRatePct: string | number; lines: unknown[] };
    expect(v1Body.version).toBe(1);
    expect(v1Body.status).toBe('PUBLISHED');
    expect(v1Body.supersededAt).not.toBeNull();
    expect(v1Body.lines).toHaveLength(2);

    const version2 = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/versions/2`).expect(200);
    const v2Body = version2.body as { version: number; status: string; supersededAt: string | null; lines: unknown[] };
    expect(v2Body.version).toBe(2);
    expect(v2Body.status).toBe('PUBLISHED');
    expect(v2Body.supersededAt).not.toBeNull();
    expect(v2Body.lines).toHaveLength(2);

    const version3 = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/versions/3`).expect(200);
    const v3Body = version3.body as { version: number; status: string; supersededAt: string | null; lines: unknown[] };
    expect(v3Body.version).toBe(3);
    expect(v3Body.status).toBe('PUBLISHED');
    expect(v3Body.supersededAt).toBeNull();
    expect(v3Body.lines).toHaveLength(2);

    // Current always resolves to the latest, non-superseded one.
    const finalCurrent = await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/current`).expect(200);
    expect((finalCurrent.body as { version: number }).version).toBe(3);

    // A non-existent version 4 is a clean 404, not an error.
    await vendorAgent.get(`/api/v1/pricing-cards/vendors/${vendorId}/categories/plumbing/versions/4`).expect(404);

    // Two audit entries now exist for this category's publishes (v1, v2) plus v3 = 3 total.
    const allPublishAudits = await prisma.auditLog.findMany({ where: { societyId, action: 'PRICING_CARD_PUBLISHED', subjectId: { in: [v1.id, v2.id, v3.id] } } });
    expect(allPublishAudits).toHaveLength(3);
  });
});
