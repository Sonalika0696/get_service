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
import { OccupancyRole, PollStatus, PollType, PollWeightMode, RoleKind, VoteChoice } from '../src/generated/prisma/enums.js';

/**
 * Phase 3 (poll engine) Definition of Done, end-to-end against real
 * Postgres:
 *  - ADVISORY, uniform weight: every resident (owner or tenant) votes at
 *    weight 1; closing early resolves PASSED/FAILED by simple majority.
 *  - BINDING, ownership-weighted: only committee can create one; a TENANT
 *    is rejected with 403; owners vote at their flat's ownershipShare.
 *  - EVENT auto-fire: joining (PollCommitment) flips the poll to FIRED the
 *    moment minCommitments is reached, synchronously, and emails every
 *    committed resident.
 *  - Expiry: an OPEN EVENT poll whose closesAt has passed and which never
 *    reached minCommitments is resolved to EXPIRED by
 *    POST /polls/process-expired (the stand-in for a future scheduler).
 *
 * Expiry approach: CreatePollDto requires closesAt to be strictly in the
 * future (see PollsService.create), so there's no way to create an
 * already-expired poll through the API. The test instead creates a poll
 * with a near-future closesAt, then reaches into Postgres via Prisma to
 * push that one row's closesAt into the past — exactly the "update the
 * row's closesAt to the past via Prisma" option the task called out — and
 * then drives resolution explicitly via POST /polls/process-expired
 * (committee-only), which stands in for a periodic scheduler that doesn't
 * exist yet (no @nestjs/schedule dependency was added in this phase).
 *
 * Isolation note: eligibility/quorum for ADVISORY and BINDING polls is
 * computed over *every* active occupancy in the poll's society (see
 * PollsService.computeTotalEligibleWeight) — that's the whole point of a
 * quorum. So each `it` below creates its own fresh society (own flats, own
 * residents) rather than sharing one across the suite; otherwise residents
 * signed up by an earlier test would silently inflate the quorum
 * denominator for a later test and make the tally assertions flaky.
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
  weightMode: PollWeightMode;
  creatorId: string;
  commitmentCount: number;
  hasVoted: boolean;
  hasJoined: boolean;
  tally: {
    totalEligibleWeight: number | string;
    castWeight: number | string;
    yesWeight: number | string;
    noWeight: number | string;
    abstainWeight: number | string;
    quorumMet: boolean;
    passed: boolean;
  };
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

  /** Every test gets its own society so quorum/eligibility math never crosses tests — see the isolation note above. */
  async function newSociety(): Promise<string> {
    const society = await prisma.society.create({ data: { name: `Polls Test Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyIds.push(society.id);
    return society.id;
  }

  async function makeFlat(societyId: string, ownershipShare?: number): Promise<string> {
    const flat = await prisma.flat.create({
      data: {
        societyId,
        unitNo: `P-${randomUUID().slice(0, 8)}`,
        maintenanceAmount: 1000,
        ...(ownershipShare !== undefined ? { ownershipShare } : {}),
      },
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
    await prisma.vote.deleteMany({ where: { poll: { societyId: { in: societyIds } } } });
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

  it('ADVISORY poll: a tenant and an owner each vote at weight 1; closing early resolves it by simple majority', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const flatB = await makeFlat(societyId);

    const creator = await signupAndLogin(`poll-advisory-creator-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);
    const tenant = await signupAndLogin(`poll-advisory-tenant-${randomUUID()}@example.com`, societyId, flatB, OccupancyRole.TENANT);

    const createRes = await creator.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.ADVISORY, title: 'Repaint the gate?', closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const poll = createRes.body as PollDetailBody;
    expect(poll.status).toBe(PollStatus.OPEN);
    expect(poll.weightMode).toBe(PollWeightMode.UNIFORM);

    await creator.agent.post(`/api/v1/polls/${poll.id}/vote`).send({ choice: VoteChoice.YES }).expect(201);
    const afterTenantVote = await tenant.agent.post(`/api/v1/polls/${poll.id}/vote`).send({ choice: VoteChoice.NO }).expect(201);
    const midTally = (afterTenantVote.body as PollDetailBody).tally;
    // Exactly two residents in this society: only the two active occupancies count as eligible.
    expect(Number(midTally.totalEligibleWeight)).toBe(2);
    expect(Number(midTally.yesWeight)).toBe(1); // TENANT and OWNER both weigh 1 on ADVISORY, regardless of role
    expect(Number(midTally.noWeight)).toBe(1);
    expect(Number(midTally.castWeight)).toBe(2);

    const closed = await creator.agent.post(`/api/v1/polls/${poll.id}/close`).expect(201);
    const closedBody = closed.body as PollDetailBody;
    // Tied 1-1 at the default passingPct=50 passes on the inclusive >= comparison; quorum 2/2 clears the default 60%.
    expect(closedBody.status).toBe(PollStatus.PASSED);
    expect(Number(closedBody.tally.yesWeight)).toBe(1);
    expect(Number(closedBody.tally.noWeight)).toBe(1);

    const getRes = await creator.agent.get(`/api/v1/polls/${poll.id}`).expect(200);
    expect((getRes.body as PollDetailBody).hasVoted).toBe(true);
  });

  it('double-voting the same poll is rejected with 409', async () => {
    const societyId = await newSociety();
    const flatA = await makeFlat(societyId);
    const voter = await signupAndLogin(`poll-doublevote-${randomUUID()}@example.com`, societyId, flatA, OccupancyRole.OWNER_OCCUPIER);

    const createRes = await voter.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.ADVISORY, title: 'Double vote test', closesAt: futureIso(60 * 60 * 1000) })
      .expect(201);
    const pollId = (createRes.body as PollDetailBody).id;

    await voter.agent.post(`/api/v1/polls/${pollId}/vote`).send({ choice: VoteChoice.YES }).expect(201);
    await voter.agent.post(`/api/v1/polls/${pollId}/vote`).send({ choice: VoteChoice.NO }).expect(409);
  });

  it('BINDING + OWNERSHIP_WEIGHTED poll: only committee can create it, a tenant is rejected, and owners vote at their ownershipShare', async () => {
    const societyId = await newSociety();
    const committeeFlat = await makeFlat(societyId);
    const ownerOccupierFlat = await makeFlat(societyId, 1.0);
    const ownerAbsenteeFlat = await makeFlat(societyId, 1.5);
    const tenantFlat = await makeFlat(societyId);

    const committee = await signupAndLogin(`poll-binding-committee-${randomUUID()}@example.com`, societyId, committeeFlat, OccupancyRole.OWNER_OCCUPIER);
    await makeCommittee(societyId, committee.userId);

    const ownerOccupier = await signupAndLogin(`poll-binding-owner-occ-${randomUUID()}@example.com`, societyId, ownerOccupierFlat, OccupancyRole.OWNER_OCCUPIER);
    const ownerAbsentee = await signupAndLogin(`poll-binding-owner-abs-${randomUUID()}@example.com`, societyId, ownerAbsenteeFlat, OccupancyRole.OWNER_ABSENTEE);
    const tenant = await signupAndLogin(`poll-binding-tenant-${randomUUID()}@example.com`, societyId, tenantFlat, OccupancyRole.TENANT);

    // A non-committee resident cannot create a BINDING poll.
    await ownerOccupier.agent
      .post('/api/v1/polls')
      .send({ pollType: PollType.BINDING, weightMode: PollWeightMode.OWNERSHIP_WEIGHTED, title: 'Should fail', closesAt: futureIso(60 * 60 * 1000) })
      .expect(403);

    const createRes = await committee.agent
      .post('/api/v1/polls')
      .send({
        pollType: PollType.BINDING,
        weightMode: PollWeightMode.OWNERSHIP_WEIGHTED,
        title: 'Approve the new elevator contract',
        quorumPct: 50,
        passingPct: 50,
        closesAt: futureIso(60 * 60 * 1000),
      })
      .expect(201);
    const poll = createRes.body as PollDetailBody;
    expect(poll.pollType).toBe(PollType.BINDING);
    expect(poll.weightMode).toBe(PollWeightMode.OWNERSHIP_WEIGHTED);

    // Tenants cannot vote on binding polls.
    await tenant.agent.post(`/api/v1/polls/${poll.id}/vote`).send({ choice: VoteChoice.YES }).expect(403);

    // Eligible owners in this society: committee (share 1.0, default), ownerOccupier (1.0), ownerAbsentee (1.5) = 3.5 total.
    const afterOwnerOccVote = await ownerOccupier.agent.post(`/api/v1/polls/${poll.id}/vote`).send({ choice: VoteChoice.YES }).expect(201);
    expect(Number((afterOwnerOccVote.body as PollDetailBody).tally.totalEligibleWeight)).toBeCloseTo(3.5, 4);
    expect(Number((afterOwnerOccVote.body as PollDetailBody).tally.yesWeight)).toBeCloseTo(1.0, 4);

    const afterOwnerAbsVote = await ownerAbsentee.agent.post(`/api/v1/polls/${poll.id}/vote`).send({ choice: VoteChoice.YES }).expect(201);
    const tallyAfterBoth = (afterOwnerAbsVote.body as PollDetailBody).tally;
    // Weights equal ownershipShare, not a flat count of 1 per voter.
    expect(Number(tallyAfterBoth.yesWeight)).toBeCloseTo(2.5, 4); // 1.0 (occupier) + 1.5 (absentee)
    expect(Number(tallyAfterBoth.noWeight)).toBe(0);
    // 2.5 / 3.5 ≈ 0.714 >= 50% quorum.
    expect(tallyAfterBoth.quorumMet).toBe(true);

    const closed = await committee.agent.post(`/api/v1/polls/${poll.id}/close`).expect(201);
    const closedBody = closed.body as PollDetailBody;
    expect(closedBody.status).toBe(PollStatus.PASSED);
    expect(Number(closedBody.tally.yesWeight)).toBeCloseTo(2.5, 4);
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
