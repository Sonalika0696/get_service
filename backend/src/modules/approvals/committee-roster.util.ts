import type { Prisma } from '../../generated/prisma/client.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * DUPLICATED business rule — re-derive at integration. This is a verbatim
 * copy of `BulkBuyService.committeeRosterSize` (private, not exported —
 * see PocketTransfersService's own copy of the same helper, which documents
 * the same constraint) and `PocketTransfersService.committeeRosterSize`.
 * The count of DISTINCT users holding at least one of
 * COMMITTEE/TREASURER/DEPUTY_TREASURER in a society right now. Every module
 * that reads the approval ladder currently duplicates this tiny query
 * because bulk-buy never exported it; if it ever does, all three copies
 * (bulk-buy's own, pocket-transfers', and this one) should collapse to one
 * shared helper.
 */
export async function committeeRosterSize(client: Prisma.TransactionClient | PrismaService, societyId: string): Promise<number> {
  const officers = await client.role.findMany({
    where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return officers.length;
}
