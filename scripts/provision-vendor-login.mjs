#!/usr/bin/env node
/**
 * DEV-ONLY: provision a VENDOR-principal login for the demo.
 *
 * The seed creates only RESIDENT users, and vendors onboarded through the
 * app are Vendor *identities* with no linked login User — so the login
 * page's "Vendor" dev button has nothing to authenticate against. This
 * script attaches a User row (principalKind = VENDOR, vendorId -> a seeded
 * vendor that already has a society link) so `POST /auth/dev/login` with the
 * vendor email issues a real VENDOR session.
 *
 * Idempotent: safe to re-run. Uses the backend's generated Prisma client,
 * so run it from the repo root with the backend's tsx and DATABASE_URL:
 *   node --import tsx scripts/provision-vendor-login.mjs
 * (a thin wrapper — the actual work is in the dynamic import below so this
 *  file can stay .mjs while importing the .ts client through tsx).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, '..', 'backend');

// Load DATABASE_URL from backend/.env if not already set.
if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(backendDir, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL=(.*)$/);
    if (m) process.env.DATABASE_URL = m[1].trim();
  }
}

const VENDOR_LOGIN = {
  vendorName: 'CoolBreeze AC Services',
  email: 'vendor@coolbreeze.local',
  loginName: 'CoolBreeze AC Services',
};

const { PrismaClient } = await import(
  pathToFileURL(resolve(backendDir, 'src/generated/prisma/client.ts')).href
);
const { PrismaPg } = await import('@prisma/adapter-pg');

// Prisma 7 requires an explicit driver adapter (mirrors backend PrismaService).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const vendor = await prisma.vendor.findFirst({
    where: { name: VENDOR_LOGIN.vendorName },
    include: { societyLinks: true, linkedUser: true },
  });
  if (!vendor) {
    throw new Error(
      `Vendor "${VENDOR_LOGIN.vendorName}" not found. Run scripts/seed-demo.mjs first.`,
    );
  }
  if (vendor.societyLinks.length === 0) {
    console.warn(
      `  ! Vendor has no society links yet; the VENDOR session will have empty societyIds.`,
    );
  }

  if (vendor.linkedUser && vendor.linkedUser.email !== VENDOR_LOGIN.email) {
    console.log(`  ~ Vendor already linked to ${vendor.linkedUser.email}; leaving as-is.`);
    console.log(`\nVendor dev login: ${vendor.linkedUser.email}`);
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: VENDOR_LOGIN.email },
    update: { principalKind: 'VENDOR', vendorId: vendor.id, name: VENDOR_LOGIN.loginName },
    create: {
      name: VENDOR_LOGIN.loginName,
      email: VENDOR_LOGIN.email,
      principalKind: 'VENDOR',
      vendorId: vendor.id,
    },
  });

  console.log(`  + VENDOR login provisioned: ${user.email} -> vendor ${vendor.name} (${vendor.id})`);
  console.log(`    societies linked: ${vendor.societyLinks.length}`);
  console.log(`\nVendor dev login: ${user.email}`);
}

main()
  .catch((e) => {
    console.error('Provision failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
