import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RatificationStatus, SocietyStatus } from '../../generated/prisma/enums.js';
import { LedgerService, type AccountBalance } from '../ledger/ledger.service.js';

export interface SocietyDashboardKpis {
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
  accountBalances: { kind: AccountBalance['kind']; balance: string }[];
}

export interface OperatorDashboardKpis {
  societies: { active: number; total: number };
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
}

/**
 * Dashboard KPI aggregate (schema-free — BACKEND_PLAN.md web-console
 * follow-up). Gives the web console's top-row counts in one call instead of
 * composing GET /operator/societies + GET /vendors + GET
 * /society/:sid/ratifications + GET /ledger client-side.
 *
 * Deliberately reads Prisma directly for the plain counts rather than
 * injecting VendorsService/RatificationService/OccupancyService: none of
 * those modules export their service (VendorsModule, SocietyModule keep
 * them controller-local), and this phase's brief scopes changes to
 * `modules/dashboard/*` + `app.module.ts` only — widening another lane's
 * module exports is out of scope for a schema-free, read-only aggregate.
 * The queries below intentionally mirror each source service's own
 * filter exactly (see the comment on each query) so the counts here can
 * never drift from what those routes themselves would return:
 *   - flats:                Flat rows for the society (operator FlatsService's scope)
 *   - vendors:               Vendor rows for the society (VendorsService.listForSociety's base filter)
 *   - pendingRatifications:  mirrors RatificationService.listPending's exact where-clause
 *   - residents:             DISTINCT users with a live, ratified occupancy (see residents' doc comment below)
 *
 * LedgerService.balances(societyId) — the one genuinely cross-lane read
 * that isn't a plain count — IS reused directly, since LedgerModule
 * already exports it for exactly this kind of composition (see
 * LedgerModule's doc comment: "so Phase 4B ... can inject the posting
 * primitive ... without duplicating them").
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async societyKpis(societyId: string): Promise<SocietyDashboardKpis> {
    const [flats, residents, vendors, pendingRatifications, balances] = await Promise.all([
      this.prisma.flat.count({ where: { societyId } }),
      this.countResidents({ flat: { societyId } }),
      this.prisma.vendor.count({ where: { societyId } }),
      this.prisma.occupancy.count({ where: { flat: { societyId }, ratificationStatus: RatificationStatus.PENDING } }),
      this.ledgerService.balances(societyId),
    ]);

    return {
      flats,
      residents,
      vendors,
      pendingRatifications,
      accountBalances: balances.map(({ kind, balance }) => ({ kind, balance })),
    };
  }

  async operatorKpis(): Promise<OperatorDashboardKpis> {
    const [total, active, flats, residents, vendors, pendingRatifications] = await Promise.all([
      this.prisma.society.count(),
      this.prisma.society.count({ where: { status: SocietyStatus.ACTIVE } }),
      this.prisma.flat.count(),
      this.countResidents({}),
      this.prisma.vendor.count(),
      this.prisma.occupancy.count({ where: { ratificationStatus: RatificationStatus.PENDING } }),
    ]);

    return {
      societies: { active, total },
      flats,
      residents,
      vendors,
      pendingRatifications,
    };
  }

  /**
   * "Residents" = DISTINCT users with a live (tenureEndedAt: null),
   * RATIFIED occupancy — not a raw Occupancy row count. A single user can
   * in principle hold more than one occupancy (e.g. two flats), so
   * counting occupancies would over-count actual residents; v1 assumes one
   * active occupancy per user (see ResidentPrincipal's doc comment) so in
   * practice the two numbers coincide today, but this stays
   * occupancy-distinct-by-userId so it doesn't silently drift once that
   * assumption changes. Excludes PENDING/REJECTED (not yet a real
   * resident) and any occupancy that has moved out.
   */
  private async countResidents(scope: { flat?: { societyId: string } }): Promise<number> {
    const rows = await this.prisma.occupancy.findMany({
      where: { ...scope, ratificationStatus: RatificationStatus.RATIFIED, tenureEndedAt: null },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.length;
  }
}
