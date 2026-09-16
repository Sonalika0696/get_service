import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, RatificationStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.3 committee ratification queue — BACKEND_PLAN.md Phase 6.3 item
 * 5; DECISIONS_V2_SCOPE.md §7.3, SDD §5.3 phantom-resident threat.
 *
 * Every OTHER e2e suite's signupAndLogin-style fixture helper ratifies
 * directly via Prisma (see e.g. vendors.e2e-spec.ts) — this suite is the
 * one place the gate itself is exercised end to end: a self-registered
 * account is provably blocked while PENDING, ratification unblocks it,
 * rejection keeps it out, and only a COMMITTEE/TREASURER officer may
 * decide either way.
 */

class CapturingSms {
  sent: SendSmsInput[] = [];
  async send(input: SendSmsInput): Promise<SmsSendResult> {
    this.sent.push(input);
    return { id: `test_${randomUUID()}`, status: 'stub_logged' };
  }
}

function extractOtpFromSms(sms: SendSmsInput): string {
  const match = sms.body.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured SMS: ${sms.body}`);
  return match[1];
}

describe('Committee ratification queue — Phase 6.3 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sms: CapturingSms;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  let otherFlatId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    sms = new CapturingSms();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue(sms)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);

    const society = await prisma.society.create({ data: { name: 'Ratification Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 6; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `RAT-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }

    const otherSociety = await prisma.society.create({ data: { name: 'Ratification Test Society (other)', address: 'n/a' } });
    otherSocietyId = otherSociety.id;
    const otherFlat = await prisma.flat.create({ data: { societyId: otherSocietyId, unitNo: `RATO-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    otherFlatId = otherFlat.id;
  });

  afterAll(async () => {
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

  /** Signs up and OTP-verifies a resident, WITHOUT ratifying — the account stays PENDING, exactly as a real self-registration would. */
  async function pendingResidentFixture(sId: string, flatId: string) {
    const phone = `+9195${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `pending-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Pending Resident', email, phone, societyId: sId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);

    const occupancy = await prisma.occupancy.findFirstOrThrow({ where: { userId } });
    expect(occupancy.ratificationStatus).toBe(RatificationStatus.PENDING);

    return { agent, userId, occupancyId: occupancy.id };
  }

  /** A resident whose occupancy is ratified directly (bootstrapping a committee/treasurer fixture — not the thing under test) and who holds `kind` in the given society. */
  async function officerAgentFixture(sId: string, flatId: string, kind: RoleKind) {
    const phone = `+9194${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `officer-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Officer', email, phone, societyId: sId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });
    await prisma.role.create({ data: { societyId: sId, userId, kind } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  /** A fully ratified resident with NO committee/treasurer role — the negative control for "only an officer may ratify". */
  async function plainResidentFixture(sId: string, flatId: string) {
    const phone = `+9193${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `plain-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Plain Resident', email, phone, societyId: sId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  it('a PENDING account is blocked from every authenticated resident route until a COMMITTEE officer ratifies it', async () => {
    const { agent, occupancyId } = await pendingResidentFixture(societyId, flatIds[0]);

    // Blocked at the guard (401) — same response an occupancy-less resident
    // has always gotten; there is no separate "pending" status leaked here.
    await agent.get('/api/v1/me').expect(401);
    await agent.get('/api/v1/jobs').expect(401);

    const { agent: committeeAgent } = await officerAgentFixture(societyId, flatIds[1], RoleKind.COMMITTEE);

    // The pending occupancy shows up in the queue.
    const queueRes = await committeeAgent.get(`/api/v1/society/${societyId}/ratifications`).expect(200);
    const queue = queueRes.body as { id: string }[];
    expect(queue.some((o) => o.id === occupancyId)).toBe(true);

    const ratifyRes = await committeeAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/ratify`).send({}).expect(201);
    expect((ratifyRes.body as { ratificationStatus: string }).ratificationStatus).toBe(RatificationStatus.RATIFIED);

    // The SAME session (no re-login) can now act.
    const meRes = await agent.get('/api/v1/me').expect(200);
    expect((meRes.body as { societyId: string }).societyId).toBe(societyId);

    // No longer in the pending queue.
    const queueAfter = await committeeAgent.get(`/api/v1/society/${societyId}/ratifications`).expect(200);
    expect((queueAfter.body as { id: string }[]).some((o) => o.id === occupancyId)).toBe(false);

    // Audit chain recorded the decision.
    const auditRows = await prisma.auditLog.findMany({ where: { societyId, action: 'RESIDENT_RATIFY', subjectId: occupancyId } });
    expect(auditRows).toHaveLength(1);
  });

  it('rejection keeps the account blocked, and requires a note', async () => {
    const { agent, occupancyId } = await pendingResidentFixture(societyId, flatIds[2]);
    const { agent: committeeAgent } = await officerAgentFixture(societyId, flatIds[3], RoleKind.COMMITTEE);

    // A note is required to reject.
    await committeeAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/reject`).send({}).expect(400);

    const rejectRes = await committeeAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/reject`).send({ note: 'Not on the flat register — could not verify' }).expect(201);
    expect((rejectRes.body as { ratificationStatus: string }).ratificationStatus).toBe(RatificationStatus.REJECTED);

    await agent.get('/api/v1/me').expect(401);

    // A decided occupancy cannot be re-decided.
    await committeeAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/ratify`).send({}).expect(409);
  });

  it('a TREASURER officer may also ratify (not COMMITTEE-only)', async () => {
    const { occupancyId } = await pendingResidentFixture(societyId, flatIds[4]);
    const { agent: treasurerAgent } = await officerAgentFixture(societyId, flatIds[5], RoleKind.TREASURER);

    await treasurerAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/ratify`).send({}).expect(201);
  });

  it('a resident with no committee/treasurer role gets 403, and a wrong-society officer is scoped out', async () => {
    const flatA = await prisma.flat.create({ data: { societyId, unitNo: `RAT-A-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const flatB = await prisma.flat.create({ data: { societyId, unitNo: `RAT-B-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const { occupancyId } = await pendingResidentFixture(societyId, flatA.id);
    const { agent: plainAgent } = await plainResidentFixture(societyId, flatB.id);

    await plainAgent.get(`/api/v1/society/${societyId}/ratifications`).expect(403);
    await plainAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/ratify`).send({}).expect(403);

    // A committee officer of a DIFFERENT society is scoped out by :sid, even with the right role kind.
    const { agent: otherCommitteeAgent } = await officerAgentFixture(otherSocietyId, otherFlatId, RoleKind.COMMITTEE);
    await otherCommitteeAgent.post(`/api/v1/society/${societyId}/ratifications/${occupancyId}/ratify`).send({}).expect(403);
  });
});
