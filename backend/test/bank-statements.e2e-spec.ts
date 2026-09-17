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
import { VirtualAccountsService } from '../src/modules/virtual-accounts/virtual-accounts.service.js';

/**
 * Phase 9.5 (bank-statement ingestion -> treasurer allocate queue)
 * Definition of Done, end-to-end against real Postgres:
 *  - POST /bank-statements/ingest creates one BankStatementLine per valid
 *    CSV row, and a narration containing a flat's VirtualAccount.code
 *    auto-MATCHES to that flat WITHOUT posting to the ledger;
 *  - POST /bank-statements/lines/:id/allocate is the only thing that posts
 *    (EXTERNAL -> the chosen pocket) and flips the line to ALLOCATED;
 *    GET /ledger/verify (I6) stays intact throughout;
 *  - POST /bank-statements/lines/:id/ignore marks IGNORED with no posting;
 *  - GET /bank-statements/lines paginates (cursor) and supports ETag 304;
 *  - GET /bank-statements/export returns a CSV.
 *
 * Society/flats/VirtualAccounts are created fresh in beforeAll and every
 * query below is scoped to this suite's own societyId, so this suite is
 * safe to run concurrently with sibling agents' e2e suites against the same
 * shared Postgres instance.
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

interface LineBody {
  id: string;
  societyId: string;
  valueDate: string;
  amount: string;
  narration: string;
  reference: string | null;
  matchedFlatId: string | null;
  status: 'UNMATCHED' | 'MATCHED' | 'ALLOCATED' | 'IGNORED';
  allocatedById: string | null;
  allocatedAt: string | null;
}

interface IngestBody {
  ingested: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

interface LinesPageBody {
  items: LineBody[];
  nextCursor: string | null;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface LedgerVerifyBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

describe('Bank-statement ingestion + allocate queue (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let virtualAccounts: VirtualAccountsService;
  let mailer: CapturingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const vaCodesByFlat: Record<string, string> = {};
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const last = mailer.sent.filter((m) => m.to === email && m.subject === subject).at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(email: string, flatId: string, role: OccupancyRole) {
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

    // Phase 6.3 ratification gate — standing up an already-approved
    // resident, not testing ratification itself (see maintenance.e2e-spec.ts's
    // identical helper doc comment).
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
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
    virtualAccounts = app.get(VirtualAccountsService);

    const society = await prisma.society.create({ data: { name: 'Bank Statement Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 3; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `BS-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
      const va = await virtualAccounts.provisionForFlat(flat);
      vaCodesByFlat[flat.id] = va.code;
    }
  });

  afterAll(async () => {
    await prisma.bankStatementLine.deleteMany({ where: { societyId } });
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.virtualAccount.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  it('(a) ingest creates one line per valid CSV row; an auto-matched narration does NOT post to the ledger', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-a-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE); // GET /ledger is COMMITTEE-gated

    const before = await ledgerBalances(treasurer.agent);
    const maintenanceBefore = balanceOf(before, AccountKind.MAINTENANCE);

    const matchedCode = vaCodesByFlat[flatIds[0]];
    const csv = ['valueDate,amount,narration,reference', `2026-01-05,1000,NEFT CR ${matchedCode} maintenance,UTR001`, '2026-01-06,500,cash deposit no code,'].join('\n');

    const result = (await treasurer.agent.post('/api/v1/bank-statements/ingest').send({ csv }).expect(201)).body as IngestBody;
    expect(result.ingested).toBe(2);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.errors).toEqual([]);

    const lines = await prisma.bankStatementLine.findMany({ where: { societyId }, orderBy: { valueDate: 'asc' } });
    expect(lines).toHaveLength(2);
    const matchedLine = lines.find((l) => l.narration.includes(matchedCode));
    expect(matchedLine?.status).toBe('MATCHED');
    expect(matchedLine?.matchedFlatId).toBe(flatIds[0]);
    const unmatchedLine = lines.find((l) => !l.narration.includes(matchedCode));
    expect(unmatchedLine?.status).toBe('UNMATCHED');
    expect(unmatchedLine?.matchedFlatId).toBeNull();

    // Matching NEVER posts — ledger untouched by ingest.
    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.MAINTENANCE)).toBe(maintenanceBefore);
    expect(after.balancesIntact).toBe(true);

    // A plain resident (no TREASURER/COMMITTEE role) may not ingest.
    const resident = await signupAndLogin(`bs-plain-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.post('/api/v1/bank-statements/ingest').send({ csv: 'valueDate,amount,narration,reference\n2026-01-01,1,x,\n' }).expect(403);
  });

  it('(b) ingest reports per-row errors without dropping the valid rows', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-b-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const csv = ['valueDate,amount,narration,reference', '2026-01-07,250,good row,', 'not-a-date,250,bad row,'].join('\n');
    const result = (await treasurer.agent.post('/api/v1/bank-statements/ingest').send({ csv }).expect(201)).body as IngestBody;
    expect(result.ingested).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/valid calendar date/);
  });

  it('(c) an explicit allocate posts EXTERNAL -> pocket, flips ALLOCATED, and keeps the ledger intact; a second allocate is rejected', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-c-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    const matchedCode = vaCodesByFlat[flatIds[1]];
    const csv = `valueDate,amount,narration,reference\n2026-01-08,750,NEFT CR ${matchedCode},UTR-C\n`;
    await treasurer.agent.post('/api/v1/bank-statements/ingest').send({ csv }).expect(201);

    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { societyId, narration: { contains: matchedCode } } });
    expect(line.status).toBe('MATCHED');
    expect(line.matchedFlatId).toBe(flatIds[1]);

    const before = await ledgerBalances(treasurer.agent);
    const maintenanceBefore = balanceOf(before, AccountKind.MAINTENANCE);
    const externalBefore = balanceOf(before, AccountKind.EXTERNAL);

    const allocated = (
      await treasurer.agent
        .post(`/api/v1/bank-statements/lines/${line.id}/allocate`)
        .send({ pocketKind: 'MAINTENANCE' })
        .expect(201)
    ).body as LineBody;
    expect(allocated.status).toBe('ALLOCATED');
    expect(allocated.allocatedById).toBe(treasurer.userId);
    expect(allocated.matchedFlatId).toBe(flatIds[1]);

    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.MAINTENANCE)).toBe(maintenanceBefore + 750);
    expect(balanceOf(after, AccountKind.EXTERNAL)).toBe(externalBefore - 750);
    expect(after.balancesIntact).toBe(true);

    const verify = (await treasurer.agent.get('/api/v1/ledger/verify').expect(200)).body as LedgerVerifyBody;
    expect(verify.ok).toBe(true);

    // A second allocate on the same (now ALLOCATED) line is rejected, and posts nothing more.
    await treasurer.agent.post(`/api/v1/bank-statements/lines/${line.id}/allocate`).send({ pocketKind: 'MAINTENANCE' }).expect(409);
    const afterSecondAttempt = await ledgerBalances(treasurer.agent);
    expect(balanceOf(afterSecondAttempt, AccountKind.MAINTENANCE)).toBe(maintenanceBefore + 750);
  });

  it('(d) allocate on an UNMATCHED line requires (or accepts) an explicit flatId override, and posts to the chosen pocket', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-d-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    const csv = 'valueDate,amount,narration,reference\n2026-01-09,400,unattributed interest credit,\n';
    await treasurer.agent.post('/api/v1/bank-statements/ingest').send({ csv }).expect(201);
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { societyId, narration: 'unattributed interest credit' } });
    expect(line.status).toBe('UNMATCHED');
    expect(line.matchedFlatId).toBeNull();

    const before = await ledgerBalances(treasurer.agent);
    const corpusBefore = balanceOf(before, AccountKind.CORPUS);

    // Treasurer explicitly attributes it to flatIds[2] and a different pocket.
    const allocated = (
      await treasurer.agent
        .post(`/api/v1/bank-statements/lines/${line.id}/allocate`)
        .send({ pocketKind: 'CORPUS', flatId: flatIds[2] })
        .expect(201)
    ).body as LineBody;
    expect(allocated.status).toBe('ALLOCATED');
    expect(allocated.matchedFlatId).toBe(flatIds[2]);

    const after = await ledgerBalances(treasurer.agent);
    expect(balanceOf(after, AccountKind.CORPUS)).toBe(corpusBefore + 400);
    expect(after.balancesIntact).toBe(true);
  });

  it('(e) ignore marks IGNORED with no ledger posting; an already-ALLOCATED line cannot be ignored', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-e-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    const csv = 'valueDate,amount,narration,reference\n2026-01-10,150,junk credit,\n';
    await treasurer.agent.post('/api/v1/bank-statements/ingest').send({ csv }).expect(201);
    const line = await prisma.bankStatementLine.findFirstOrThrow({ where: { societyId, narration: 'junk credit' } });

    const before = await ledgerBalances(treasurer.agent);

    const ignored = (await treasurer.agent.post(`/api/v1/bank-statements/lines/${line.id}/ignore`).expect(201)).body as LineBody;
    expect(ignored.status).toBe('IGNORED');

    const after = await ledgerBalances(treasurer.agent);
    expect(after.balances).toEqual(before.balances); // untouched

    // Allocated lines from test (c) cannot be ignored.
    const allocatedLine = await prisma.bankStatementLine.findFirstOrThrow({ where: { societyId, status: 'ALLOCATED' } });
    await treasurer.agent.post(`/api/v1/bank-statements/lines/${allocatedLine.id}/ignore`).expect(409);
  });

  it('(f) list paginates by cursor and supports If-None-Match 304', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-f-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    // Ensure at least 3 lines exist for this society (prior tests already added several).
    const firstPageRes = await treasurer.agent.get('/api/v1/bank-statements/lines?limit=2').expect(200);
    const firstPage = firstPageRes.body as LinesPageBody;
    expect(firstPage.items.length).toBeLessThanOrEqual(2);
    const etag = firstPageRes.headers['etag'] as string;
    expect(etag).toBeTruthy();

    const notModified = await treasurer.agent.get('/api/v1/bank-statements/lines?limit=2').set('If-None-Match', etag).expect(304);
    expect(notModified.body).toEqual({});

    if (firstPage.nextCursor) {
      const secondPageRes = await treasurer.agent.get(`/api/v1/bank-statements/lines?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`).expect(200);
      const secondPage = secondPageRes.body as LinesPageBody;
      const firstIds = new Set(firstPage.items.map((i) => i.id));
      expect(secondPage.items.every((i) => !firstIds.has(i.id))).toBe(true);
    }

    // status filter
    const allocatedOnly = (await treasurer.agent.get('/api/v1/bank-statements/lines?status=ALLOCATED').expect(200)).body as LinesPageBody;
    expect(allocatedOnly.items.every((i) => i.status === 'ALLOCATED')).toBe(true);
    expect(allocatedOnly.items.length).toBeGreaterThan(0);
  });

  it('(g) export returns a CSV with the import columns plus status/allocation columns', async () => {
    const treasurer = await signupAndLogin(`bs-treasurer-g-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const res = await treasurer.agent.get('/api/v1/bank-statements/export').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text as string;
    const firstLine = text.split('\n')[0];
    expect(firstLine).toBe('valueDate,amount,narration,reference,status,matchedFlatId,allocatedById,allocatedAt');
    expect(text.split('\n').filter((l) => l.length > 0).length).toBeGreaterThan(1);
  });
});
