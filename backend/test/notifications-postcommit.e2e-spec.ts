import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, ServiceRequestStatus, ServiceRequestType, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * BACKEND_PLAN.md Phase 6.5 (rework — supervisor suggestion): notification
 * dispatch must be post-commit and best-effort, never able to reverse a
 * committed state change. PollsService.join()/processExpired() now only
 * READ inside the $transaction (collectRecipients) and dispatch mail
 * afterwards (dispatchNotifications), wrapped in try/catch.
 *
 * This spec proves the guarantee end-to-end: with a MailerService stub that
 * throws specifically for the poll-fired/poll-expired subjects, a poll
 * still transitions to FIRED / EXPIRED and that transition is durably
 * committed (re-read via a fresh Prisma query after the HTTP call
 * returns) — a mail outage never rolls back or hides the state change.
 * OTP mail (subject "Your verification code") is left untouched so
 * signup/login — unrelated to this guarantee — keeps working.
 */

const FAILING_SUBJECTS = new Set(['Poll fired — enough residents joined', 'Poll expired — not enough commitments']);

class PartlyFailingMailer {
  sent: SendMailInput[] = [];
  attempts: SendMailInput[] = [];

  async send(input: SendMailInput): Promise<void> {
    this.attempts.push(input);
    if (FAILING_SUBJECTS.has(input.subject)) {
      throw new Error(`Simulated mail-provider outage for subject "${input.subject}"`);
    }
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

interface PollDetailBody {
  id: string;
  status: ServiceRequestStatus;
  pollType: ServiceRequestType;
  creatorId: string;
  commitmentCount: number;
  hasJoined: boolean;
}

describe('Notification dispatch is post-commit and best-effort (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: PartlyFailingMailer;

  const societyIds: string[] = [];
  const flatIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function newSociety(): Promise<string> {
    const society = await prisma.society.create({ data: { name: `Postcommit Test Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyIds.push(society.id);
    return society.id;
  }

  async function makeFlat(societyId: string): Promise<string> {
    const flat = await prisma.flat.create({
      data: { societyId, unitNo: `P-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
    });
    flatIds.push(flat.id);
    return flat.id;
  }

  async function signupAndLogin(email: string, societyId: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId, flatId, role })
      .expect(201);

    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);

    // Phase 6.3 ratification gate: a self-registered occupancy starts PENDING
    // and can't authenticate until ratified. This fixture isn't testing the
    // gate itself, so ratify directly via Prisma — matching the convention in
    // ledger.e2e-spec.ts and every other suite.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    return { userId, agent, email };
  }

