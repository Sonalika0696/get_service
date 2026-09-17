import { AccountKind } from '../../generated/prisma/enums.js';

/**
 * The Phase 9.1 sub-ledger pockets a treasurer may allocate a bank-statement
 * credit line into (see AccountKind's doc comment in schema.prisma for the
 * full enum, which also carries non-pocket kinds like SOCIETY_MASTER/
 * BULK_BUY/EXTERNAL/VENDOR/RETENTION that this allocate action must never
 * target — those are posted to by their own dedicated flows, not a bank-
 * statement allocation). Shared by AllocateBankStatementLineDto's `@IsIn`
 * and BankStatementsService.allocate's own defensive check.
 */
export const POCKET_KINDS = [
  AccountKind.MAINTENANCE,
  AccountKind.ELECTRICITY,
  AccountKind.WATER,
  AccountKind.EVENTS,
  AccountKind.WELFARE,
  AccountKind.SINKING,
  AccountKind.CORPUS,
] as const;

export type PocketKind = (typeof POCKET_KINDS)[number];
