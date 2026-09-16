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
import { OccupancyRole, PrincipalKind, RatificationStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.3 committee-scoped society management — BACKEND_PLAN.md Phase
 * 6.3 items 4, 6, 7, 8: occupancy move-in/move-out (and the "one active
 * occupancy" invariant), role assignment, Delegation and ConsentGrant.
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

describe('Society management — Phase 6.3 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let sms: CapturingSms;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const societyIds: string[] = [];
  const vendorIds: string[] = [];

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

    const society = await prisma.society.create({ data: { name: 'Society Mgmt Test Society', address: 'n/a' } });
    societyId = society.id;
    societyIds.push(societyId);
    for (let i = 0; i < 10; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `SM-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }

    const otherSociety = await prisma.society.create({ data: { name: 'Society Mgmt Test Society (other)', address: 'n/a' } });
    otherSocietyId = otherSociety.id;
    societyIds.push(otherSocietyId);
  });

  afterAll(async () => {
    await prisma.consentGrant.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { granteeUserId: { in: userIds } }] } });
    await prisma.delegation.deleteMany({ where: { delegateUserId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  /** Bootstraps a ratified COMMITTEE fixture — the queue/role-assignment routes under test all require one to call them at all. */
  async function committeeAgentFixture(sId: string, flatId: string) {
    const phone = `+9191${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `committee-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Committee Officer', email, phone, societyId: sId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });
    await prisma.role.create({ data: { societyId: sId, userId, kind: RoleKind.COMMITTEE } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  async function residentFixture(sId: string, flatId: string) {
    const phone = `+9190${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Resident', email, phone, societyId: sId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    const occupancy = await prisma.occupancy.findFirstOrThrow({ where: { userId } });
    return { agent, userId, occupancyId: occupancy.id };
  }

  async function vendorAgentFixture(sId: string) {
    const vendor = await prisma.vendor.create({ data: { societyId: sId, name: `Society Mgmt Vendor ${randomUUID()}` } });
    vendorIds.push(vendor.id);

    const email = `vendor-officer-${randomUUID()}@example.com`;
    const password = 'a vendor officer passphrase';
    const user = await prisma.user.create({ data: { name: 'Vendor Officer', email, principalKind: PrincipalKind.VENDOR, vendorId: vendor.id } });
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
    return { agent, userId: user.id, vendorId: vendor.id };
  }

  describe('occupancy move-in / move-out', () => {
    it('a committee member moves a new resident in (RATIFIED immediately, no queue), and a plain resident is 403d', async () => {
      const { agent: committeeAgent } = await committeeAgentFixture(societyId, flatIds[0]);
      const { agent: plainResidentAgent } = await residentFixture(societyId, flatIds[1]);

      const flat = await prisma.flat.create({ data: { societyId, unitNo: `SM-MI-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      const email = `moved-in-${randomUUID()}@example.com`;

      await plainResidentAgent.post(`/api/v1/society/${societyId}/occupancies`).send({ flatId: flat.id, role: OccupancyRole.TENANT, name: 'Moved In Resident', email }).expect(403);

      const moveInRes = await committeeAgent.post(`/api/v1/society/${societyId}/occupancies`).send({ flatId: flat.id, role: OccupancyRole.TENANT, name: 'Moved In Resident', email }).expect(201);
      const occupancy = moveInRes.body as { id: string; userId: string; ratificationStatus: string };
      userIds.push(occupancy.userId);
      expect(occupancy.ratificationStatus).toBe(RatificationStatus.RATIFIED);

      const auditRows = await prisma.auditLog.findMany({ where: { societyId, action: 'OCCUPANCY_MOVE_IN', subjectId: occupancy.id } });
      expect(auditRows).toHaveLength(1);
    });

    it('rejects moving a user in who already has an active occupancy elsewhere (one active occupancy per user)', async () => {
      const { agent: committeeAgent, userId: committeeUserId } = await committeeAgentFixture(societyId, flatIds[2]);
      const anotherFlat = await prisma.flat.create({ data: { societyId, unitNo: `SM-DUP-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });

      // The committee officer themself already has an active occupancy (flatIds[2]) — moving them into a second flat is rejected.
      await committeeAgent.post(`/api/v1/society/${societyId}/occupancies`).send({ flatId: anotherFlat.id, role: OccupancyRole.TENANT, userId: committeeUserId }).expect(409);
    });

    it('move-out ends tenure and revokes any active delegation from that occupancy', async () => {
      const { agent: committeeAgent } = await committeeAgentFixture(societyId, flatIds[3]);
      const owner = await residentFixture(societyId, flatIds[4]);
      const delegate = await residentFixture(societyId, flatIds[5]);

      const delegationRes = await owner.agent
        .post('/api/v1/me/delegations')
        .send({ occupancyId: owner.occupancyId, delegateUserId: delegate.userId, scope: 'SERVICE_REQUESTS' })
        .expect(201);
      const delegationId = (delegationRes.body as { id: string }).id;
      expect((delegationRes.body as { revokedAt: string | null }).revokedAt).toBeNull();

      await committeeAgent.post(`/api/v1/society/${societyId}/occupancies/${owner.occupancyId}/move-out`).expect(201);

      const occupancyAfter = await prisma.occupancy.findUniqueOrThrow({ where: { id: owner.occupancyId } });
      expect(occupancyAfter.tenureEndedAt).not.toBeNull();

      const delegationAfter = await prisma.delegation.findUniqueOrThrow({ where: { id: delegationId } });
      expect(delegationAfter.revokedAt).not.toBeNull();

      // Moving out twice is rejected, not silently repeated.
      await committeeAgent.post(`/api/v1/society/${societyId}/occupancies/${owner.occupancyId}/move-out`).expect(409);
    });
  });

  describe('role assignment', () => {
    it('a committee member assigns and revokes roles; duplicate assignment and non-member assignment are rejected', async () => {
      const { agent: committeeAgent } = await committeeAgentFixture(societyId, flatIds[6]);
      const { userId: targetUserId } = await residentFixture(societyId, flatIds[7]);

      const assignRes = await committeeAgent.post(`/api/v1/society/${societyId}/roles`).send({ userId: targetUserId, kind: RoleKind.TREASURER }).expect(201);
      const role = assignRes.body as { id: string; kind: string };
      expect(role.kind).toBe(RoleKind.TREASURER);

      const auditRows = await prisma.auditLog.findMany({ where: { societyId, action: 'ROLE_GRANT', subjectId: role.id } });
      expect(auditRows).toHaveLength(1);

      // Duplicate (same society, user, kind) is rejected.
      await committeeAgent.post(`/api/v1/society/${societyId}/roles`).send({ userId: targetUserId, kind: RoleKind.TREASURER }).expect(409);

      // A DIFFERENT kind for the same user is fine — DEPUTY_TREASURER stacks with TREASURER.
      await committeeAgent.post(`/api/v1/society/${societyId}/roles`).send({ userId: targetUserId, kind: RoleKind.DEPUTY_TREASURER }).expect(201);

      // A user with no ratified occupancy in this society cannot be assigned a role.
      const strangerId = randomUUID(); // not a real user at all
      await committeeAgent.post(`/api/v1/society/${societyId}/roles`).send({ userId: strangerId, kind: RoleKind.COMMITTEE }).expect(404);

      await committeeAgent.delete(`/api/v1/society/${societyId}/roles/${role.id}`).expect(204);
      const rolesAfter = await prisma.role.findMany({ where: { societyId, userId: targetUserId } });
      expect(rolesAfter.some((r) => r.kind === RoleKind.TREASURER)).toBe(false);
    });

    it('a plain resident cannot assign roles', async () => {
      const { agent: residentAgent } = await residentFixture(societyId, flatIds[9]);
      const { userId: targetUserId } = await residentFixture(societyId, flatIds[8]);
      await residentAgent.post(`/api/v1/society/${societyId}/roles`).send({ userId: targetUserId, kind: RoleKind.COMMITTEE }).expect(403);
    });
  });

  describe('Delegation', () => {
    it('a resident delegates an operational scope to another resident in the same society, and the DTO structurally rejects a non-existent (e.g. money/vote-shaped) scope', async () => {
      const owner = await residentFixture(societyId, flatIds[0]);
      const delegate = await residentFixture(societyId, flatIds[1]);

      const grantRes = await owner.agent
        .post('/api/v1/me/delegations')
        .send({ occupancyId: owner.occupancyId, delegateUserId: delegate.userId, scope: 'SERVICE_REQUESTS' })
        .expect(201);
      const delegation = grantRes.body as { id: string; scope: string };
      expect(delegation.scope).toBe('SERVICE_REQUESTS');

      // Duplicate active grant for the same (occupancy, delegate, scope) is rejected.
      await owner.agent.post('/api/v1/me/delegations').send({ occupancyId: owner.occupancyId, delegateUserId: delegate.userId, scope: 'SERVICE_REQUESTS' }).expect(409);

      // A scope string that isn't in DelegationScope (money/vote-shaped or otherwise) is rejected by the DTO itself — the runtime companion to the type-level exclusion (see delegation-scope.spec.ts).
      await owner.agent.post('/api/v1/me/delegations').send({ occupancyId: owner.occupancyId, delegateUserId: delegate.userId, scope: 'PAYOUT_AUTHORISE' }).expect(400);

      const receivedRes = await delegate.agent.get('/api/v1/me/delegations/received').expect(200);
      expect((receivedRes.body as { id: string }[]).some((d) => d.id === delegation.id)).toBe(true);

      const revokeRes = await owner.agent.delete(`/api/v1/me/delegations/${delegation.id}`).expect(200);
      expect((revokeRes.body as { revokedAt: string | null }).revokedAt).not.toBeNull();

      // Revoking again is idempotent, not an error.
      await owner.agent.delete(`/api/v1/me/delegations/${delegation.id}`).expect(200);
    });

    it('cannot delegate from an occupancy that is not your own', async () => {
      const owner = await residentFixture(societyId, flatIds[2]);
      const stranger = await residentFixture(societyId, flatIds[3]);
      const delegate = await residentFixture(societyId, flatIds[4]);

      await stranger.agent.post('/api/v1/me/delegations').send({ occupancyId: owner.occupancyId, delegateUserId: delegate.userId, scope: 'EVENT_OPT_IN' }).expect(404);
    });
  });

  describe('ConsentGrant — enforced at query time', () => {
    it('a vendor cannot see a resident contact without consent (query returns nothing, not a filtered field); consent grants and revokes control it live', async () => {
      const resident = await residentFixture(societyId, flatIds[5]);
      const { agent: vendorAgent, userId: vendorUserId } = await vendorAgentFixture(societyId);

      // No consent yet — denied at the query, not merely with fields stripped.
      const beforeRes = await vendorAgent.get(`/api/v1/vendors/residents/${resident.userId}/contact`).expect(404);
      expect(beforeRes.body).not.toHaveProperty('phone');

      const consentRes = await resident.agent.post('/api/v1/me/consents').send({ granteeUserId: vendorUserId, purpose: 'CONTACT_INFO' }).expect(201);
      const consentId = (consentRes.body as { id: string }).id;

      const afterGrantRes = await vendorAgent.get(`/api/v1/vendors/residents/${resident.userId}/contact`).expect(200);
      expect((afterGrantRes.body as { id: string }).id).toBe(resident.userId);

      // A DIFFERENT vendor (no consent from this resident) is still denied.
      const { agent: otherVendorAgent } = await vendorAgentFixture(societyId);
      await otherVendorAgent.get(`/api/v1/vendors/residents/${resident.userId}/contact`).expect(404);

      // Revocation is immediate: the very next query denies.
      await resident.agent.delete(`/api/v1/me/consents/${consentId}`).expect(200);
      await vendorAgent.get(`/api/v1/vendors/residents/${resident.userId}/contact`).expect(404);

      const auditRows = await prisma.auditLog.findMany({ where: { societyId, action: { in: ['CONSENT_GRANT', 'CONSENT_REVOKE'] }, subjectId: consentId } });
      expect(auditRows.map((r) => r.action).sort()).toEqual(['CONSENT_GRANT', 'CONSENT_REVOKE']);
    });

    it('a vendor from a DIFFERENT society cannot see contact info even with a consent grant naming them, because the resident is scoped out', async () => {
      const resident = await residentFixture(societyId, flatIds[6]);
      const { agent: crossSocietyVendorAgent, userId: crossVendorUserId } = await vendorAgentFixture(otherSocietyId);

      await resident.agent.post('/api/v1/me/consents').send({ granteeUserId: crossVendorUserId, purpose: 'CONTACT_INFO' }).expect(201);

      await crossSocietyVendorAgent.get(`/api/v1/vendors/residents/${resident.userId}/contact`).expect(404);
    });
  });
});
