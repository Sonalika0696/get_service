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
import { AccountKind, OccupancyRole, PrincipalKind, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 9.1 — VirtualAccount (per-flat attribution key) + sub-ledger pockets
 * (BACKEND_PLAN.md Phase 9.1; DECISIONS_V2_SCOPE.md §6.1/§6.6). Definition
 * of Done exercised here, end to end against real Postgres:
 *  - a flat imported via CSV gets exactly one VirtualAccount with a unique
 *    code; re-importing the same unitNo never creates a second one or
 *    changes the code;
 *  - POST /operator/societies/:sid/virtual-accounts/backfill provisions a
 *    VirtualAccount for every pre-existing flat that lacks one, is
 *    idempotent (a second call creates zero), and is OPERATOR-only (a
 *    resident is 403'd);
 *  - GET /flats/:id/virtual-account is COMMITTEE-scoped: a plain resident
 *    (no COMMITTEE role) is 403'd, a committee member sees the code;
 *  - the 7 new AccountKind pockets (MAINTENANCE/ELECTRICITY/WATER/EVENTS/
 *    WELFARE/SINKING/CORPUS) can each back an Account row and
 *    GET /ledger/verify still reports every account intact for a society
 *    with zero postings against any of them — this phase adds no posting
 *    path of its own, so an Account merely existing for a pocket kind must
 *    not perturb invariant I6.
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

interface VirtualAccountBody {
  id: string;
  societyId: string;
  flatId: string;
  code: string;
  status: string;
}

interface BackfillBody {
  created: number;
  alreadyProvisioned: number;
  total: number;
}

interface LedgerVerifyBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

describe('VirtualAccount + sub-ledger pockets — Phase 9.1 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const societyIds: string[] = [];

  async function latestMailTo(email: string): Promise<SendMailInput> {
    const last = mailer.sent.filter((m) => m.to === email).at(-1);
    if (!last) throw new Error(`No mail captured for ${email}`);
    return last;
  }

  async function signupAndLogin(email: string, sId: string, fId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId: sId, flatId: fId, role })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    const code = extractOtpCode(await latestMailTo(email));
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, sId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId: sId, userId, kind } });
  }

  /** Same technique as operator-console.e2e-spec.ts's bootstrapOperatorAgent. */
  async function bootstrapOperatorAgent() {
    const email = `bootstrap-operator-va-${randomUUID()}@example.com`;
    const password = 'bootstrap operator passphrase';
    const user = await prisma.user.create({ data: { name: 'Bootstrap Operator', email, principalKind: PrincipalKind.OPERATOR } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpCode(await latestMailTo(email));
    const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
    return { agent, userId: user.id };
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

    const society = await prisma.society.create({ data: { name: 'Virtual Account Test Society', address: 'n/a' } });
    societyId = society.id;
    societyIds.push(societyId);

    for (let i = 0; i < 4; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `VA-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.account.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.virtualAccount.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  describe('CSV import provisioning', () => {
    it('a flat imported via CSV gets exactly one VirtualAccount with a unique code; re-import does not duplicate or change the code', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const society = await prisma.society.create({ data: { name: 'VA CSV Import Society', address: 'n/a' } });
      societyIds.push(society.id);

      await operatorAgent
        .post(`/api/v1/operator/societies/${society.id}/flats/import`)
        .send({ csv: 'unitNo,maintenanceAmount\nA-101,1500\nA-102,1600\n' })
        .expect(201);

      const flatsAfterFirstImport = await prisma.flat.findMany({ where: { societyId: society.id }, include: { virtualAccount: true } });
      expect(flatsAfterFirstImport).toHaveLength(2);
      for (const flat of flatsAfterFirstImport) {
        expect(flat.virtualAccount).not.toBeNull();
        expect(flat.virtualAccount?.societyId).toBe(society.id);
        expect(flat.virtualAccount?.status).toBe('ACTIVE');
      }
      const codesAfterFirstImport = flatsAfterFirstImport.map((f) => f.virtualAccount?.code);
      expect(new Set(codesAfterFirstImport).size).toBe(2); // unique per flat

      const totalVaCountAfterFirst = await prisma.virtualAccount.count({ where: { societyId: society.id } });
      expect(totalVaCountAfterFirst).toBe(2);

      // Re-import: A-101's amount changes, A-103 is new — A-101's VirtualAccount/code must be untouched, and no duplicates appear.
      await operatorAgent
        .post(`/api/v1/operator/societies/${society.id}/flats/import`)
        .send({ csv: 'unitNo,maintenanceAmount\nA-101,1750\nA-103,1200\n' })
        .expect(201);

      const flatsAfterSecondImport = await prisma.flat.findMany({ where: { societyId: society.id }, include: { virtualAccount: true } });
      expect(flatsAfterSecondImport).toHaveLength(3);
      for (const flat of flatsAfterSecondImport) {
        expect(flat.virtualAccount).not.toBeNull();
      }
      const a101 = flatsAfterSecondImport.find((f) => f.unitNo === 'A-101')!;
      const a101CodeBefore = codesAfterFirstImport[flatsAfterFirstImport.findIndex((f) => f.unitNo === 'A-101')];
      expect(a101.virtualAccount?.code).toBe(a101CodeBefore);

      const codesAfterSecondImport = flatsAfterSecondImport.map((f) => f.virtualAccount?.code);
      expect(new Set(codesAfterSecondImport).size).toBe(3);

      const totalVaCountAfterSecond = await prisma.virtualAccount.count({ where: { societyId: society.id } });
      expect(totalVaCountAfterSecond).toBe(3); // no duplicates from the re-import
    });
  });

  describe('operator backfill', () => {
    it('provisions VirtualAccounts for pre-existing flats, is idempotent, and is OPERATOR-only', async () => {
      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      const society = await prisma.society.create({ data: { name: 'VA Backfill Society', address: 'n/a' } });
      societyIds.push(society.id);

      // Flats created directly (pre-existing, no VirtualAccount) — mirrors a flat register from before this phase shipped.
      const preExistingFlats = await Promise.all(
        [0, 1, 2].map((i) => prisma.flat.create({ data: { societyId: society.id, unitNo: `PRE-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } })),
      );

      const resident = await signupAndLogin(`va-backfill-resident-${randomUUID()}@example.com`, society.id, preExistingFlats[0].id, OccupancyRole.OWNER_OCCUPIER);
      await resident.agent.post(`/api/v1/operator/societies/${society.id}/virtual-accounts/backfill`).expect(403);

      const firstRun = (await operatorAgent.post(`/api/v1/operator/societies/${society.id}/virtual-accounts/backfill`).expect(201)).body as BackfillBody;
      expect(firstRun).toEqual({ created: 3, alreadyProvisioned: 0, total: 3 });

      const vasAfterFirstRun = await prisma.virtualAccount.findMany({ where: { societyId: society.id } });
      expect(vasAfterFirstRun).toHaveLength(3);
      expect(new Set(vasAfterFirstRun.map((va) => va.code)).size).toBe(3);

      const auditRows = await prisma.auditLog.findMany({ where: { societyId: society.id, action: 'VIRTUAL_ACCOUNT_BACKFILL' } });
      expect(auditRows).toHaveLength(1);

      // Idempotent: a second run creates nothing new.
      const secondRun = (await operatorAgent.post(`/api/v1/operator/societies/${society.id}/virtual-accounts/backfill`).expect(201)).body as BackfillBody;
      expect(secondRun).toEqual({ created: 0, alreadyProvisioned: 3, total: 3 });

      const vasAfterSecondRun = await prisma.virtualAccount.findMany({ where: { societyId: society.id } });
      expect(vasAfterSecondRun).toHaveLength(3);
      expect(vasAfterSecondRun.map((va) => va.code).sort()).toEqual(vasAfterFirstRun.map((va) => va.code).sort());
    });
  });

  describe('committee-scoped read', () => {
    it('GET /flats/:id/virtual-account is committee-scoped: a plain resident is 403d, a committee member sees the code', async () => {
      const society = await prisma.society.create({ data: { name: 'VA Read Society', address: 'n/a' } });
      societyIds.push(society.id);
      const flat = await prisma.flat.create({ data: { societyId: society.id, unitNo: `READ-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });

      const { agent: operatorAgent } = await bootstrapOperatorAgent();
      await operatorAgent.post(`/api/v1/operator/societies/${society.id}/virtual-accounts/backfill`).expect(201);
      const va = await prisma.virtualAccount.findUniqueOrThrow({ where: { flatId: flat.id } });

      const plainResident = await signupAndLogin(`va-read-plain-${randomUUID()}@example.com`, society.id, flat.id, OccupancyRole.OWNER_OCCUPIER);
      await plainResident.agent.get(`/api/v1/flats/${flat.id}/virtual-account`).expect(403);

      const committeeFlat = await prisma.flat.create({ data: { societyId: society.id, unitNo: `READ-COMMITTEE-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      const committee = await signupAndLogin(`va-read-committee-${randomUUID()}@example.com`, society.id, committeeFlat.id, OccupancyRole.OWNER_OCCUPIER);
      await makeRole(committee.userId, society.id, RoleKind.COMMITTEE);

      const readRes = await committee.agent.get(`/api/v1/flats/${flat.id}/virtual-account`).expect(200);
      const body = readRes.body as VirtualAccountBody;
      expect(body.flatId).toBe(flat.id);
      expect(body.societyId).toBe(society.id);
      expect(body.code).toBe(va.code);
      expect(body.status).toBe('ACTIVE');

      // Unauthenticated is a 401, not a leaked 403/200.
      await request(app.getHttpServer()).get(`/api/v1/flats/${flat.id}/virtual-account`).expect(401);
    });
  });

  describe('sub-ledger pockets', () => {
    it('the 7 new AccountKind pockets can back an Account row and GET /ledger/verify still reports every account intact with no pocket postings', async () => {
      const committee = await signupAndLogin(`va-pockets-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(committee.userId, societyId, RoleKind.COMMITTEE);

      const pocketKinds: AccountKind[] = [
        AccountKind.MAINTENANCE,
        AccountKind.ELECTRICITY,
        AccountKind.WATER,
        AccountKind.EVENTS,
        AccountKind.WELFARE,
        AccountKind.SINKING,
        AccountKind.CORPUS,
      ];

      // No posting path exists for these kinds yet (by design — this phase is additive-only);
      // provision the Account rows the same lazy way LedgerService.getOrCreateAccount would.
      for (const kind of pocketKinds) {
        await prisma.account.upsert({ where: { societyId_kind: { societyId, kind } }, update: {}, create: { societyId, kind } });
      }

      const verifyRes = await committee.agent.get('/api/v1/ledger/verify').expect(200);
      const body = verifyRes.body as LedgerVerifyBody;
      expect(body.ok).toBe(true);
      for (const kind of pocketKinds) {
        const row = body.accounts.find((a) => a.kind === kind);
        expect(row).toBeDefined();
        expect(row?.intact).toBe(true);
      }

      // Every pocket account's balance is exactly 0 — nothing was ever posted against it.
      const accounts = await prisma.account.findMany({ where: { societyId, kind: { in: pocketKinds } } });
      expect(accounts).toHaveLength(pocketKinds.length);
      for (const account of accounts) {
        expect(Number(account.balance)).toBe(0);
      }
    });
  });
});
