import type { ArrearsBucket } from './ageing.util.js';

/**
 * "Receivable sources" extension point (brief §2, "Utility bills (FlatBill)
 * are deliberately NOT included"). Today MAINTENANCE is the only
 * registered source — FlatBill (electricity/water) is owned by another
 * still-landing orchestrator lane and deliberately excluded (see
 * CollectionsService's doc comment). Registering a second source later
 * means: (1) add its kind here, (2) add a loader that shapes its rows into
 * the same `OpenReceivable` shape ageing.util.ts already consumes, (3) sum
 * every registered source's loader output before bucketing. Nothing else
 * in this module (the util, the controller, the pagination) needs to
 * change.
 */
export type ReceivableSourceKind = 'MAINTENANCE';

export const REGISTERED_RECEIVABLE_SOURCES: readonly ReceivableSourceKind[] = ['MAINTENANCE'];

/** One open (PENDING/PARTIAL) obligation, source-agnostic — see ReceivableSourceKind's doc comment. */
export interface OpenReceivable {
  source: ReceivableSourceKind;
  flatId: string;
  amount: number;
  lateFeeAccrued: number;
  paidAmount: number;
  dueDate: Date;
  hasInstalmentPlan: boolean;
}

export interface ArrearsFlatRow {
  flatId: string;
  unitNo: string;
  totalOutstanding: string;
  oldestDueDate: string;
  daysOverdueOfOldest: number;
  bucket: ArrearsBucket;
  openChargeCount: number;
  hasInstalmentPlan: boolean;
}

export interface ArrearsSummary {
  totalOutstandingByBucket: Record<ArrearsBucket, string>;
  flatsInArrears: number;
}

export interface ArrearsPage {
  items: ArrearsFlatRow[];
  nextCursor: string | null;
  /** Only present on the first page (no cursor supplied). */
  summary?: ArrearsSummary;
}

export interface CollectionsStatusResponse {
  period: string;
  billedTotal: string;
  collectedTotal: string;
  collectionRatePct: number;
  countsByStatus: { PENDING: number; PARTIAL: number; PAID: number; WAIVED: number };
  waivedTotal: string;
}
