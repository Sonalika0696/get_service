import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RatificationStatus } from '../../generated/prisma/enums.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';

export type BillKind = 'MAINTENANCE' | 'PROCUREMENT' | 'ELECTRICITY' | 'WATER' | 'EVENT' | 'HEALTH_CAMP';

const BILL_KINDS: readonly BillKind[] = ['MAINTENANCE', 'PROCUREMENT', 'ELECTRICITY', 'WATER', 'EVENT', 'HEALTH_CAMP'];

/** Uniform projection every arm of the UNION produces — see BillsService.list's doc comment. */
export interface BillLine {
  id: string;
  kind: BillKind;
  title: string;
  /** Short label — a maintenance charge's billing period ('YYYY-MM') or a procurement item's scope. */
  label: string;
  /** Decimal amounts are returned as strings (matching DashboardService's `accountBalances` convention) to avoid float precision loss on money. */
  amountDue: string;
  amountPaid: string;
  status: string;
  dueDate: string | null;
  /** Short human-readable basis for why this line exists. */
  basis: string;
  evidenceType: string;
  evidenceId: string;
}

export interface BillsPage {
  items: BillLine[];
  nextCursor: string | null;
}

export interface ListBillsParams {
  cursor?: string;
  limit?: string;
  kind?: string;
}

/** Raw shape returned by the `$queryRaw` UNION — one row per bill line, before dueDate is stringified. */
interface RawBillRow {
  id: string;
  kind: string;
  title: string;
  label: string;
  amountDue: string;
  amountPaid: string;
  status: string;
  dueDate: Date | null;
  basis: string;
  evidenceType: string;
  evidenceId: string;
}

/**
 * Phase 9.3 — `GET /me/bills`: a resident-facing unified bills list,
 * derived-on-read (no new ledger/billing tables of its own) via one
 * `$queryRaw` UNION ALL over the resident's existing obligations:
 *
 *  - MAINTENANCE arm: `maintenance_charges` rows for the resident's own
 *    flat(s) (Phase 9.2 — one row per flat per billing period).
 *  - PROCUREMENT arm: the resident's bulk-buy / service-request
 *    contributions, read off the `JobCard → Commitment → Payment` chain
 *    (see BulkBuyService.createBookingWithEscrow — one JobCard + one escrow
 *    Payment per resident per fired booking/poll). Scoped by
 *    `job_cards.residentId`, not by flat, since a JobCard is already
 *    per-resident.
 *
 * A third arm (added in Phase 10 CAPSTONE) covers utility bills:
 *  - ELECTRICITY/WATER arm: Phase 10's `flat_bills` rows for the resident's
 *    own flat(s), joined to their `billing_cycles` row to read `utility`
 *    (ELECTRICITY vs WATER become the two distinct `kind` values) and to
 *    gate on `stage = 'PUBLISHED'` — an unpublished (still-running or
 *    halted) cycle's bills are never a resident-facing obligation yet, same
 *    as MaintenanceBillingService only ever creating a charge once it
 *    decides to (there's no "draft" MaintenanceCharge state to filter out,
 *    but a FlatBill genuinely can exist in the DB before its cycle
 *    publishes — see BillingCycleService's compute/apportion stages, which
 *    build the row up progressively ahead of the publish stage).
 *
 * Two more arms (Phase 11/12) cover per-flat collections residents opt into:
 *  - EVENT arm: `event_registrations` for the resident's flat(s) with a
 *    non-zero per-flat charge, shown while it is an obligation (CONFIRMED)
 *    or once money has moved (paidAmount > 0, e.g. later refunded after a
 *    withdrawal or cancellation), so the hub doubles as statement history.
 *    A WAITLISTED flat owes nothing until promoted and a free event is not
 *    a bill, so neither appears. Due date = the event's start.
 *  - HEALTH_CAMP arm: `camp_registrations` with a non-zero charge, on the
 *    same "obligation or money moved" rule. Due date = the camp date. Only
 *    identity/slot/money columns are read (SDD invariant I5: nothing about
 *    health exists to read).
 *
 * All arms project the SAME 11 columns (see BillLine) so a future arm
 * (events, ...) slots in as one more `UNION ALL SELECT ...` block inside the
 * `bills` CTE below — the WHERE/ORDER BY/pagination wrapper around it never
 * needs to change. See the inline comment marking where that block goes.
 *
 * Pagination/ETag: uses the reusable `src/common/pagination/*` helpers —
 * keyset cursor over `dueDate DESC NULLS LAST, id DESC` (a resident's
 * flat(s) and contribution set are both small and effectively static per
 * request, so this ordering is stable across pages), ETag = sha256 of the
 * serialized page. NULLs (every PROCUREMENT row has no dueDate) sort last
 * via the `COALESCE(..., '-infinity')` trick — see the query below.
 */
