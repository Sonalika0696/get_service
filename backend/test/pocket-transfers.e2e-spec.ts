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
import { AccountKind, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 9.6 — dual-authorised cross-pocket transfers, end-to-end against
 * real Postgres. Mirrors approval-ladder.e2e-spec.ts's fixture shape
 * (society + flats + officers signed up and RATIFIED, roles granted via
 * `Role` rows) but exercises PocketTransfersService instead of
 * BulkBuyService: a request never posts to the ledger; a single
 * authorisation never executes (Decision #4's floor of 2, even under the
 * DEFAULT config where rung 1 would otherwise be 1 officer); a second
 * distinct officer executes the fromKind -> toKind ledger post; the same
 * officer authorising twice is a no-op; verifyBalances stays intact after
 * execution; cancel works; and a large amount needing committee-majority
 * requires the computed number of distinct officers.
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

interface PocketTransferBody {
  id: string;
  societyId: string;
  fromKind: AccountKind;
  toKind: AccountKind;
  amount: string | number;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  authorisedCount: number;
  requiredApprovers: number;
  executedAt: string | null;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface LedgerVerifyBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

describe('Pocket transfers (e2e) — Phase 9.6', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  const societyIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
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
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);

    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }
  type Officer = Awaited<ReturnType<typeof signupAndLogin>>;

  async function makeRole(societyId: string, userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  async function createSocietyWithFlats(name: string, flatCount: number): Promise<{ societyId: string; flatIds: string[] }> {
    const society = await prisma.society.create({ data: { name, address: 'n/a' } });
    societyIds.push(society.id);
    const flatIds: string[] = [];
    for (let i = 0; i < flatCount; i++) {
      const flat = await prisma.flat.create({ data: { societyId: society.id, unitNo: `PT-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
    return { societyId: society.id, flatIds };
  }

  /** Funds a pocket by posting a treasury adjustment EXTERNAL -> kind, so a later transfer out of it has something to move. */
  async function fundPocket(agent: ReturnType<typeof request.agent>, kind: AccountKind, amount: number): Promise<void> {
    await agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', `fund-${kind}-${randomUUID()}`)
      .send({ debitKind: AccountKind.EXTERNAL, creditKind: kind, amount, reasonCode: 'TEST_FUND_POCKET' })
      .expect(201);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
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
  });

  afterAll(async () => {
    await prisma.pocketTransferAuthorisation.deleteMany({ where: { transfer: { societyId: { in: societyIds } } } });
    await prisma.pocketTransfer.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.account.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId: { in: societyIds } } });
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

  describe('request / floor-of-2 authorisation / cancel', () => {
    let societyId: string;
    let flatIds: string[];
    let committee: Officer;
    let treasurer: Officer;
    let deputy: Officer;
    let plainResident: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Pocket Transfers Society', 10);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`pt-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      treasurer = await signupAndLogin(`pt-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      deputy = await signupAndLogin(`pt-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);
      plainResident = await signupAndLogin(`pt-plain-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);

      // DEFAULT_APPROVAL_CONFIG (lowerThreshold 5000) — every amount below
      // is rung 1, which would normally need only 1 officer; Decision #4's
      // floor of 2 is what's actually under test in this describe block.
      await fundPocket(committee.agent, AccountKind.MAINTENANCE, 100_000);
    });

    it('a plain resident (no officer role) is rejected outright', async () => {
      await plainResident.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 500, reasonCode: 'TEST_TRANSFER' })
        .expect(403);
    });

    it('request creates a PENDING transfer and posts NOTHING to the ledger', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const maintenanceStart = balanceOf(startLedger, AccountKind.MAINTENANCE);
      const sinkingStart = balanceOf(startLedger, AccountKind.SINKING);

      const res = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 500, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const body = res.body as PocketTransferBody;
      expect(body.status).toBe('PENDING');
      expect(body.authorisedCount).toBe(0);
      expect(body.requiredApprovers).toBe(2); // floored — DEFAULT config's rung 1 would otherwise be 1
      expect(body.executedAt).toBeNull();

      const afterLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(afterLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart);
      expect(balanceOf(afterLedger, AccountKind.SINKING)).toBe(sinkingStart);

      const authorisations = await prisma.pocketTransferAuthorisation.findMany({ where: { transferId: body.id } });
      expect(authorisations).toHaveLength(0);
    });

    it('rejects fromKind === toKind, a non-pocket AccountKind, and a non-positive amount', async () => {
      await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'MAINTENANCE', amount: 500, reasonCode: 'TEST' })
        .expect(400);
      await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'BULK_BUY', toKind: 'SINKING', amount: 500, reasonCode: 'TEST' })
        .expect(400);
      await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 0, reasonCode: 'TEST' })
        .expect(400);
    });

    it('a single authorisation never executes (floor of 2) — a second DISTINCT officer executes it', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const maintenanceStart = balanceOf(startLedger, AccountKind.MAINTENANCE);
      const sinkingStart = balanceOf(startLedger, AccountKind.SINKING);

      const createRes = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 800, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const transferId = (createRes.body as PocketTransferBody).id;

      const firstRes = await treasurer.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      const firstBody = firstRes.body as PocketTransferBody;
      expect(firstBody.status).toBe('PENDING');
      expect(firstBody.authorisedCount).toBe(1);

      const midLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(midLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart); // untouched

      const secondRes = await deputy.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      const secondBody = secondRes.body as PocketTransferBody;
      expect(secondBody.status).toBe('EXECUTED');
      expect(secondBody.authorisedCount).toBe(2);
      expect(secondBody.executedAt).not.toBeNull();

      const authorisations = await prisma.pocketTransferAuthorisation.findMany({ where: { transferId } });
      expect(authorisations).toHaveLength(2);
      expect(authorisations.map((a) => a.authoriserId).sort()).toEqual([treasurer.userId, deputy.userId].sort());

      const finalLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(finalLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart - 800);
      expect(balanceOf(finalLedger, AccountKind.SINKING)).toBe(sinkingStart + 800);

      const entryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'PocketTransfer', linkedEntityId: transferId, reasonCode: 'POCKET_TRANSFER_EXECUTE' } });
      expect(entryCount).toBe(1);
    });

    it('the SAME officer authorising twice never increments the distinct count and never executes on its own', async () => {
      const createRes = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 300, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const transferId = (createRes.body as PocketTransferBody).id;

      const firstRes = await treasurer.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      expect((firstRes.body as PocketTransferBody).status).toBe('PENDING');

      const secondRes = await treasurer.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      const secondBody = secondRes.body as PocketTransferBody;
      expect(secondBody.status).toBe('PENDING');
      expect(secondBody.authorisedCount).toBe(1);

      const authorisations = await prisma.pocketTransferAuthorisation.findMany({ where: { transferId } });
      expect(authorisations).toHaveLength(1);
      expect(authorisations[0].authoriserId).toBe(treasurer.userId);

      // Re-authorising after this doesn't double-post once it does execute.
      const thirdRes = await deputy.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      expect((thirdRes.body as PocketTransferBody).status).toBe('EXECUTED');

      const replayRes = await treasurer.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      expect((replayRes.body as PocketTransferBody).status).toBe('EXECUTED');

      const entryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'PocketTransfer', linkedEntityId: transferId, reasonCode: 'POCKET_TRANSFER_EXECUTE' } });
      expect(entryCount).toBe(1); // no double-post from the replayed call after EXECUTED
    });

    it('verifyBalances / GET /ledger/verify stays intact after execution', async () => {
      const verify = (await committee.agent.get('/api/v1/ledger/verify').expect(200)).body as LedgerVerifyBody;
      expect(verify.ok).toBe(true);
      expect(verify.accounts.every((a) => a.intact)).toBe(true);

      const ledger = await ledgerBalances(committee.agent);
      expect(ledger.balancesIntact).toBe(true);
    });

    it('cancel: a PENDING transfer moves to CANCELLED with no money movement; re-cancelling is a no-op; an EXECUTED transfer cannot be cancelled', async () => {
      const createRes = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 200, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const transferId = (createRes.body as PocketTransferBody).id;

      const startLedger = await ledgerBalances(committee.agent);
      const maintenanceStart = balanceOf(startLedger, AccountKind.MAINTENANCE);

      const cancelRes = await committee.agent.post(`/api/v1/pocket-transfers/${transferId}/cancel`).expect(201);
      expect((cancelRes.body as PocketTransferBody).status).toBe('CANCELLED');

      const afterLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(afterLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart);

      // Re-cancelling is a verified no-op.
      const replayRes = await committee.agent.post(`/api/v1/pocket-transfers/${transferId}/cancel`).expect(201);
      expect((replayRes.body as PocketTransferBody).status).toBe('CANCELLED');

      // Authorising a cancelled transfer is rejected.
      await treasurer.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(400);

      // An EXECUTED transfer cannot be cancelled.
      const executeMe = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 150, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const executeId = (executeMe.body as PocketTransferBody).id;
      await treasurer.agent.post(`/api/v1/pocket-transfers/${executeId}/authorise`).expect(201);
      const executedRes = await deputy.agent.post(`/api/v1/pocket-transfers/${executeId}/authorise`).expect(201);
      expect((executedRes.body as PocketTransferBody).status).toBe('EXECUTED');

      await committee.agent.post(`/api/v1/pocket-transfers/${executeId}/cancel`).expect(400);
    });

    it('GET /pocket-transfers/:id and GET /pocket-transfers (cursor list) reflect current state', async () => {
      const createRes = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'SINKING', amount: 250, reasonCode: 'TEST_TRANSFER' })
        .expect(201);
      const transferId = (createRes.body as PocketTransferBody).id;

      const getRes = await committee.agent.get(`/api/v1/pocket-transfers/${transferId}`).expect(200);
      expect((getRes.body as PocketTransferBody).id).toBe(transferId);

      const listRes = await committee.agent.get('/api/v1/pocket-transfers').query({ status: 'PENDING' }).expect(200);
      const listBody = listRes.body as { items: PocketTransferBody[]; nextCursor: string | null };
      expect(listBody.items.every((i) => i.status === 'PENDING')).toBe(true);
      expect(listBody.items.some((i) => i.id === transferId)).toBe(true);
      expect(listRes.headers.etag).toBeDefined();

      // Matching If-None-Match short-circuits to a bodyless 304.
      const etag = listRes.headers.etag as string;
      await committee.agent.get('/api/v1/pocket-transfers').query({ status: 'PENDING' }).set('If-None-Match', etag).expect(304);
    });
  });

  describe('committee-majority rung (large amount, floor already exceeded)', () => {
    /**
     * A dedicated society so the committee roster (COMMITTEE/TREASURER/
     * DEPUTY_TREASURER distinct-user count) is exactly known — mirrors
     * approval-ladder.e2e-spec.ts's identical "RUNG3" society pattern.
     */
    let societyId: string;
    let flatIds: string[];
    let committee: Officer;
    let officerA: Officer; // TREASURER
    let officerB: Officer; // DEPUTY_TREASURER
    let officerC: Officer; // COMMITTEE (second committee member)

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Pocket Transfers RUNG3 Society', 10);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`pt-r3-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      await committee.agent.put('/api/v1/bulk-buy/approval-config').send({ lowerThreshold: 1000, upperThreshold: 5000, majorityFraction: 0.5 }).expect(200);

      officerA = await signupAndLogin(`pt-r3-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerA.userId, RoleKind.TREASURER);
      officerB = await signupAndLogin(`pt-r3-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerB.userId, RoleKind.DEPUTY_TREASURER);
      officerC = await signupAndLogin(`pt-r3-committee2-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerC.userId, RoleKind.COMMITTEE);

      // 5th roster seat — pads the roster to exactly 5 distinct members
      // (committee, officerA, officerB, officerC, officerD) without ever
      // authorising anything itself.
      const officerD = await signupAndLogin(`pt-r3-committee3-${randomUUID()}@example.com`, societyId, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, officerD.userId, RoleKind.COMMITTEE);

      await fundPocket(committee.agent, AccountKind.MAINTENANCE, 1_000_000);
    });

    it('amount > upperThreshold: required = ceil(0.5 * 5) = 3 — 2 officers racing concurrently still leave it unexecuted; a 3rd distinct officer completes it', async () => {
      const rosterSize = await prisma.role.findMany({
        where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(rosterSize).toHaveLength(5);

      const startLedger = await ledgerBalances(committee.agent);
      const maintenanceStart = balanceOf(startLedger, AccountKind.MAINTENANCE);

      const createRes = await committee.agent
        .post('/api/v1/pocket-transfers')
        .send({ fromKind: 'MAINTENANCE', toKind: 'CORPUS', amount: 8000, reasonCode: 'TEST_TRANSFER' }) // > 5000 -> rung 3, required ceil(0.5*5)=3
        .expect(201);
      const transferId = (createRes.body as PocketTransferBody).id;
      expect((createRes.body as PocketTransferBody).requiredApprovers).toBe(3);

      const [negRes1, negRes2] = await Promise.all([
        officerA.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`),
        officerB.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`),
      ]);
      expect(negRes1.status).toBe(201);
      expect(negRes2.status).toBe(201);
      expect((negRes1.body as PocketTransferBody).status).toBe('PENDING');
      expect((negRes2.body as PocketTransferBody).status).toBe('PENDING');

      const midLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(midLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart); // untouched — 2 < 3

      const midAuthorisations = await prisma.pocketTransferAuthorisation.findMany({ where: { transferId } });
      expect(midAuthorisations).toHaveLength(2);

      const finalRes = await officerC.agent.post(`/api/v1/pocket-transfers/${transferId}/authorise`).expect(201);
      const finalBody = finalRes.body as PocketTransferBody;
      expect(finalBody.status).toBe('EXECUTED');

      const finalAuthorisations = await prisma.pocketTransferAuthorisation.findMany({ where: { transferId } });
      expect(finalAuthorisations).toHaveLength(3);

      const finalLedger = await ledgerBalances(committee.agent);
      expect(finalLedger.balancesIntact).toBe(true);
      expect(balanceOf(finalLedger, AccountKind.MAINTENANCE)).toBe(maintenanceStart - 8000);
      expect(balanceOf(finalLedger, AccountKind.CORPUS)).toBe(8000);
    });
  });
});
