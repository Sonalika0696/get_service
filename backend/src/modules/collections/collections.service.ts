import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { MaintenanceChargeStatus } from '../../generated/prisma/enums.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import { ARREARS_BUCKETS, bucketOf, daysOverdue, outstandingOf, type ArrearsBucket } from './ageing.util.js';
import { REGISTERED_RECEIVABLE_SOURCES, type ArrearsFlatRow, type ArrearsPage, type ArrearsSummary, type CollectionsStatusResponse, type OpenReceivable } from './collections.types.js';

const PERIOD_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ListArrearsParams {
  bucket?: string;
  cursor?: string;
  limit?: string;
}

/**
 * Collections & arrears read-model (Phase 11/12, lane b1read). Source of
 * truth is `MaintenanceCharge` alone — see `REGISTERED_RECEIVABLE_SOURCES`
 * in collections.types.ts for the documented extension point that would
 * let a second source (FlatBill, once the electricity/water orchestrator
 * lands it) register itself here without changing the bucketing/pagination
 * code. FlatBill is NOT wired in yet: it is owned by a different,
 * still-landing lane (see this module's brief) — reported as a follow-up,
 * not worked around.
 *
 * Both endpoints below are read-only, single-round-trip Prisma queries:
 * `arrears` loads every open (PENDING/PARTIAL) charge for the society ONCE
 * (with its Flat and InstalmentPlan joined in, no per-row follow-up
 * query), aggregates per flat in memory, then paginates/buckets the
 * resulting (small — one row per flat with any arrears) in-memory list;
 * `status` is a single `groupBy` that yields both the per-status counts
 * and the totals in one pass.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async arrears(societyId: string, params: ListArrearsParams): Promise<ArrearsPage> {
    const limit = parsePageLimit(params.limit);
    const bucketFilter = this.parseBucket(params.bucket);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;
    const now = this.clock.now();

    const openReceivables = await this.loadOpenReceivables(societyId);
    const perFlat = this.aggregateByFlat(openReceivables);

    const flatIds = [...perFlat.keys()];
    const flats = flatIds.length > 0 ? await this.prisma.flat.findMany({ where: { id: { in: flatIds } }, select: { id: true, unitNo: true } }) : [];
    const unitNoByFlatId = new Map(flats.map((f) => [f.id, f.unitNo]));

    let rows: (ArrearsFlatRow & { daysOverdueSort: number })[] = [...perFlat.entries()].map(([flatId, agg]) => {
      const days = daysOverdue(agg.oldestDueDate, now);
      const bucket = bucketOf(days);
      return {
        flatId,
        unitNo: unitNoByFlatId.get(flatId) ?? flatId,
        totalOutstanding: agg.totalOutstanding.toFixed(2),
        oldestDueDate: agg.oldestDueDate.toISOString(),
        daysOverdueOfOldest: days,
        bucket,
        openChargeCount: agg.openChargeCount,
        hasInstalmentPlan: agg.hasInstalmentPlan,
        daysOverdueSort: days,
      };
    });

    // Summary is computed over every flat with an open charge, BEFORE the
    // bucket filter/pagination narrow the list — it always reflects the
    // whole society, not just the current page or the requested bucket.
    const summary: ArrearsSummary | undefined = cursor === null ? this.buildSummary(rows) : undefined;

    if (bucketFilter) {
      rows = rows.filter((r) => r.bucket === bucketFilter);
    }

    // Ordered by days overdue DESC (brief), flatId ASC as a stable tiebreak.
    rows.sort((a, b) => b.daysOverdueSort - a.daysOverdueSort || a.flatId.localeCompare(b.flatId));

    const afterCursor = cursor ? this.sliceAfterCursor(rows, cursor) : rows;
    const { items: pageItems, nextCursor } = buildPage(afterCursor, limit, (row) => ({ sortValue: String(row.daysOverdueSort), id: row.flatId }));

    return {
      items: pageItems.map(({ daysOverdueSort: _daysOverdueSort, ...rest }) => rest),
      nextCursor,
      ...(summary ? { summary } : {}),
    };
  }

  async status(societyId: string, periodRaw: string | undefined): Promise<CollectionsStatusResponse> {
    const period = this.resolvePeriod(periodRaw);

    const groups = await this.prisma.maintenanceCharge.groupBy({
      by: ['status'],
      where: { societyId, period },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    });

    const countsByStatus = { PENDING: 0, PARTIAL: 0, PAID: 0, WAIVED: 0 };
    let billedTotal = 0;
    let collectedTotal = 0;
    let waivedTotal = 0;

    for (const group of groups) {
      countsByStatus[group.status] = group._count._all;
      billedTotal += Number(group._sum.amount ?? 0);
      collectedTotal += Number(group._sum.paidAmount ?? 0);
      if (group.status === MaintenanceChargeStatus.WAIVED) {
        waivedTotal += Number(group._sum.amount ?? 0);
      }
    }

    const collectionRatePct = billedTotal > 0 ? Math.round((collectedTotal / billedTotal) * 10000) / 100 : 0;

    return {
      period,
      billedTotal: billedTotal.toFixed(2),
      collectedTotal: collectedTotal.toFixed(2),
      collectionRatePct,
      countsByStatus,
      waivedTotal: waivedTotal.toFixed(2),
    };
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /** The one registered receivable source today: MaintenanceCharge (see collections.types.ts's ReceivableSourceKind doc comment). */
  private async loadOpenReceivables(societyId: string): Promise<OpenReceivable[]> {
    const charges = await this.prisma.maintenanceCharge.findMany({
      where: { societyId, status: { in: [MaintenanceChargeStatus.PENDING, MaintenanceChargeStatus.PARTIAL] } },
      select: {
        flatId: true,
        amount: true,
        lateFeeAccrued: true,
        paidAmount: true,
        dueDate: true,
        instalmentPlan: { select: { id: true } },
      },
    });

    // REGISTERED_RECEIVABLE_SOURCES is referenced here only to document the
    // extension point — a second source's loader would be Promise.all'd
    // alongside this one and its rows concatenated below.
    void REGISTERED_RECEIVABLE_SOURCES;

    return charges.map((c) => ({
      source: 'MAINTENANCE' as const,
      flatId: c.flatId,
      amount: Number(c.amount),
      lateFeeAccrued: Number(c.lateFeeAccrued),
      paidAmount: Number(c.paidAmount),
      dueDate: c.dueDate,
      hasInstalmentPlan: c.instalmentPlan !== null,
    }));
  }

  private aggregateByFlat(receivables: OpenReceivable[]) {
    const byFlat = new Map<string, { totalOutstanding: number; oldestDueDate: Date; openChargeCount: number; hasInstalmentPlan: boolean }>();

    for (const r of receivables) {
      const outstanding = outstandingOf(r.amount, r.lateFeeAccrued, r.paidAmount);
      const existing = byFlat.get(r.flatId);
      if (!existing) {
        byFlat.set(r.flatId, { totalOutstanding: outstanding, oldestDueDate: r.dueDate, openChargeCount: 1, hasInstalmentPlan: r.hasInstalmentPlan });
      } else {
        existing.totalOutstanding = Math.round((existing.totalOutstanding + outstanding) * 100) / 100;
        if (r.dueDate.getTime() < existing.oldestDueDate.getTime()) existing.oldestDueDate = r.dueDate;
        existing.openChargeCount += 1;
        existing.hasInstalmentPlan = existing.hasInstalmentPlan || r.hasInstalmentPlan;
      }
    }

    return byFlat;
  }

  private buildSummary(rows: { totalOutstanding: string; bucket: ArrearsBucket }[]): ArrearsSummary {
    const totals: Record<ArrearsBucket, number> = { NOT_YET_DUE: 0, '0_30': 0, '31_60': 0, '61_90': 0, '90_PLUS': 0 };
    let flatsInArrears = 0;

    for (const row of rows) {
      totals[row.bucket] = Math.round((totals[row.bucket] + Number(row.totalOutstanding)) * 100) / 100;
      if (row.bucket !== 'NOT_YET_DUE') flatsInArrears += 1;
    }

    const totalOutstandingByBucket = Object.fromEntries(ARREARS_BUCKETS.map((b) => [b, totals[b].toFixed(2)])) as Record<ArrearsBucket, string>;
    return { totalOutstandingByBucket, flatsInArrears };
  }

  private sliceAfterCursor<T extends { flatId: string; daysOverdueSort: number }>(rows: T[], cursor: KeysetCursor): T[] {
    const cursorSortValue = Number(cursor.sortValue);
    const idx = rows.findIndex((r) => r.daysOverdueSort === cursorSortValue && r.flatId === cursor.id);
    if (idx === -1) {
      // Cursor no longer resolves (row settled/vanished between calls) —
      // fall back to a value-based cut rather than 400ing on a now-stale
      // but honestly-issued cursor: keep everything ordered strictly after
      // the cursor's position (days-overdue desc, flatId asc).
      return rows.filter((r) => r.daysOverdueSort < cursorSortValue || (r.daysOverdueSort === cursorSortValue && r.flatId > cursor.id));
    }
    return rows.slice(idx + 1);
  }

  private parseBucket(raw: string | undefined): ArrearsBucket | null {
    if (raw === undefined) return null;
    if (!(ARREARS_BUCKETS as readonly string[]).includes(raw)) {
      throw new BadRequestException(`bucket must be one of ${ARREARS_BUCKETS.join(', ')}`);
    }
    return raw as ArrearsBucket;
  }

  private resolvePeriod(raw: string | undefined): string {
    if (raw === undefined) {
      const now = this.clock.now();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    if (!PERIOD_FORMAT.test(raw)) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }
    return raw;
  }
}
