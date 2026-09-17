import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { MaintenanceChargeStatus, RatificationStatus } from '../../generated/prisma/enums.js';
import type { MaintenanceChargeModel, InstalmentPlanModel } from '../../generated/prisma/models.js';
import { computeLateFee, parseLateFeeConfig } from './late-fee.util.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface GenerateForPeriodResult {
  generated: number;
  skipped: number;
}

/** A newly-created charge, captured inside the tx so the post-commit realtime/audit pass has everything it needs without re-querying. */
interface NewlyCreatedCharge {
  chargeId: string;
  flatId: string;
  period: string;
  amount: string;
  dueDate: Date;
}

/**
 * Computes the due date for a generated period's charges. If the caller
 * supplied `dueDay`, the due date is that day-of-month WITHIN the billing
 * period itself (e.g. period '2026-03', dueDay 10 -> 2026-03-10 UTC — "pay
 * by the 10th of the month you're being billed for"). Otherwise it falls
 * back to the period's own last calendar day plus the society's configured
 * late-fee grace period, so a charge is never immediately "late" the day
 * generation runs even with no explicit dueDay policy set.
 */
function computeDueDate(period: string, dueDay: number | undefined, graceDays: number): Date {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12

  if (dueDay !== undefined) {
    return new Date(Date.UTC(year, month - 1, dueDay));
  }

  const periodEnd = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this month
  return new Date(periodEnd.getTime() + graceDays * MS_PER_DAY);
}

/**
 * Phase 9.2 (BACKEND_HANDOFF.md §6 / 9.2) — maintenance billing. Owns
 * generation of one MaintenanceCharge per Flat per billing period, late-fee
 * accrual (late-fee.util.ts's pure math), and instalment plans. Payment
 * capture/refund against a MaintenanceCharge-linked Payment is
 * PaymentsService's job (see that service's applyCapture/applyRefund
 * branching) — this service never touches the ledger or Payment rows
 * itself.
 *
 * Post-commit dispatch (realtime push, audit log) follows the same
 * try/catch-and-log, never-throw, never-roll-back-a-committed-change
 * contract as ServiceRequestsService.pushRealtime/dispatchNotifications —
 * see that class's doc comment for the full rationale this mirrors.
 */
@Injectable()
export class MaintenanceBillingService {
  private readonly logger = new Logger(MaintenanceBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // -------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------

  /**
   * Creates one MaintenanceCharge per Flat in the society for `period`,
   * snapshotting `Flat.maintenanceAmount` as the charge's `amount`.
   * Idempotent: a flat that already has a charge for this period (the
   * `@@unique([flatId, period])` constraint) is pre-queried and skipped,
   * never re-created and never errored on — re-running the same
   * (societyId, period) is always safe.
   */
  async generateForPeriod(societyId: string, period: string, opts?: { dueDay?: number }): Promise<GenerateForPeriodResult> {
    if (!PERIOD_RE.test(period)) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }
    if (opts?.dueDay !== undefined && (!Number.isInteger(opts.dueDay) || opts.dueDay < 1 || opts.dueDay > 28)) {
      throw new BadRequestException('dueDay must be an integer between 1 and 28');
    }

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    const lateFeeConfig = parseLateFeeConfig(society.config);
    const dueDate = computeDueDate(period, opts?.dueDay, lateFeeConfig.graceDays);

    const newlyCreated: NewlyCreatedCharge[] = [];
    let skipped = 0;

    await this.prisma.$transaction(async (tx) => {
      const [flats, existing] = await Promise.all([
        tx.flat.findMany({ where: { societyId }, select: { id: true, maintenanceAmount: true } }),
        tx.maintenanceCharge.findMany({ where: { societyId, period }, select: { flatId: true } }),
      ]);
      const existingFlatIds = new Set(existing.map((e) => e.flatId));

      for (const flat of flats) {
        if (existingFlatIds.has(flat.id)) {
          skipped += 1;
          continue;
        }
        const charge = await tx.maintenanceCharge.create({
          data: {
            societyId,
            flatId: flat.id,
            period,
            amount: flat.maintenanceAmount,
            dueDate,
            status: MaintenanceChargeStatus.PENDING,
          },
        });
        newlyCreated.push({ chargeId: charge.id, flatId: flat.id, period, amount: charge.amount.toString(), dueDate: charge.dueDate });
      }
    });

    // Post-commit, best-effort — every charge above is already durably
    // created; this is a live-push + audit convenience on top of it, never
    // a precondition for generation to have succeeded (see class doc
    // comment / ServiceRequestsService.pushRealtime for the pattern this
    // mirrors).
    for (const charge of newlyCreated) {
      await this.notifyResidentBestEffort(charge);
    }
    await this.auditService.appendBestEffort({
      societyId,
      actorId: null,
      action: 'MAINTENANCE_GENERATE',
      subjectType: 'MaintenanceCharge',
      subjectId: `${societyId}:${period}`,
      payload: { period, generated: newlyCreated.length, skipped, dueDate: dueDate.toISOString() },
    });

    return { generated: newlyCreated.length, skipped };
  }

