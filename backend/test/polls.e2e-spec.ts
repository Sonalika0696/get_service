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
import { OccupancyRole, PollStatus, PollType, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 3 (poll engine) Definition of Done, end-to-end against real
 * Postgres, as reduced by the V2.0 scope revision:
 *  - No resident voting (SDD invariant I8): the ADVISORY and BINDING poll
 *    types are rejected at validation, and POST /polls/:id/vote does not
 *    exist.
 *  - EVENT auto-fire: joining (PollCommitment) flips the poll to FIRED the
 *    moment minCommitments is reached, synchronously, and emails every
 *    committed resident.
 *  - Close early: only the creator may close an OPEN poll; it becomes CLOSED.
 *  - Expiry: an OPEN EVENT poll whose closesAt has passed and which never
 *    reached minCommitments is resolved to EXPIRED by
 *    POST /polls/process-expired (the stand-in for a future scheduler).
 *
 * Expiry approach: CreatePollDto requires closesAt to be strictly in the
 * future (see PollsService.create), so there's no way to create an
 * already-expired poll through the API. The test instead creates a poll
 * with a near-future closesAt, then pushes that one row's closesAt into the
 * past via Prisma, and drives resolution explicitly via
 * POST /polls/process-expired (committee-only).
 *
 * Each `it` creates its own fresh society, so residents signed up by one
 * test never leak into another.
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

interface PollDetailBody {
  id: string;
  status: PollStatus;
  pollType: PollType;
  creatorId: string;
  commitmentCount: number;
  hasJoined: boolean;
}

describe('Polls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

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
    const society = await prisma.society.create({ data: { name: `Polls Test Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
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

  /** Signs a brand-new resident up in the given society/flat, verifies their OTP, and returns a cookie-jar agent logged in as them. */
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

  async function makeCommittee(societyId: string, userId: string) {
    await prisma.role.create({ data: { societyId, userId, kind: RoleKind.COMMITTEE } });
  }

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
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
    expect(app.get(AppConfigService).env.SESSION_COOKIE_NAME).toBeTruthy();
  });

  afterAll(async () => {
    // FK-respecting cleanup, children before parents.
    await prisma.pollCommitment.deleteMany({ where: { poll: { societyId: { in: societyIds } } } });
    await prisma.poll.deleteMany({ where: { societyId: { in: societyIds } } });
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

  it('has no resident voting surface: ADVISORY/BINDING poll types are rejected and the vote route does not exist (invariant I8)', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const committee = await signupAndLogin(`poll-novote-committee-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);

    // Even a committee member cannot create a voting poll — the types no longer exist.
    for (const pollType of ['ADVISORY', 'BINDING']) {
      await committee.agent.post('/api/v1/polls').send({ pollType, title: 'Repaint the gate?', closesAt: futureIso(60 * 60 * 1000) }).expect(400);
    }

    const createRes = await committee.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.EVENT, title: 'Diwali dinner', minCommitments: 2, closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await committee.agent.post(`/api/v1/polls/${pollId}/vote`).send({ choice: 'YES' }).expect(404);

    // No tally or vote fields leak into the response shape.
    const getRes = await committee.agent.get(`/api/v1/polls/${pollId}`).expect(200);
    const body = getRes.body as Record<string, unknown>;
    for (const removedField of ['tally', 'hasVoted', 'weightMode', 'quorumPct', 'passingPct', 'resolvedAt']) {
      expect(body).not.toHaveProperty(removedField);
    }
  });

  it('EVENT poll auto-fires the moment minCommitments is reached, and notifies every committed resident', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const flatB = await makeFlat(societyId);
    const flatC = await makeFlat(societyId);

    const creator = await signupAndLogin(`poll-event-creator-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    const joinerOne = await signupAndLogin(`poll-event-joiner1-${randomUUID()}@example.com`, societyId, flatB, OccupancyRole.TENANT);
    const joinerTwo = await signupAndLogin(`poll-event-joiner2-${randomUUID()}@example.com`, societyId, flatC, OccupancyRole.OWNER_OCCUPIER);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.EVENT, title: 'Society picnic', minCommitments: 2, closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const poll = createRes.body as PollDetailBody;
    expect(poll.status).toBe(PollStatus.OPEN);

    const afterFirstJoin = await joinerOne.agent.post(`/api/v1/polls/${poll.id}/join`).expect(201);
    expect((afterFirstJoin.body as PollDetailBody).status).toBe(PollStatus.OPEN);
    expect((afterFirstJoin.body as PollDetailBody).commitmentCount).toBe(1);
    expect((afterFirstJoin.body as PollDetailBody).hasJoined).toBe(true);

    const afterSecondJoin = await joinerTwo.agent.post(`/api/v1/polls/${poll.id}/join`).expect(201);
    const firedBody = afterSecondJoin.body as PollDetailBody;
    expect(firedBody.status).toBe(PollStatus.FIRED);
    expect(firedBody.commitmentCount).toBe(2);

    const firedMailOne = await latestMailTo(joinerOne.email, 'Poll fired — enough residents joined');
    expect(firedMailOne.text).toContain('Society picnic');
    const firedMailTwo = await latestMailTo(joinerTwo.email, 'Poll fired — enough residents joined');
    expect(firedMailTwo.text).toContain('Society picnic');
  });

  it('double-joining the same poll is rejected with 409', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const flatB = await makeFlat(societyId);
    const creator = await signupAndLogin(`poll-doublejoin-creator-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    const joiner = await signupAndLogin(`poll-doublejoin-joiner-${randomUUID()}@example.com`, societyId, flatB, OccupancyRole.TENANT);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.EVENT, title: 'Double join test', minCommitments: 5, closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await joiner.agent.post(`/api/v1/polls/${pollId}/join`).expect(201);
    await joiner.agent.post(`/api/v1/polls/${pollId}/join`).expect(409);
  });

  it('only the creator can close an OPEN poll early; it becomes CLOSED and can no longer be joined', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const flatB = await makeFlat(societyId);
    const creator = await signupAndLogin(`poll-close-creator-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    const other = await signupAndLogin(`poll-close-other-${randomUUID()}@example.com`, societyId, flatB, OccupancyRole.TENANT);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.EVENT, title: 'Close early test', minCommitments: 5, closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await other.agent.post(`/api/v1/polls/${pollId}/close`).expect(403);

    const closed = await creator.agent.post(`/api/v1/polls/${pollId}/close`).expect(201);
    expect((closed.body as PollDetailBody).status).toBe(PollStatus.CLOSED);

    await other.agent.post(`/api/v1/polls/${pollId}/join`).expect(400);
    await creator.agent.post(`/api/v1/polls/${pollId}/close`).expect(400);
  });

  it('an EVENT poll that never reaches minCommitments is resolved to EXPIRED by POST /polls/process-expired', async () => {
    const societyId = await newSociety();
    const committeeFlat = await makeFlat(societyId);
    const creatorFlat = await makeFlat(societyId);
    const joinerFlat = await makeFlat(societyId);

    const committee = await signupAndLogin(`poll-expiry-committee-${randomUUID()}@example.com`, societyId, committeeFlat, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);
    const creator = await signupAndLogin(`poll-expiry-creator-${randomUUID()}@example.com`, societyId, creatorFlat, OccupancyRole.OWNER_OCCUPIER);
    const joiner = await signupAndLogin(`poll-expiry-joiner-${randomUUID()}@example.com`, societyId, joinerFlat, OccupancyRole.TENANT);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.EVENT, title: 'Rooftop garden', minCommitments: 3, closesAt: futureIso(5 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await joiner.agent.post(`/api/v1/polls/${pollId}/join`).expect(201);

    // Push closesAt into the past directly via Prisma — the API itself
    // never allows creating (or editing into) a past closesAt. This models
    // "time passing" deterministically without wall-clock sleeps.
    await prisma.poll.update({ where: { id: pollId }, data: { closesAt: new Date(Date.now() - 60 * 1000) } });

    // A non-committee caller can't trigger expiry processing.
    await creator.agent.post('/api/v1/polls/process-expired').expect(403);

    const processRes = await committee.agent.post('/api/v1/polls/process-expired').expect(201);
    expect((processRes.body as { resolved: number }).resolved).toBeGreaterThanOrEqual(1);

    const getRes = await creator.agent.get(`/api/v1/polls/${pollId}`).expect(200);
    expect((getRes.body as PollDetailBody).status).toBe(PollStatus.EXPIRED);

    const expiredMail = await latestMailTo(joiner.email, 'Poll expired — not enough commitments');
    expect(expiredMail.text).toContain('Rooftop garden');
  });
});
