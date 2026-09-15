import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';

/**
 * Exercises the hash-chained audit log against a real Postgres connection —
 * this is one of the dissertation's four novelty claims (DESIGN.md §1a.4),
 * so "the chain is internally consistent" and "tampering is detected" both
 * need to be proven against the actual database, not mocked.
 */
describe('AuditService (e2e)', () => {
  let app: INestApplication;
  let auditService: AuditService;
  let prisma: PrismaService;
  let societyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    auditService = app.get(AuditService);
    prisma = app.get(PrismaService);

    const society = await prisma.society.create({
      data: { name: 'Audit Test Society', address: 'n/a' },
    });
    societyId = society.id;
  });

  afterAll(async () => {
    // AuditLog.society is onDelete: Restrict (an audit trail should never
    // silently vanish with its society) — clean up rows first.
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.society.delete({ where: { id: societyId } });
    await app.close();
  });

  it('chains successive entries and verifies intact', async () => {
    await auditService.append({ societyId, actorId: 'user-1', action: 'TEST_ACTION_ONE', subjectType: 'Test', subjectId: 'a', payload: { n: 1 } });
    await auditService.append({ societyId, actorId: 'user-1', action: 'TEST_ACTION_TWO', subjectType: 'Test', subjectId: 'b', payload: { n: 2 } });
    await auditService.append({ societyId, actorId: null, action: 'TEST_ACTION_THREE', subjectType: 'Test', subjectId: 'c', payload: { n: 3 } });

    const result = await auditService.verifyChain(societyId);
    expect(result.ok).toBe(true);
    expect(result.verifiedThrough).toBe(3);
    expect(result.firstDivergence).toBeNull();
  });

  it('links each row to the previous row\'s entryHash, genesis-first', async () => {
    const rows = await prisma.auditLog.findMany({ where: { societyId }, orderBy: { sequence: 'asc' } });
    expect(Buffer.from(rows[0].previousHash).every((byte) => byte === 0)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(Buffer.from(rows[i].previousHash).equals(Buffer.from(rows[i - 1].entryHash))).toBe(true);
    }
  });

  it('stays a valid chain under concurrent appends to the same society (advisory lock)', async () => {
    const concurrentSociety = await prisma.society.create({ data: { name: 'Concurrency Test Society', address: 'n/a' } });

    const CONCURRENT_WRITES = 15;
    await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, (_, i) =>
        auditService.append({ societyId: concurrentSociety.id, actorId: null, action: 'CONCURRENT_TEST', subjectType: 'Test', subjectId: String(i), payload: { i } }),
      ),
    );

    const rows = await prisma.auditLog.findMany({ where: { societyId: concurrentSociety.id } });
    expect(rows.length).toBe(CONCURRENT_WRITES);

    // No two rows may chain off the same previousHash — that would mean the
    // advisory lock failed to serialise the read-tail/write-entry section.
    const previousHashes = rows.map((r) => Buffer.from(r.previousHash).toString('hex'));
    expect(new Set(previousHashes).size).toBe(CONCURRENT_WRITES);

    const result = await auditService.verifyChain(concurrentSociety.id);
    expect(result.ok).toBe(true);
    expect(result.verifiedThrough).toBe(CONCURRENT_WRITES);

    await prisma.auditLog.deleteMany({ where: { societyId: concurrentSociety.id } });
    await prisma.society.delete({ where: { id: concurrentSociety.id } });
  });

  it('detects tampering with a past row\'s payload', async () => {
    const rows = await prisma.auditLog.findMany({ where: { societyId }, orderBy: { sequence: 'asc' } });
    const firstRow = rows[0];

    // Bypass the app layer entirely — simulate someone editing the DB directly.
    await prisma.$executeRaw`UPDATE audit_logs SET payload = '{"n": 999}'::jsonb WHERE id = ${firstRow.id}`;

    const result = await auditService.verifyChain(societyId);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.id).toBe(firstRow.id);
  });
});