  async function makeCommittee(societyId: string, userId: string) {
    await prisma.role.create({ data: { societyId, userId, kind: RoleKind.COMMITTEE } });
  }

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
  }

  beforeAll(async () => {
    mailer = new PartlyFailingMailer();
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
  });

  afterAll(async () => {
    await prisma.participation.deleteMany({ where: { serviceRequest: { societyId: { in: societyIds } } } });
    await prisma.serviceRequest.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  it('a poll still ends up FIRED and committed even though the "poll fired" mail throws for every recipient', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const flatB = await makeFlat(societyId);
    const flatC = await makeFlat(societyId);

    const creator = await signupAndLogin(`postcommit-fire-creator-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    const joinerOne = await signupAndLogin(`postcommit-fire-joiner1-${randomUUID()}@example.com`, societyId, flatB, OccupancyRole.TENANT);
    const joinerTwo = await signupAndLogin(`postcommit-fire-joiner2-${randomUUID()}@example.com`, societyId, flatC, OccupancyRole.OWNER_OCCUPIER);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: ServiceRequestType.EVENT, title: 'Mail-outage picnic', minCommitments: 2, closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const poll = createRes.body as PollDetailBody;
    expect(poll.status).toBe(ServiceRequestStatus.OPEN);

    await joinerOne.agent.post(`/api/v1/polls/${poll.id}/join`).expect(201);

    // This join() crosses minCommitments, so PollsService fires the poll and
    // then tries to dispatch "Poll fired" mail to both committed residents —
    // both of those sends throw (simulated outage). The HTTP call must still
    // succeed (201) with status FIRED in the response body: the mailer
    // failure is caught inside dispatchNotifications and never surfaces as
    // a request failure or an unfired poll.
    const afterSecondJoin = await joinerTwo.agent.post(`/api/v1/polls/${poll.id}/join`).expect(201);
    const firedBody = afterSecondJoin.body as PollDetailBody;
    expect(firedBody.status).toBe(ServiceRequestStatus.FIRED);
    expect(firedBody.commitmentCount).toBe(2);

    // Prove durability: re-read the poll and its commitments straight from
    // Postgres via a fresh query, independent of the HTTP response, after
    // the request has already returned. If the mail failure had rolled back
    // (or otherwise reversed) the transaction, this would show OPEN and/or
    // be missing a commitment row.
    const persisted = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: poll.id } });
    expect(persisted.status).toBe(ServiceRequestStatus.FIRED);
    expect(persisted.firedAt).not.toBeNull();

    const persistedCommitments = await prisma.participation.count({ where: { serviceRequestId: poll.id } });
    expect(persistedCommitments).toBe(2);

    // The mailer really was invoked (and really did throw) for both
    // recipients — this isn't passing merely because notifications were
    // skipped entirely.
    const attemptedFireMails = mailer.attempts.filter((m) => m.subject === 'Poll fired — enough residents joined');
    expect(attemptedFireMails.map((m) => m.to).sort()).toEqual([joinerOne.email, joinerTwo.email].sort());
    // And none of them landed in `sent`, since every attempt threw.
    expect(mailer.sent.some((m) => m.subject === 'Poll fired — enough residents joined')).toBe(false);
  });

  it('a poll still ends up EXPIRED and committed even though the "poll expired" mail throws', async () => {
    const societyId = await newSociety();
    const committeeFlat = await makeFlat(societyId);
    const creatorFlat = await makeFlat(societyId);
    const joinerFlat = await makeFlat(societyId);

    const committee = await signupAndLogin(`postcommit-expire-committee-${randomUUID()}@example.com`, societyId, committeeFlat, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);
    const creator = await signupAndLogin(`postcommit-expire-creator-${randomUUID()}@example.com`, societyId, creatorFlat, OccupancyRole.OWNER_OCCUPIER);
    const joiner = await signupAndLogin(`postcommit-expire-joiner-${randomUUID()}@example.com`, societyId, joinerFlat, OccupancyRole.TENANT);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: ServiceRequestType.EVENT, title: 'Mail-outage rooftop garden', minCommitments: 3, closesAt: futureIso(5 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await joiner.agent.post(`/api/v1/polls/${pollId}/join`).expect(201);

    await prisma.serviceRequest.update({ where: { id: pollId }, data: { closesAt: new Date(Date.now() - 60 * 1000) } });

    // process-expired must still report the poll resolved (201, resolved
    // >= 1) even though the "poll expired" mail throws for the committed
    // joiner.
    const processRes = await committee.agent.post('/api/v1/polls/process-expired').expect(201);
    expect((processRes.body as { resolved: number }).resolved).toBeGreaterThanOrEqual(1);

    const persisted = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: pollId } });
    expect(persisted.status).toBe(ServiceRequestStatus.EXPIRED);
    expect(persisted.closedAt).not.toBeNull();

    const attemptedExpiredMails = mailer.attempts.filter((m) => m.subject === 'Poll expired — not enough commitments' && m.to === joiner.email);
    expect(attemptedExpiredMails.length).toBeGreaterThanOrEqual(1);
    expect(mailer.sent.some((m) => m.subject === 'Poll expired — not enough commitments' && m.to === joiner.email)).toBe(false);
  });
});