@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: ResidentPrincipal, params: ListBillsParams): Promise<BillsPage> {
    const limit = parsePageLimit(params.limit);
    const kind = this.parseKind(params.kind);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    // A resident may (in principle) hold more than one ratified occupancy —
    // see DashboardService.countResidents's doc comment on the same v1
    // assumption. Scope MAINTENANCE to every flat the resident is
    // currently, validly occupying; a lapsed/pending occupancy's flat never
    // contributes a line.
    const occupancies = await this.prisma.occupancy.findMany({
      where: { userId: currentUser.id, ratificationStatus: RatificationStatus.RATIFIED, tenureEndedAt: null },
      select: { flatId: true },
    });
    const flatIds = [...new Set(occupancies.map((o) => o.flatId))];
    if (flatIds.length === 0) {
      // No ratified occupancy at all — nothing to bill against. (In
      // practice AuthGuard/UserContextService already require a ratified
      // occupancy to mint a ResidentPrincipal in the first place, so this
      // is a defensive empty page, not the normal path.)
      return { items: [], nextCursor: null };
    }

    const kindFilter = kind ? Prisma.sql`AND kind = ${kind}` : Prisma.empty;

    const cursorSortValue = cursor ? (cursor.sortValue === null ? null : new Date(cursor.sortValue)) : null;
    const cursorFilter = cursor
      ? Prisma.sql`
          AND (
            COALESCE("dueDate", '-infinity'::timestamptz) < COALESCE(${cursorSortValue}::timestamptz, '-infinity'::timestamptz)
            OR (
              COALESCE("dueDate", '-infinity'::timestamptz) = COALESCE(${cursorSortValue}::timestamptz, '-infinity'::timestamptz)
              AND id < ${cursor.id}
            )
          )
        `
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawBillRow[]>(Prisma.sql`
      WITH bills AS (
        -- ---------------------------------------------------------------
        -- MAINTENANCE arm: derived monthly obligations for this
        -- resident's own flat(s) (Phase 9.2's MaintenanceCharge).
        -- ---------------------------------------------------------------
        SELECT
          mc.id                                       AS id,
          'MAINTENANCE'::text                          AS kind,
          ('Maintenance charge – ' || mc.period)       AS title,
          mc.period                                    AS label,
          (mc.amount + mc."lateFeeAccrued")::text      AS "amountDue",
          mc."paidAmount"::text                        AS "amountPaid",
          mc.status::text                              AS status,
          mc."dueDate"                                 AS "dueDate",
          'Monthly maintenance charge'                 AS basis,
          'MaintenanceCharge'                          AS "evidenceType",
          mc.id                                        AS "evidenceId"
        FROM maintenance_charges mc
        WHERE mc."flatId" IN (${Prisma.join(flatIds)})

        UNION ALL

        -- ---------------------------------------------------------------
        -- PROCUREMENT arm: this resident's bulk-buy / service-request
        -- contributions — one JobCard (+ its escrow Payment via
        -- Commitment.paymentId) per fired booking/poll this resident
        -- joined. No due date concept exists for these today, so dueDate
        -- is NULL (sorts last — see the outer ORDER BY).
        -- ---------------------------------------------------------------
        SELECT
          jc.id                                        AS id,
          'PROCUREMENT'::text                           AS kind,
          jc.scope                                      AS title,
          jc.scope                                      AS label,
          jc."unitPrice"::text                          AS "amountDue",
          (CASE WHEN p.status = 'CAPTURED' THEN jc."unitPrice" ELSE 0 END)::text AS "amountPaid",
          (CASE
            WHEN p.status = 'CAPTURED' THEN 'PAID'
            WHEN p.status = 'REFUNDED' THEN 'REFUNDED'
            WHEN p.status = 'FAILED' THEN 'FAILED'
            ELSE 'PENDING'
          END)                                          AS status,
          NULL::timestamptz                             AS "dueDate",
          'Procurement contribution (bulk-buy / service request)' AS basis,
          'JobCard'                                     AS "evidenceType",
          jc.id                                         AS "evidenceId"
        FROM job_cards jc
        JOIN commitments c ON c.id = jc."commitmentId"
        LEFT JOIN payments p ON p.id = c."paymentId"
        WHERE jc."residentId" = ${currentUser.id}

        UNION ALL

        -- ---------------------------------------------------------------
        -- ELECTRICITY/WATER arm (Phase 10 CAPSTONE): this resident's own
        -- flat(s)' published utility bills. kind is the cycle's own
        -- utility column (ELECTRICITY or WATER) -- no CASE needed, the
        -- enum values already match the BillKind strings this endpoint
        -- accepts. No due-date concept exists on FlatBill today (unlike
        -- MaintenanceCharge), so dueDate is NULL, same as the PROCUREMENT
        -- arm above (sorts last -- see the outer ORDER BY).
        -- ---------------------------------------------------------------
        SELECT
          fb.id                                          AS id,
          bc.utility::text                                AS kind,
          (INITCAP(LOWER(bc.utility::text)) || ' bill – ' || bc.period) AS title,
          bc.period                                       AS label,
          fb.amount::text                                 AS "amountDue",
          fb."paidAmount"::text                           AS "amountPaid",
          fb.status::text                                 AS status,
          NULL::timestamptz                               AS "dueDate",
          (CASE WHEN fb.basis = 'FALLBACK' THEN 'Apportioned common-area charge (no sub-meter on file)' ELSE 'Metered utility consumption charge' END) AS basis,
          'FlatBill'                                       AS "evidenceType",
          fb.id                                            AS "evidenceId"
        FROM flat_bills fb
        JOIN billing_cycles bc ON bc.id = fb."billingCycleId"
        WHERE fb."flatId" IN (${Prisma.join(flatIds)})
          AND bc.stage = 'PUBLISHED'

        UNION ALL

        -- ---------------------------------------------------------------
        -- EVENT arm (Phase 11, M8): paid event opt-ins for this resident's
        -- flat(s). Status is derived from the money actually moved rather
        -- than echoed from the registration, so the hub shows a
        -- payment-oriented status consistent with the other arms.
        -- ---------------------------------------------------------------
        SELECT
          er.id                                          AS id,
          'EVENT'::text                                   AS kind,
          ('Event – ' || e.title)                         AS title,
          e.title                                         AS label,
          er."amountDue"::text                            AS "amountDue",
          er."paidAmount"::text                           AS "amountPaid",
          (CASE
            WHEN er.status IN ('WITHDRAWN', 'CANCELLED') AND er."paidAmount" > 0 AND er."refundedAmount" >= er."paidAmount" THEN 'REFUNDED'
            WHEN er.status IN ('WITHDRAWN', 'CANCELLED') THEN er.status::text
            WHEN er."paidAmount" >= er."amountDue" THEN 'PAID'
            WHEN er."paidAmount" > 0 THEN 'PARTIAL'
            ELSE 'PENDING'
          END)                                            AS status,
          e."startsAt"                                    AS "dueDate",
          'Event opt-in charge (per flat)'                AS basis,
          'EventRegistration'                             AS "evidenceType",
          er.id                                           AS "evidenceId"
        FROM event_registrations er
        JOIN events e ON e.id = er."eventId"
        WHERE er."flatId" IN (${Prisma.join(flatIds)})
          AND er."amountDue" > 0
          AND (er.status = 'CONFIRMED' OR er."paidAmount" > 0)

        UNION ALL

        -- ---------------------------------------------------------------
        -- HEALTH_CAMP arm (Phase 12, M9): paid camp registrations for this
        -- resident's flat(s). CampRegistration has no refundedAmount, so a
        -- cancelled paid registration reports CANCELLED (its full refund is
        -- initiated by the health-camps module on cancellation).
        -- ---------------------------------------------------------------
        SELECT
          cr.id                                          AS id,
          'HEALTH_CAMP'::text                             AS kind,
          ('Health camp – ' || hc.title)                  AS title,
          cr."attendeeName"                               AS label,
          cr."amountDue"::text                            AS "amountDue",
          cr."paidAmount"::text                           AS "amountPaid",
          (CASE
            WHEN cr.status = 'CANCELLED' THEN 'CANCELLED'
            WHEN cr."paidAmount" >= cr."amountDue" THEN 'PAID'
            WHEN cr."paidAmount" > 0 THEN 'PARTIAL'
            ELSE 'PENDING'
          END)                                            AS status,
          hc."campDate"                                   AS "dueDate",
          'Health camp registration charge'               AS basis,
          'CampRegistration'                              AS "evidenceType",
          cr.id                                           AS "evidenceId"
        FROM camp_registrations cr
        JOIN health_camps hc ON hc.id = cr."campId"
        WHERE cr."flatId" IN (${Prisma.join(flatIds)})
          AND cr."amountDue" > 0
          AND (cr.status = 'REGISTERED' OR cr."paidAmount" > 0)

        -- ---------------------------------------------------------------
        -- FUTURE ARMS slot in here: one more UNION ALL
        -- SELECT producing the SAME 11 columns (id, kind, title, label,
        -- "amountDue", "amountPaid", status, "dueDate", basis,
        -- "evidenceType", "evidenceId"). Nothing below this CTE needs to
        -- change.
        -- ---------------------------------------------------------------
      )
      SELECT * FROM bills
      WHERE 1 = 1
      ${kindFilter}
      ${cursorFilter}
      ORDER BY COALESCE("dueDate", '-infinity'::timestamptz) DESC, id DESC
      LIMIT ${limit + 1}
    `);

    const items: BillLine[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind as BillKind,
      title: row.title,
      label: row.label,
      amountDue: row.amountDue,
      amountPaid: row.amountPaid,
      status: row.status,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
      basis: row.basis,
      evidenceType: row.evidenceType,
      evidenceId: row.evidenceId,
    }));

    return buildPage(items, limit, (row) => ({ sortValue: row.dueDate, id: row.id }));
  }

  private parseKind(raw: string | undefined): BillKind | null {
    if (raw === undefined) return null;
    if ((BILL_KINDS as readonly string[]).includes(raw)) return raw as BillKind;
    throw new BadRequestException(`kind must be one of ${BILL_KINDS.join(', ')}`);
  }
}
