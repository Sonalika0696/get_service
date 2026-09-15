import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Deterministic Phase 0 dev seed: one society, 90 flats, one committee
 * member (an owner-occupier), one plain owner-occupier, one owner-absentee
 * who delegates operational rights to their tenant, and one independent
 * tenant. Not the parameterised synthetic-society generator used by the
 * Python simulation harness (Phase 8) — this is just enough to develop and
 * demo against. Role mix matches BACKEND_PLAN.md's Phase 0 spec (DESIGN.md v0.4).
 */

const FLAT_COUNT = 90;
const BLOCKS = ['A', 'B', 'C'] as const;
const FLATS_PER_BLOCK = FLAT_COUNT / BLOCKS.length;
const FLATS_PER_FLOOR = 3;

function unitNoFor(indexWithinBlock: number): string {
  const floor = Math.floor(indexWithinBlock / FLATS_PER_FLOOR) + 1;
  const position = (indexWithinBlock % FLATS_PER_FLOOR) + 1;
  return `${floor}0${position}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    console.log('Seeding: society + flats...');

    const society = await prisma.society.upsert({
      where: { id: 'seed-test-society' },
      create: {
        id: 'seed-test-society',
        name: 'Test Society',
        address: '1 Demo Road, Bengaluru',
        latitude: 12.9716,
        longitude: 77.5946,
      },
      update: {},
    });

    const flats = [];
    for (const block of BLOCKS) {
      for (let i = 0; i < FLATS_PER_BLOCK; i++) {
        const unitNo = `${block}-${unitNoFor(i)}`;
        flats.push(
          prisma.flat.upsert({
            where: { societyId_unitNo: { societyId: society.id, unitNo } },
            create: { societyId: society.id, unitNo, maintenanceAmount: '3500.00' },
            update: {},
          }),
        );
      }
    }
    const createdFlats = await Promise.all(flats);
    console.log(`  ${createdFlats.length} flats ready.`);

    console.log('Seeding: users, occupancies, committee role...');

    const committeeOwner = await prisma.user.upsert({
      where: { email: 'committee@test-society.local' },
      create: { name: 'Asha Rao (Committee)', email: 'committee@test-society.local', kycTier: 'STANDARD' },
      update: {},
    });
    const owner2 = await prisma.user.upsert({
      where: { email: 'owner2@test-society.local' },
      create: { name: 'Vikram Shah', email: 'owner2@test-society.local', kycTier: 'STANDARD' },
      update: {},
    });
    const absenteeOwner = await prisma.user.upsert({
      where: { email: 'absentee-owner@test-society.local' },
      create: { name: 'Meera Iyer (lives abroad)', email: 'absentee-owner@test-society.local', kycTier: 'STANDARD' },
      update: {},
    });
    const delegateTenant = await prisma.user.upsert({
      where: { email: 'tenant1@test-society.local' },
      create: { name: 'Rahul Nair', email: 'tenant1@test-society.local', kycTier: 'LIGHT' },
      update: {},
    });
    const independentTenant = await prisma.user.upsert({
      where: { email: 'tenant2@test-society.local' },
      create: { name: 'Priya Menon', email: 'tenant2@test-society.local', kycTier: 'LIGHT' },
      update: {},
    });

    const [flatForCommittee, flatForOwner2, flatForAbsentee, flatForTenant2] = createdFlats;

    await Promise.all([
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-committee' },
        create: { id: 'seed-occ-committee', flatId: flatForCommittee.id, userId: committeeOwner.id, role: 'OWNER_OCCUPIER' },
        update: {},
      }),
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-owner2' },
        create: { id: 'seed-occ-owner2', flatId: flatForOwner2.id, userId: owner2.id, role: 'OWNER_OCCUPIER' },
        update: {},
      }),
      // Owner-absentee: owns flatForAbsentee, delegates operational rights to delegateTenant.
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-absentee-owner' },
        create: {
          id: 'seed-occ-absentee-owner',
          flatId: flatForAbsentee.id,
          userId: absenteeOwner.id,
          role: 'OWNER_ABSENTEE',
          delegatedToUserId: delegateTenant.id,
        },
        update: {},
      }),
      // The delegate tenant's own occupancy record on the same flat.
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-delegate-tenant' },
        create: { id: 'seed-occ-delegate-tenant', flatId: flatForAbsentee.id, userId: delegateTenant.id, role: 'TENANT' },
        update: {},
      }),
      // Independent tenant, unrelated flat, no delegation involved.
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-independent-tenant' },
        create: { id: 'seed-occ-independent-tenant', flatId: flatForTenant2.id, userId: independentTenant.id, role: 'TENANT' },
        update: {},
      }),
    ]);

    await prisma.role.upsert({
      where: { societyId_userId_kind: { societyId: society.id, userId: committeeOwner.id, kind: 'COMMITTEE' } },
      create: { societyId: society.id, userId: committeeOwner.id, kind: 'COMMITTEE' },
      update: {},
    });

    console.log('Seed complete:');
    console.log(`  society:          ${society.name} (${society.id})`);
    console.log(`  flats:            ${createdFlats.length}`);
    console.log(`  committee:        ${committeeOwner.email} (OWNER_OCCUPIER)`);
    console.log(`  owner-occupier:   ${owner2.email}`);
    console.log(`  owner-absentee:   ${absenteeOwner.email} -> delegates to ${delegateTenant.email}`);
    console.log(`  tenants:          ${[delegateTenant, independentTenant].map((u) => u.email).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
