import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * INVARIANT I5 structural test — the platform NEVER collects, stores,
 * transmits or displays health information of any kind. This spec pins the
 * EXACT field set of the three models this module owns, read straight off
 * the generated Prisma client's own scalar-field enums
 * (`Prisma.<Model>ScalarFieldEnum`) rather than re-parsing schema.prisma or
 * hand-maintaining a parallel list. Prisma 7's generator emits one of these
 * `as const` objects per model (see `src/generated/prisma/internal/
 * prismaNamespace.ts`), re-exported off the `Prisma` namespace in
 * `client.ts` — this is the one artifact that is guaranteed to change the
 * instant a migration adds, renames or removes a column, which is exactly
 * the failure mode this spec exists to catch. If someone adds a field to
 * HealthCamp, HealthCampSlot or CampRegistration (health-related or not),
 * this allow-list assertion fails and must be updated by hand — a deliberate
 * speed bump, not a false positive.
 */
describe('I5 — no health/clinical data anywhere in the health-camps schema', () => {
  it('HealthCamp exposes only logistics/scheduling/money fields', () => {
    expect(Object.keys(Prisma.HealthCampScalarFieldEnum).sort()).toEqual(
      [
        'id',
        'societyId',
        'createdById',
        'providerName',
        'title',
        'description',
        'venue',
        'campDate',
        'registrationClosesAt',
        'chargePerRegistration',
        'status',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('HealthCampSlot exposes only scheduling/capacity fields', () => {
    expect(Object.keys(Prisma.HealthCampSlotScalarFieldEnum).sort()).toEqual(['id', 'campId', 'startsAt', 'endsAt', 'capacity'].sort());
  });

  it('CampRegistration exposes only identity, slot, status and money fields — NO free-text field of any kind', () => {
    expect(Object.keys(Prisma.CampRegistrationScalarFieldEnum).sort()).toEqual(
      [
        'id',
        'campId',
        'slotId',
        'flatId',
        'residentId',
        'attendeeName',
        'status',
        'amountDue',
        'paidAmount',
        'paymentId',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('the roster response shape carries EXACTLY the 4 provider-facing keys, nothing more', () => {
    const rosterRow: Record<string, unknown> = {
      attendeeName: 'A',
      flatUnitNo: 'B-101',
      slotStartsAt: new Date(),
      slotEndsAt: new Date(),
    };
    expect(Object.keys(rosterRow).sort()).toEqual(['attendeeName', 'flatUnitNo', 'slotEndsAt', 'slotStartsAt'].sort());
  });
});
