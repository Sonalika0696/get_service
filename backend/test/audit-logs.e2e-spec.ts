import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Lane b1read — `GET /audit/logs` and `GET /audit/logs/:sequence`. `GET
 * /audit/verify` is asserted UNCHANGED (still 200 for a plain resident) at
 * the end, per the brief.
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

interface AuditLogEntryBody {
  sequence: number;
  action: string;
  subjectType: string;
  subjectId: string;
  actorId: string | null;
  previousHash: string;
  entryHash: string;
}

interface AuditLogsPageBody {
  items: AuditLogEntryBody[];
  nextCursor: string | null;
}

describe('Audit log browsing — GET /audit/logs, /audit/logs/:sequence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let auditService: AuditService;
  let mailer: CapturingMailer;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(sId: string, email: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId: sId, flatId, role })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(sId: string, userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId: sId, userId, kind } });
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);

    const society = await prisma.society.create({ data: { name: 'Audit Logs Test Society', address: 'n/a' } });
    societyId = society.id;
    const otherSociety = await prisma.society.create({ data: { name: 'Audit Logs Other Society', address: 'n/a' } });
    otherSocietyId = otherSociety.id;

    const flat = await prisma.flat.create({ data: { societyId, unitNo: `AL-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatIds.push(flat.id);
    const otherFlat = await prisma.flat.create({ data: { societyId: otherSocietyId, unitNo: `AL-OTHER-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatIds.push(otherFlat.id);
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

  it('a plain resident gets 403 on /audit/logs but 200 on /audit/verify', async () => {
    const resident = await signupAndLogin(societyId, `al-plain-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.get('/api/v1/audit/logs').expect(403);
    await resident.agent.get('/api/v1/audit/verify').expect(200);
  });

  it('HEADLINE: pages through appended entries, filters narrow correctly, another society never returns, ETag 304s', async () => {
    const officer = await signupAndLogin(societyId, `al-officer-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(societyId, officer.userId, RoleKind.TREASURER);

    const otherOfficer = await signupAndLogin(otherSocietyId, `al-otherofficer-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(otherSocietyId, otherOfficer.userId, RoleKind.TREASURER);

    // Append 3 entries in this society (two of the same action, one different) and 1 in the other society.
    await auditService.append({ societyId, actorId: officer.userId, action: 'TEST_ACTION_ONE', subjectType: 'TestSubject', subjectId: 'subj-1', payload: { n: 1 } });
    await auditService.append({ societyId, actorId: officer.userId, action: 'TEST_ACTION_TWO', subjectType: 'TestSubject', subjectId: 'subj-2', payload: { n: 2 } });
    await auditService.append({ societyId, actorId: officer.userId, action: 'TEST_ACTION_ONE', subjectType: 'TestSubject', subjectId: 'subj-3', payload: { n: 3 } });
    await auditService.append({ societyId: otherSocietyId, actorId: otherOfficer.userId, action: 'TEST_ACTION_ONE', subjectType: 'TestSubject', subjectId: 'subj-other', payload: { n: 99 } });

    // --- Page through with a small limit ---
    const page1 = (await officer.agent.get('/api/v1/audit/logs?limit=2').expect(200)).body as AuditLogsPageBody;
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();
    // Newest first (sequence desc).
    expect(page1.items[0].sequence).toBeGreaterThan(page1.items[1].sequence);
    // Hashes are hex-encoded strings.
    expect(page1.items[0].entryHash).toMatch(/^[0-9a-f]+$/);
    expect(page1.items[0].previousHash).toMatch(/^[0-9a-f]+$/);

    const page2 = (await officer.agent.get(`/api/v1/audit/logs?limit=2&cursor=${page1.nextCursor}`).expect(200)).body as AuditLogsPageBody;
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    const page1Sequences = new Set(page1.items.map((i) => i.sequence));
    expect(page2.items.every((i) => !page1Sequences.has(i.sequence))).toBe(true);

    // --- Every entry in this society is only ever from this society ---
    const all = (await officer.agent.get('/api/v1/audit/logs?limit=100').expect(200)).body as AuditLogsPageBody;
    expect(all.items.some((i) => i.subjectId === 'subj-other')).toBe(false);
    expect(all.items.filter((i) => i.subjectId.startsWith('subj-')).length).toBe(3);

    // --- Filters narrow correctly ---
    const filtered = (await officer.agent.get('/api/v1/audit/logs?action=TEST_ACTION_ONE&limit=100').expect(200)).body as AuditLogsPageBody;
    const oursFiltered = filtered.items.filter((i) => i.subjectId === 'subj-1' || i.subjectId === 'subj-3');
    expect(oursFiltered.length).toBe(2);
    expect(filtered.items.every((i) => i.action === 'TEST_ACTION_ONE')).toBe(true);

    const bySubject = (await officer.agent.get('/api/v1/audit/logs?subjectId=subj-2&limit=100').expect(200)).body as AuditLogsPageBody;
    expect(bySubject.items.map((i) => i.subjectId)).toEqual(['subj-2']);

    // --- Single-entry route, society-scoped: another society's sequence 404s ---
    const ourEntrySequence = all.items[0].sequence;
    const ourEntry = (await officer.agent.get(`/api/v1/audit/logs/${ourEntrySequence}`).expect(200)).body as AuditLogEntryBody;
    expect(ourEntry.sequence).toBe(ourEntrySequence);

    const otherAll = (await otherOfficer.agent.get('/api/v1/audit/logs?limit=100').expect(200)).body as AuditLogsPageBody;
    const otherSequence = otherAll.items.find((i) => i.subjectId === 'subj-other')!.sequence;
    await officer.agent.get(`/api/v1/audit/logs/${otherSequence}`).expect(404);

    // --- ETag 304 ---
    const first = await officer.agent.get('/api/v1/audit/logs?limit=100').expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    await officer.agent.get('/api/v1/audit/logs?limit=100').set('If-None-Match', etag).expect(304);

    // --- /audit/verify is unchanged ---
    await officer.agent.get('/api/v1/audit/verify').expect(200);
  });
});