  /** Resolves the flat's primary RATIFIED resident (earliest active occupancy) and pushes `bill.published`; any failure is logged, never thrown. */
  private async notifyResidentBestEffort(charge: NewlyCreatedCharge): Promise<void> {
    try {
      const occupancy = await this.prisma.occupancy.findFirst({
        where: { flatId: charge.flatId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED },
        orderBy: { tenureStartedAt: 'asc' },
        select: { userId: true },
      });
      if (!occupancy) {
        this.logger.warn(`No ratified resident found for flat ${charge.flatId} — bill.published not pushed for charge ${charge.chargeId}`);
        return;
      }
      await this.realtime.emitToUser(occupancy.userId, 'bill.published', {
        chargeId: charge.chargeId,
        period: charge.period,
        amount: charge.amount,
        dueDate: charge.dueDate.toISOString(),
        kind: 'MAINTENANCE',
      });
    } catch (error) {
      this.logger.error(`Post-commit bill.published push failed for charge ${charge.chargeId} (charge already committed)`, error instanceof Error ? error.stack : String(error));
    }
  }

  // -------------------------------------------------------------------
  // Late fees
  // -------------------------------------------------------------------

  /**
   * For every PENDING/PARTIAL charge in the society whose dueDate has
   * passed, increments `lateFeeAccrued` by `computeLateFee`'s incremental
   * result (see late-fee.util.ts — never negative, capped in total).
   * Charges where the increment computes to 0 (still within grace, or
   * already at the cap) are left untouched. Returns the count of charges
   * actually updated.
   */
  async accrueLateFees(societyId: string, asOf?: Date): Promise<number> {
    const now = asOf ?? this.clock.now();

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    const config = parseLateFeeConfig(society.config);

    const charges = await this.prisma.maintenanceCharge.findMany({
      where: { societyId, status: { in: [MaintenanceChargeStatus.PENDING, MaintenanceChargeStatus.PARTIAL] }, dueDate: { lt: now } },
    });

    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const charge of charges) {
        const additional = computeLateFee({ amount: Number(charge.amount), dueDate: charge.dueDate, alreadyAccrued: Number(charge.lateFeeAccrued) }, now, config);
        if (additional <= 0) continue;
        await tx.maintenanceCharge.update({ where: { id: charge.id }, data: { lateFeeAccrued: { increment: additional } } });
        updated += 1;
      }
    });

    return updated;
  }

  // -------------------------------------------------------------------
  // Instalment plans
  // -------------------------------------------------------------------

  /**
   * Splits a charge's outstanding principal (amount - paidAmount; late fees
   * already accrued are NOT spread across instalments — they remain due
   * against the charge directly) into `instalments` equal-ish parts:
   * `instalmentAmount` is the rounded nominal per-instalment figure
   * (amount / instalments, to 2dp) — since the schema stores a single
   * nominal amount rather than a per-instalment schedule, "the last
   * instalment absorbs the remainder" is a collection-time rule for
   * whoever settles the plan, not something this row itself encodes.
   * Guards: the charge must belong to `societyId`, have no existing plan,
   * and be PENDING/PARTIAL (an already-PAID/WAIVED charge has nothing left
   * to spread).
   */
  async createInstalmentPlan(societyId: string, chargeId: string, instalments: number): Promise<InstalmentPlanModel> {
    if (!Number.isInteger(instalments) || instalments < 2) {
      throw new BadRequestException('instalments must be an integer >= 2');
    }

    const charge = await this.prisma.maintenanceCharge.findUnique({ where: { id: chargeId } });
    if (!charge || charge.societyId !== societyId) {
      throw new NotFoundException('Maintenance charge not found');
    }
    if (charge.status !== MaintenanceChargeStatus.PENDING && charge.status !== MaintenanceChargeStatus.PARTIAL) {
      throw new BadRequestException(`Maintenance charge cannot be split into instalments (status=${charge.status})`);
    }

    const existing = await this.prisma.instalmentPlan.findUnique({ where: { maintenanceChargeId: chargeId } });
    if (existing) {
      throw new ConflictException('An instalment plan already exists for this charge');
    }

    const outstanding = charge.amount.minus(charge.paidAmount);
    if (outstanding.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Charge has no outstanding principal to split into instalments');
    }
    const instalmentAmount = outstanding.dividedBy(instalments).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return this.prisma.instalmentPlan.create({
      data: { maintenanceChargeId: chargeId, instalments, instalmentAmount },
    });
  }

  /** Verifies `chargeId` belongs to `societyId` AND to the flat currently occupied by `residentId` — used by the resident-self instalment-plan route. */
  async assertResidentOwnsCharge(societyId: string, residentId: string, chargeId: string): Promise<MaintenanceChargeModel> {
    const charge = await this.prisma.maintenanceCharge.findUnique({ where: { id: chargeId } });
    if (!charge || charge.societyId !== societyId) {
      throw new NotFoundException('Maintenance charge not found');
    }
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { flatId: charge.flatId, userId: residentId, tenureEndedAt: null },
      select: { id: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of the flat this charge belongs to');
    }
    return charge;
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(societyId: string, period?: string, status?: MaintenanceChargeStatus): Promise<MaintenanceChargeModel[]> {
    return this.prisma.maintenanceCharge.findMany({
      where: { societyId, ...(period ? { period } : {}), ...(status ? { status } : {}) },
      orderBy: [{ period: 'desc' }, { flatId: 'asc' }],
    });
  }
}
