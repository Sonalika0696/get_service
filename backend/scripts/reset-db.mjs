#!/usr/bin/env node
/**
 * Dedupe/clean step for the shared dev DB.
 *
 * The dev DB had accumulated leftover rows from repeated ad-hoc runs of
 * scripts/seed-demo.mjs, scripts/stress-seed.mjs, scripts/provision-vendor-login.mjs,
 * the old prisma/seed/seed.ts ("Test Society"), and e2e-test / benchmark runs
 * that point at the same DATABASE_URL as dev (two "Audit Verify Tamper
 * Society" rows, four "Realtime Society A/B ..." rows, thousands of stray
 * idempotency_keys from a webhook benchmark, etc). None of that data matches
 * the new canonical seed's identifiers, so patching it in place would still
 * leave every one of those old rows behind as orphans/duplicates.
 *
 * This script TRUNCATEs every application table (everything except Prisma's
 * own `_prisma_migrations`) in one statement — Postgres resolves FK order
 * for us with CASCADE, so there is no manual dependency-order list to keep in
 * sync with the schema. It is intentionally blunt: the task authorized a full
 * wipe of this dev-only database ("It's all dev data — safe to delete"), and
 * a full wipe is the only way to guarantee zero leftover duplicates/orphans
 * before scripts/seed-comprehensive.mjs rebuilds the canonical dataset.
 *
 * Usage: node scripts/reset-db.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL=(.*)$/);
    if (m) process.env.DATABASE_URL = m[1].trim();
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  const tablesRes = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations'
    order by table_name
  `);
  const tables = tablesRes.rows.map((r) => r.table_name);

  console.log('BEFORE counts:');
  for (const t of tables) {
    const r = await client.query(`select count(*)::int as c from "${t}"`);
    console.log(`  ${t.padEnd(30)} ${r.rows[0].c}`);
  }

  const list = tables.map((t) => `"${t}"`).join(', ');
  console.log('\nTruncating (CASCADE) all application tables...');
  await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  console.log('\nAFTER counts (should all be 0):');
  for (const t of tables) {
    const r = await client.query(`select count(*)::int as c from "${t}"`);
    console.log(`  ${t.padEnd(30)} ${r.rows[0].c}`);
  }

  await client.end();
  console.log('\nDB reset complete.');
}

main().catch((e) => {
  console.error('reset-db failed:', e);
  process.exitCode = 1;
});
