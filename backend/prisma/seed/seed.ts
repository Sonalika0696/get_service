import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Deterministic Phase 0 dev seed: one society, 90 flats, one committee
 * member, three owner-residents (the committee member is one of them),
 * two tenants. Not the parameterised synthetic-society generator used by
 * the Python simulation harness (Phase 8) — this is just enough to develop
 * and demo against.
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
    const owner3 = await prisma.user.upsert({
      where: { email: 'owner3@test-society.local' },
      create: { name: 'Meera Iyer', email: 'owner3@test-society.local', kycTier: 'STANDARD' },
      update: {},
    });
    const tenant1 = await prisma.user.upsert({
      where: { email: 'tenant1@test-society.local' },
      create: { name: 'Rahul Nair', email: 'tenant1@test-society.local', kycTier: 'LIGHT' },
      update: {},
    });
    const tenant2 = await prisma.user.upsert({
      where: { email: 'tenant2@test-society.local' },
      create: { name: 'Priya Menon', email: 'tenant2@test-society.local', kycTier: 'LIGHT' },
      update: {},
    });

    const [flatForCommittee, flatForOwner2, flatForOwner3, flatForTenant1, flatForTenant2] = createdFlats;

    await Promise.all([
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-committee' },
        create: { id: 'seed-occ-committee', flatId: flatForCommittee.id, userId: committeeOwner.id, role: 'OWNER' },
        update: {},
      }),
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-owner2' },
        create: { id: 'seed-occ-owner2', flatId: flatForOwner2.id, userId: owner2.id, role: 'OWNER' },
        update: {},
      }),
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-owner3' },
        create: { id: 'seed-occ-owner3', flatId: flatForOwner3.id, userId: owner3.id, role: 'OWNER' },
        update: {},
      }),
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-tenant1' },
        create: { id: 'seed-occ-tenant1', flatId: flatForTenant1.id, userId: tenant1.id, role: 'TENANT' },
        update: {},
      }),
      prisma.occupancy.upsert({
        where: { id: 'seed-occ-tenant2' },
        create: { id: 'seed-occ-tenant2', flatId: flatForTenant2.id, userId: tenant2.id, role: 'TENANT' },
        update: {},
      }),
    ]);

    await prisma.role.upsert({
      where: { societyId_userId_kind: { societyId: society.id, userId: committeeOwner.id, kind: 'COMMITTEE' } },
      create: { societyId: society.id, userId: committeeOwner.id, kind: 'COMMITTEE' },
      update: {},
    });

    console.log('Seed complete:');
    console.log(`  society:   ${society.name} (${society.id})`);
    console.log(`  flats:     ${createdFlats.length}`);
    console.log(`  committee: ${committeeOwner.email}`);
    console.log(`  owners:    ${[committeeOwner, owner2, owner3].map((u) => u.email).join(', ')}`);
    console.log(`  tenants:   ${[tenant1, tenant2].map((u) => u.email).join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
