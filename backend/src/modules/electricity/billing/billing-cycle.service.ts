import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { AppConfigService } from '../../../config/config.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { AccountKind, BillBasis, BillingCycleStatus, BillingStage, FlatBillStatus, MeterKind, MeterStatus, RatificationStatus, Utility } from '../../../generated/prisma/enums.js';
import type { BillingCycleModel, FlatBillModel, PaymentModel } from '../../../generated/prisma/models.js';
import type { PaymentPostCommitAction } from '../../payments/payments.service.js';
import { TariffScheduleService } from '../tariff-schedule.service.js';
import { parseTariffConfig } from '../tariff/tariff-config.parser.js';
import { computeTariff } from '../tariff/tariff.util.js';
import { deriveConsumption, detectAnomalies } from '../readings/reading-validation.util.js';
import { apportionByArea, deriveCommonConsumption, type AreaFlat } from '../apportionment/apportionment.util.js';
import { blendedRatePerKl, type WaterSource as WaterBlendSource } from '../../water/blend/water-blend.util.js';
import { BillingQueue } from './billing.queue.js';
import type { OpenBillingCycleDto } from './dto/open-billing-cycle.dto.js';
import type { ReconcileBillingCycleDto } from './dto/reconcile-billing-cycle.dto.js';
import type { ListBillingCyclesQuery } from './dto/list-billing-cycles.query.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Distinct from every other pg_advisory_xact_lock namespace in this repo —
 * see AuditService (42), IdempotencyService (51), BulkBuyService (52, 53),
 * ServiceRequestsService, PocketTransfersService (56), OccupancyService.
 * 57 is reserved for the Phase 10 billing-cycle pipeline: every stage
 * transition takes this lock (keyed on the cycle id) before reading/
 * advancing `stage`, so two concurrent `run()` calls for the SAME cycle
 * (e.g. a treasurer double-clicking "run" while the inline call from their
 * first click is still in flight, or an out-of-process worker picking up a
 * job while an inline call is also running) serialize rather than racing to
 * read-then-write the same stage field.
 */
const BILLING_CYCLE_LOCK_NAMESPACE = 57;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** How many trailing consumption values feed detectAnomalies' spike/stall baseline — same order of magnitude as a year of monthly readings. */
const ANOMALY_HISTORY_SIZE = 6;

export interface BillingCycleDetail {
  id: string;
  societyId: string;
  utility: Utility;
  period: string;
  stage: BillingStage;
  status: BillingCycleStatus;
  tariffScheduleId: string | null;
  bulkInvoiceAmount: string | null;
  bulkConsumption: string | null;
  variance: string | null;
  haltedReason: string | null;
  flatBillCount: number;
  anomalyCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Post-commit `bill.published` push, one per flat, gathered inside the publish-stage transaction and fired AFTER it commits — same pattern as MaintenanceBillingService.notifyResidentBestEffort / PaymentsService's PendingBillPaidPush. */
interface PendingBillPublishedPush {
  residentId: string;
  flatBillId: string;
  cycleId: string;
  utility: Utility;
  period: string;
  amount: string;
}

/** Post-commit `bill.paid` push for the FlatBill payment-link handler — mirrors PaymentsService's own PendingBillPaidPush for MaintenanceCharge. */
interface PendingFlatBillPaidPush {
  residentId: string;
  flatBillId: string;
  amount: string;
  status: FlatBillStatus;
}

/**
 * Phase 10 CAPSTONE — the resumable billing-cycle pipeline: ingest ->
 * validate -> compute -> apportion -> reconcile -> publish (-> settled,
 * reserved for a future collections-close phase; nothing advances a cycle
 * to SETTLED yet). Every stage is a SEPARATE, idempotent database
 * transaction, guarded by BILLING_CYCLE_LOCK_NAMESPACE and a check of the
 * cycle's CURRENT `stage`/`status` before doing anything: a stage whose
 * precondition doesn't hold (already past it, or the cycle is
 * HALTED/CANCELLED) is a verified no-op. That is what makes `run()` safe to
 * call repeatedly — from a fresh request, a retried worker job, or a crash
 * recovery — always converging on PUBLISHED/COMPLETED (or stopping cleanly
 * at HALTED) without ever redoing already-committed work or double-charging
 * a flat.
 *
 * FlatBill rows are built up PROGRESSIVELY rather than allocated in one shot
 * at publish: the compute stage creates each metered flat's row with its
 * energy/water charge, the apportion stage tops every flat's row up (or
 * creates a FALLBACK-basis row for an unmetered flat) with its share of the
 * common-area cost, and publish only finalises `stage`/`status` and fires
 * the `bill.published` events. This is a deliberate reading of "resumable"
 * that extends to the money math itself, not only the cycle's own stage
 * field — every stage's arithmetic is a pure function of already-durable
 * inputs (Reading.consumption cached at validate, the snapshotted
 * TariffSchedule, WaterSource rows, Flat.carpetAreaSqft), so recomputing
 * from scratch on a resumed run is always safe and always produces the same
 * numbers.
 *
 * ADAPTATION NOTE (schema vs. task brief): `Meter` has no `meterMaxValue`
 * column, so `deriveConsumption`/`detectAnomalies` are always called with
 * `meterMaxValue` undefined — a backwards-dial reading can never be
 * classified ROLLOVER here (nothing to compare the wrap against), it is
 * always NEGATIVE_CONSUMPTION. The Prisma enum backing `BillingCycle.stage`
 * is named `BillingStage` (not `BillingCycleStage`); values are identical.
 */
@Injectable()
export class BillingCycleService {
  private readonly logger = new Logger(BillingCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly tariffSchedule: TariffScheduleService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly billingQueue: BillingQueue,
  ) {}

  // -------------------------------------------------------------------
  // Open / read
  // -------------------------------------------------------------------

  /**
   * Opens a new BillingCycle (stage OPEN, status RUNNING) and snapshots the
   * tariff schedule in force for (societyId, utility, period) onto
   * `tariffScheduleId` — TariffScheduleService.currentFor 404s when none is
   * in force, which is exactly right: a cycle can't compute charges with no
   * tariff to apply. Rejects a duplicate (societyId, utility, period) via
   * the `@@unique` constraint, mapped to 409.
   */
  async open(societyId: string, dto: OpenBillingCycleDto): Promise<BillingCycleDetail> {
    if (!PERIOD_RE.test(dto.period)) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }

    const tariff = await this.tariffSchedule.currentFor(societyId, dto.utility, dto.period);

    try {
      const cycle = await this.prisma.billingCycle.create({
        data: {
          societyId,
          utility: dto.utility,
          period: dto.period,
          stage: BillingStage.OPEN,
          status: BillingCycleStatus.RUNNING,
          tariffScheduleId: tariff.id,
          bulkInvoiceAmount: dto.bulkInvoiceAmount ?? null,
          bulkConsumption: dto.bulkConsumption ?? null,
        },
      });
      await this.audit.appendBestEffort({
        societyId,
        actorId: null,
        action: 'BILLING_CYCLE_OPENED',
        subjectType: 'BillingCycle',
        subjectId: cycle.id,
        payload: { utility: dto.utility, period: dto.period, tariffScheduleId: tariff.id },
      });
      return this.toDetail(cycle, 0, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error(`A billing cycle already exists for ${dto.utility} ${dto.period}`);
      }
      throw error;
    }
  }

  async get(societyId: string, cycleId: string): Promise<BillingCycleDetail> {
    const cycle = await this.findOwned(societyId, cycleId);
    const [flatBillCount, anomalyCount] = await Promise.all([
      this.prisma.flatBill.count({ where: { billingCycleId: cycleId } }),
      this.prisma.meterReadingAnomaly.count({ where: { billingCycleId: cycleId } }),
    ]);
    return this.toDetail(cycle, flatBillCount, anomalyCount);
  }

  async list(societyId: string, query: ListBillingCyclesQuery): Promise<BillingCycleDetail[]> {
    const cycles = await this.prisma.billingCycle.findMany({
      where: { societyId, ...(query.utility ? { utility: query.utility } : {}), ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ period: 'desc' }, { utility: 'asc' }],
    });
    const counts = await Promise.all(
      cycles.map((c) =>
        Promise.all([this.prisma.flatBill.count({ where: { billingCycleId: c.id } }), this.prisma.meterReadingAnomaly.count({ where: { billingCycleId: c.id } })]),
      ),
    );
    return cycles.map((c, i) => this.toDetail(c, counts[i][0], counts[i][1]));
  }

  /**
   * Sets/updates the licensee bulk-invoice figures a cycle's reconcile stage
   * diffs Σ(flat bills) against. Callable any time before CANCELLED — see
   * ReconcileBillingCycleDto's doc comment for the "before the reconcile
   * stage has actually run" caveat (BillingStage only ever moves forward,
   * so this never retroactively recomputes an already-published variance).
   */
  async reconcileInvoice(societyId: string, cycleId: string, dto: ReconcileBillingCycleDto): Promise<BillingCycleDetail> {
    const cycle = await this.findOwned(societyId, cycleId);
    if (cycle.status === BillingCycleStatus.CANCELLED) {
      throw new BadRequestException('Cannot set invoice figures on a cancelled billing cycle');
    }
    const updated = await this.prisma.billingCycle.update({
      where: { id: cycleId },
      data: { bulkInvoiceAmount: dto.bulkInvoiceAmount, bulkConsumption: dto.bulkConsumption ?? cycle.bulkConsumption },
    });
    const [flatBillCount, anomalyCount] = await Promise.all([
      this.prisma.flatBill.count({ where: { billingCycleId: cycleId } }),
      this.prisma.meterReadingAnomaly.count({ where: { billingCycleId: cycleId } }),
    ]);
    return this.toDetail(updated, flatBillCount, anomalyCount);
  }

  // -------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------

  /**
   * Entry point: inline (BILLING_WORKER_INLINE, default true — dev/test and
   * the e2e suite run every stage synchronously with no Redis/worker
   * needed) or enqueued onto the 'billing' BullMQ queue for the
   * out-of-process worker (src/worker.ts) to pick up. Both paths call the
   * exact same `runStagesInline` — the only difference is WHERE it runs,
   * never what it does.
   */
  async run(societyId: string, cycleId: string): Promise<BillingCycleDetail> {
    await this.findOwned(societyId, cycleId); // 404s if not this society's cycle, before touching the queue/pipeline

    if (this.config.env.BILLING_WORKER_INLINE) {
      return this.runStagesInline(societyId, cycleId);
    }

    await this.billingQueue.enqueueRun({ societyId, cycleId });
    return this.get(societyId, cycleId);
  }

  /**
   * Runs every remaining stage, in order, stopping early the moment the
   * cycle's status leaves RUNNING (HALTED by a validation anomaly, or
   * CANCELLED). Used directly by `run()` in inline mode AND by the BullMQ
   * worker's job processor (billing.worker.ts) in out-of-process mode —
   * same method, so pipeline behaviour is identical either way.
   */
  async runStagesInline(societyId: string, cycleId: string): Promise<BillingCycleDetail> {
    await this.stageIngest(societyId, cycleId);

    let cycle = await this.stageValidate(societyId, cycleId);
    if (cycle.status === BillingCycleStatus.RUNNING) {
      cycle = await this.stageCompute(societyId, cycleId);
      cycle = await this.stageApportion(societyId, cycleId);
      cycle = await this.stageReconcile(societyId, cycleId);
      cycle = await this.stagePublish(societyId, cycleId);
    }

    const [flatBillCount, anomalyCount] = await Promise.all([
      this.prisma.flatBill.count({ where: { billingCycleId: cycleId } }),
      this.prisma.meterReadingAnomaly.count({ where: { billingCycleId: cycleId } }),
    ]);
    return this.toDetail(cycle, flatBillCount, anomalyCount);
  }

  // -------------------------------------------------------------------
  // Stage: ingest (OPEN -> READINGS_CLOSED)
  // -------------------------------------------------------------------

  /**
   * Idempotent no-op once past OPEN. Otherwise verifies every ACTIVE
   * FLAT/BULK meter of the cycle's utility has at least one Reading tagged
   * `billingCycleId = cycleId` (captured via ReadingsService.capture/
   * ingestCsv's optional `billingCycleId`) — throws (does NOT halt the
   * cycle; this is a "not ready yet" precondition, not a data anomaly) when
   * any are missing, naming them so the treasurer knows what to capture.
   * COMMON-kind meters are outside this pipeline's apportionment math (see
   * class doc comment) and are not required here.
   */
  private async stageIngest(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    return this.withCycleLock(cycleId, async (tx) => {
      const cycle = await this.mustFind(tx, cycleId);
      if (cycle.stage !== BillingStage.OPEN || cycle.status !== BillingCycleStatus.RUNNING) {
        return cycle;
      }

      const meters = await tx.meter.findMany({
        where: { societyId, utility: cycle.utility, kind: { in: [MeterKind.FLAT, MeterKind.BULK] }, status: MeterStatus.ACTIVE },
        select: { id: true, serial: true },
      });
      if (meters.length === 0) {
        throw new BadRequestException(`No ACTIVE FLAT/BULK meters configured for ${cycle.utility} — cannot close the reading window`);
      }

      const readings = await tx.reading.findMany({ where: { billingCycleId: cycleId }, select: { meterId: true } });
      const meteredIds = new Set(readings.map((r) => r.meterId));
      const missing = meters.filter((m) => !meteredIds.has(m.id));
      if (missing.length > 0) {
        throw new BadRequestException(`Readings missing for this cycle for meter(s): ${missing.map((m) => m.serial).join(', ')}`);
      }

      return tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.READINGS_CLOSED } });
    });
  }

  // -------------------------------------------------------------------
  // Stage: validate (READINGS_CLOSED -> VALIDATED, or -> HALTED)
  // -------------------------------------------------------------------

  /**
   * For every ACTIVE FLAT/BULK meter of the cycle's utility, derives this
   * period's consumption (deriveConsumption) against the meter's own
   * reading history and runs detectAnomalies. ANY anomaly on ANY meter:
   * creates a MeterReadingAnomaly row per flagged kind, flags that meter
   * (`status = FLAGGED`), and halts the CYCLE (`status = HALTED`,
   * `haltedReason` summarising which meters/kinds) — stage stays
   * READINGS_CLOSED, nothing downstream runs. A clean pass caches each
   * meter's derived consumption onto its current Reading row and advances
   * to VALIDATED.
   */
  private async stageValidate(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    return this.withCycleLock(cycleId, async (tx) => {
      const cycle = await this.mustFind(tx, cycleId);
      if (cycle.stage !== BillingStage.READINGS_CLOSED || cycle.status !== BillingCycleStatus.RUNNING) {
        return cycle;
      }

      const meters = await tx.meter.findMany({
        where: { societyId, utility: cycle.utility, kind: { in: [MeterKind.FLAT, MeterKind.BULK] }, status: MeterStatus.ACTIVE },
      });

      const flaggedSummary: string[] = [];

      for (const meter of meters) {
        const currentReading = await tx.reading.findFirst({
          where: { meterId: meter.id, billingCycleId: cycleId },
          orderBy: { capturedAt: 'desc' },
        });
        if (!currentReading) continue; // stageIngest already guarantees this exists; defensive only

        const previousReading = await tx.reading.findFirst({
          where: { meterId: meter.id, id: { not: currentReading.id }, capturedAt: { lt: currentReading.capturedAt } },
          orderBy: { capturedAt: 'desc' },
        });
        const historyRows = await tx.reading.findMany({
          where: { meterId: meter.id, id: { notIn: [currentReading.id, ...(previousReading ? [previousReading.id] : [])] }, consumption: { not: null } },
          orderBy: { capturedAt: 'desc' },
          take: ANOMALY_HISTORY_SIZE,
          select: { consumption: true },
        });

        const prevValue = previousReading ? Number(previousReading.value) : 0;
        const currValue = Number(currentReading.value);
        const multiplier = Number(meter.multiplier);
        const historicalConsumptions = historyRows.map((r) => Number(r.consumption));

        // No meterMaxValue column on Meter (see class doc comment's
        // ADAPTATION NOTE) — rollover can never be distinguished from a
        // genuine negative reading here.
        const anomalies = detectAnomalies({ prevValue, currValue, multiplier, historicalConsumptions });
        const consumption = deriveConsumption(prevValue, currValue, multiplier);

        await tx.reading.update({ where: { id: currentReading.id }, data: { consumption } });

        if (anomalies.length > 0) {
          for (const kind of anomalies) {
            await tx.meterReadingAnomaly.create({
              data: {
                billingCycleId: cycleId,
                meterId: meter.id,
                kind,
                detail: `prevValue=${prevValue} currValue=${currValue} multiplier=${multiplier} derivedConsumption=${consumption}`,
                readingId: currentReading.id,
              },
            });
          }
          await tx.meter.updateMany({ where: { id: meter.id, status: MeterStatus.ACTIVE }, data: { status: MeterStatus.FLAGGED } });
          flaggedSummary.push(`${meter.serial} (${anomalies.join(', ')})`);
        }
      }

      if (flaggedSummary.length > 0) {
        return tx.billingCycle.update({
          where: { id: cycleId },
          data: { status: BillingCycleStatus.HALTED, haltedReason: `${flaggedSummary.length} meter(s) flagged: ${flaggedSummary.join('; ')}` },
        });
      }

      return tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.VALIDATED } });
    });
  }

  // -------------------------------------------------------------------
  // Stage: compute (VALIDATED -> COMPUTED)
  // -------------------------------------------------------------------

  /**
   * Per FLAT meter (ACTIVE, this utility, with a validated reading this
   * cycle), computes the metered energy/water charge and upserts that
   * flat's FlatBill row (basis METERED, status PENDING, a partial
   * `computationTrace` — the apportion stage tops it up with the common-area
   * share). Unmetered flats are untouched here; they get a FALLBACK-basis
   * row at the apportion stage.
   */
  private async stageCompute(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    return this.withCycleLock(cycleId, async (tx) => {
      const cycle = await this.mustFind(tx, cycleId);
      if (cycle.stage !== BillingStage.VALIDATED || cycle.status !== BillingCycleStatus.RUNNING) {
        return cycle;
      }

      const flatMeters = await tx.meter.findMany({
        where: { societyId, utility: cycle.utility, kind: MeterKind.FLAT, status: MeterStatus.ACTIVE, flatId: { not: null } },
      });

      const tariffConfig = cycle.tariffScheduleId ? parseTariffConfig(await this.loadTariffRaw(tx, cycle.tariffScheduleId)) : null;
      const waterBlend = cycle.utility === Utility.WATER ? await this.computeWaterBlend(tx, societyId, cycleId, cycle.period) : null;

      for (const meter of flatMeters) {
        const reading = await tx.reading.findFirst({
          where: { meterId: meter.id, billingCycleId: cycleId },
          orderBy: { capturedAt: 'desc' },
        });
        if (!reading || reading.consumption === null) continue; // not validated (defensive — stageValidate covers every meter in `flatMeters`'s superset)

        const consumptionUnits = Number(reading.consumption);
        let amount: number;
        let trace: Record<string, unknown>;

        if (cycle.utility === Utility.ELECTRICITY) {
          if (!tariffConfig) throw new BadRequestException('Billing cycle has no snapshotted tariff schedule');
          const breakdown = computeTariff(tariffConfig, consumptionUnits);
          amount = breakdown.total;
          trace = {
            utility: Utility.ELECTRICITY,
            consumption: consumptionUnits,
            tariffScheduleId: cycle.tariffScheduleId,
            slabBreakdown: breakdown.slabBreakdown,
            energyCharge: breakdown.energyCharge,
            fixedCharge: breakdown.fixedCharge,
            dutyCess: breakdown.dutyCess,
            meteredAmount: breakdown.total,
          };
        } else {
          const blend = waterBlend!;
          const amountPaise = Math.round(consumptionUnits * blend.ratePaisePerKl);
          amount = amountPaise / 100;
          trace = {
            utility: Utility.WATER,
            consumption: consumptionUnits,
            ratePaisePerKl: blend.ratePaisePerKl,
            waterSourceDerivation: blend.derivation,
            meteredAmount: amount,
          };
        }

        await tx.flatBill.upsert({
          where: { billingCycleId_flatId: { billingCycleId: cycleId, flatId: meter.flatId! } },
          create: {
            billingCycleId: cycleId,
            flatId: meter.flatId!,
            societyId,
            consumption: consumptionUnits,
            amount,
            basis: BillBasis.METERED,
            computationTrace: trace as Prisma.InputJsonValue,
            status: FlatBillStatus.PENDING,
          },
          update: {
            consumption: consumptionUnits,
            amount,
            computationTrace: trace as Prisma.InputJsonValue,
          },
        });
      }

      return tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.COMPUTED } });
    });
  }

  // -------------------------------------------------------------------
  // Stage: apportion (COMPUTED -> APPORTIONED)
  // -------------------------------------------------------------------

  /**
   * Derives common-area consumption (bulk meter's validated reading minus
   * the sum of every metered flat's validated consumption) and its cost
   * (re-applying the same tariff/blend used at compute), then splits that
   * cost across EVERY flat in the society by `carpetAreaSqft`
   * (apportionByArea — paise-exact). A metered flat's existing FlatBill.
   * amount is incremented by its share; a flat with no ACTIVE FLAT meter
   * gets a brand-new FALLBACK-basis FlatBill whose amount IS its area
   * share (it has no metered component to add to).
   */
  private async stageApportion(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    return this.withCycleLock(cycleId, async (tx) => {
      const cycle = await this.mustFind(tx, cycleId);
      if (cycle.stage !== BillingStage.COMPUTED || cycle.status !== BillingCycleStatus.RUNNING) {
        return cycle;
      }

      const bulkMeter = await tx.meter.findFirst({ where: { societyId, utility: cycle.utility, kind: MeterKind.BULK, status: MeterStatus.ACTIVE } });
      if (!bulkMeter) {
        throw new BadRequestException(`No ACTIVE BULK meter configured for ${cycle.utility} — cannot apportion common-area cost`);
      }
      const bulkReading = await tx.reading.findFirst({ where: { meterId: bulkMeter.id, billingCycleId: cycleId }, orderBy: { capturedAt: 'desc' } });
      if (!bulkReading || bulkReading.consumption === null) {
        throw new BadRequestException('BULK meter has no validated reading for this cycle');
      }
      const bulkUnits = Number(bulkReading.consumption);

      const flatMeters = await tx.meter.findMany({
        where: { societyId, utility: cycle.utility, kind: MeterKind.FLAT, status: MeterStatus.ACTIVE, flatId: { not: null } },
      });
      let subMeterSumUnits = 0;
      for (const meter of flatMeters) {
        const reading = await tx.reading.findFirst({ where: { meterId: meter.id, billingCycleId: cycleId }, orderBy: { capturedAt: 'desc' } });
        if (reading?.consumption !== null && reading?.consumption !== undefined) {
          subMeterSumUnits += Number(reading.consumption);
        }
      }

      const commonConsumptionUnits = deriveCommonConsumption(bulkUnits, subMeterSumUnits);

      let commonCostRupees: number;
      let commonCostTrace: Record<string, unknown>;
      if (cycle.utility === Utility.ELECTRICITY) {
        const tariffConfig = parseTariffConfig(await this.loadTariffRaw(tx, cycle.tariffScheduleId!));
        const breakdown = computeTariff(tariffConfig, commonConsumptionUnits);
        commonCostRupees = breakdown.total;
        commonCostTrace = { basis: 'ELECTRICITY_TARIFF', slabBreakdown: breakdown.slabBreakdown, fixedCharge: breakdown.fixedCharge, dutyCess: breakdown.dutyCess };
      } else {
        const blend = await this.computeWaterBlend(tx, societyId, cycleId, cycle.period);
        commonCostRupees = Math.round(commonConsumptionUnits * blend.ratePaisePerKl) / 100;
        commonCostTrace = { basis: 'WATER_BLEND', ratePaisePerKl: blend.ratePaisePerKl, waterSourceDerivation: blend.derivation };
      }
      const commonCostPaise = Math.round(commonCostRupees * 100);

      const flats = await tx.flat.findMany({ where: { societyId }, select: { id: true, carpetAreaSqft: true } });
      const areaFlats: AreaFlat[] = flats.map((f) => ({ flatId: f.id, areaWeight: f.carpetAreaSqft !== null ? Number(f.carpetAreaSqft) : null }));
      const shares = apportionByArea(commonCostPaise, areaFlats);

      for (const share of shares) {
        const shareRupees = share.sharePaise / 100;
        const existing = await tx.flatBill.findUnique({ where: { billingCycleId_flatId: { billingCycleId: cycleId, flatId: share.flatId } } });

        const apportionment = {
          commonConsumptionUnits,
          commonCostRupees,
          commonCostTrace,
          bulkUnits,
          subMeterSumUnits,
          sharePaise: share.sharePaise,
        };

        if (existing) {
          const priorTrace = (existing.computationTrace ?? {}) as Record<string, unknown>;
          await tx.flatBill.update({
            where: { id: existing.id },
            data: {
              amount: existing.amount.plus(shareRupees),
              computationTrace: { ...priorTrace, apportionment } as Prisma.InputJsonValue,
            },
          });
        } else {
          await tx.flatBill.create({
            data: {
              billingCycleId: cycleId,
              flatId: share.flatId,
              societyId,
              consumption: null,
              amount: shareRupees,
              basis: BillBasis.FALLBACK,
              computationTrace: { utility: cycle.utility, apportionment, fallbackAmount: shareRupees } as Prisma.InputJsonValue,
              status: FlatBillStatus.PENDING,
            },
          });
        }
      }

      return tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.APPORTIONED } });
    });
  }

  // -------------------------------------------------------------------
  // Stage: reconcile (APPORTIONED -> RECONCILED)
  // -------------------------------------------------------------------

  /**
   * variance = Σ(FlatBill.amount for this cycle) − bulkInvoiceAmount, stored
   * on the cycle and never absorbed into any flat's bill — published as-is
   * for the treasurer/committee to see and act on. Left null when no bulk
   * invoice figure is on file (reconcileInvoice was never called).
   */
  private async stageReconcile(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    return this.withCycleLock(cycleId, async (tx) => {
      const cycle = await this.mustFind(tx, cycleId);
      if (cycle.stage !== BillingStage.APPORTIONED || cycle.status !== BillingCycleStatus.RUNNING) {
        return cycle;
      }

      const sum = await tx.flatBill.aggregate({ where: { billingCycleId: cycleId }, _sum: { amount: true } });
      const totalFlatCharges = sum._sum.amount ?? new Decimal(0);
      const variance = cycle.bulkInvoiceAmount !== null ? totalFlatCharges.minus(cycle.bulkInvoiceAmount) : null;

      return tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.RECONCILED, variance } });
    });
  }

  // -------------------------------------------------------------------
  // Stage: publish (RECONCILED -> PUBLISHED, status -> COMPLETED)
  // -------------------------------------------------------------------

  /**
   * Finalises the cycle (stage PUBLISHED, status COMPLETED — every FlatBill
   * row was already fully computed/amounted by compute+apportion) and fires
   * a post-commit, best-effort `bill.published` push per flat to its
   * primary ratified resident, mirroring
   * MaintenanceBillingService.notifyResidentBestEffort exactly. Does NOT
   * post to the ledger — the obligation clears on payment capture via the
   * FlatBill payment-link handler (see registerFlatBillPaymentHandler),
   * exactly like MaintenanceCharge.
   */
  private async stagePublish(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    const pending: PendingBillPublishedPush[] = [];

    const cycle = await this.withCycleLock(cycleId, async (tx) => {
      const current = await this.mustFind(tx, cycleId);
      if (current.stage !== BillingStage.RECONCILED || current.status !== BillingCycleStatus.RUNNING) {
        return current;
      }

      const updated = await tx.billingCycle.update({ where: { id: cycleId }, data: { stage: BillingStage.PUBLISHED, status: BillingCycleStatus.COMPLETED } });

      const flatBills = await tx.flatBill.findMany({ where: { billingCycleId: cycleId } });
      for (const bill of flatBills) {
        const occupancy = await tx.occupancy.findFirst({
          where: { flatId: bill.flatId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED },
          orderBy: { tenureStartedAt: 'asc' },
          select: { userId: true },
        });
        if (!occupancy) {
          this.logger.warn(`No ratified resident found for flat ${bill.flatId} — bill.published not queued for FlatBill ${bill.id}`);
          continue;
        }
        pending.push({ residentId: occupancy.userId, flatBillId: bill.id, cycleId, utility: updated.utility, period: updated.period, amount: bill.amount.toString() });
      }

      return updated;
    });

    if (cycle.stage === BillingStage.PUBLISHED) {
      await this.audit.appendBestEffort({
        societyId,
        actorId: null,
        action: 'BILLING_CYCLE_PUBLISHED',
        subjectType: 'BillingCycle',
        subjectId: cycleId,
        payload: { utility: cycle.utility, period: cycle.period, flatBillCount: pending.length },
      });
      for (const push of pending) {
        await this.pushBillPublished(push);
      }
    }

    return cycle;
  }

  private async pushBillPublished(pending: PendingBillPublishedPush): Promise<void> {
    try {
      await this.realtime.emitToUser(pending.residentId, 'bill.published', {
        flatBillId: pending.flatBillId,
        cycleId: pending.cycleId,
        utility: pending.utility,
        period: pending.period,
        amount: pending.amount,
      });
    } catch (error) {
      this.logger.error(`Post-commit bill.published push failed for FlatBill ${pending.flatBillId} (already committed)`, error instanceof Error ? error.stack : String(error));
    }
  }

  // -------------------------------------------------------------------
  // FlatBill payment-link handler (registered once, from BillingModule.onModuleInit)
  // -------------------------------------------------------------------

  /** `pocketKind` resolver for the FlatBill payment-link handler — ELECTRICITY or WATER, read off the FlatBill's own BillingCycle.utility. */
  async resolvePocketForFlatBill(tx: Prisma.TransactionClient, flatBillId: string): Promise<AccountKind> {
    const bill = await tx.flatBill.findUnique({ where: { id: flatBillId }, include: { billingCycle: { select: { utility: true } } } });
    if (!bill) {
      // Defensive: PaymentsService already guarantees linkedEntityId resolves
      // for any payment it's about to capture against a registered handler.
      // Fall back to ELECTRICITY rather than throwing mid-webhook-transaction.
      this.logger.warn(`resolvePocketForFlatBill: FlatBill ${flatBillId} not found — defaulting to ELECTRICITY`);
      return AccountKind.ELECTRICITY;
    }
    return bill.billingCycle.utility === Utility.WATER ? AccountKind.WATER : AccountKind.ELECTRICITY;
  }

  /**
   * PENDING/PARTIAL -> PARTIAL/PAID hook, GUARDED exactly like
   * PaymentsService.advanceMaintenanceCharge (updateMany with a status-`in`
   * where clause, never a blind update) so a duplicate/out-of-order webhook
   * can never double-apply a capture. Returns a post-commit action that
   * fires `bill.paid`, or undefined if there's nothing to push.
   */
  async advanceFlatBill(tx: Prisma.TransactionClient, flatBillId: string, amountRupees: number, _payment: PaymentModel): Promise<PaymentPostCommitAction | undefined> {
    const bill = await tx.flatBill.findUnique({ where: { id: flatBillId } });
    if (!bill) {
      this.logger.warn(`payment.captured linked to missing FlatBill ${flatBillId} — pocket already credited, but no bill row to advance`);
      return undefined;
    }

    const newPaidAmount = bill.paidAmount.plus(amountRupees);
    const newStatus = newPaidAmount.greaterThanOrEqualTo(bill.amount) ? FlatBillStatus.PAID : FlatBillStatus.PARTIAL;

    const result = await tx.flatBill.updateMany({
      where: { id: flatBillId, status: { in: [FlatBillStatus.PENDING, FlatBillStatus.PARTIAL] } },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });
    if (result.count === 0) {
      this.logger.warn(`FlatBill ${flatBillId} was not PENDING/PARTIAL when its payment captured — paidAmount/status not advanced (status=${bill.status})`);
      return undefined;
    }

    const occupancy = await tx.occupancy.findFirst({
      where: { flatId: bill.flatId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED },
      orderBy: { tenureStartedAt: 'asc' },
      select: { userId: true },
    });
    if (!occupancy) {
      this.logger.warn(`No ratified resident found for flat ${bill.flatId} — bill.paid not pushed for FlatBill ${flatBillId}`);
      return undefined;
    }

    const push: PendingFlatBillPaidPush = { residentId: occupancy.userId, flatBillId, amount: newPaidAmount.toString(), status: newStatus };
    return () => this.pushFlatBillPaid(push);
  }

  /** Symmetric reversal of advanceFlatBill — decrements paidAmount (floored at 0) and steps status back down; never re-marks PAID. Mirrors PaymentsService.revertMaintenanceCharge. */
  async revertFlatBill(tx: Prisma.TransactionClient, flatBillId: string, amountRupees: number, _payment: PaymentModel): Promise<void> {
    const bill = await tx.flatBill.findUnique({ where: { id: flatBillId } });
    if (!bill) {
      this.logger.warn(`refund.processed linked to missing FlatBill ${flatBillId} — pocket already reversed, but no bill row to revert`);
      return;
    }

    const newPaidAmount = Decimal.max(0, bill.paidAmount.minus(amountRupees));
    const newStatus = newPaidAmount.lessThanOrEqualTo(0) ? FlatBillStatus.PENDING : newPaidAmount.lessThan(bill.amount) ? FlatBillStatus.PARTIAL : bill.status;

    const result = await tx.flatBill.updateMany({
      where: { id: flatBillId, status: { in: [FlatBillStatus.PARTIAL, FlatBillStatus.PAID] } },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });
    if (result.count === 0) {
      this.logger.warn(`FlatBill ${flatBillId} was not PARTIAL/PAID when its payment refunded — paidAmount/status not reverted (status=${bill.status})`);
    }
  }

  private async pushFlatBillPaid(pending: PendingFlatBillPaidPush): Promise<void> {
    try {
      await this.realtime.emitToUser(pending.residentId, 'bill.paid', {
        flatBillId: pending.flatBillId,
        amount: pending.amount,
        status: pending.status,
      });
    } catch (error) {
      this.logger.error(`Post-commit bill.paid push failed for FlatBill ${pending.flatBillId} (payment already captured)`, error instanceof Error ? error.stack : String(error));
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  /** Acquires BILLING_CYCLE_LOCK_NAMESPACE for `cycleId` inside a fresh transaction, runs `fn`, and lets Postgres release the lock at commit/rollback — same shape as every other advisory-lock call in this codebase (AuditService, IdempotencyService, PocketTransfersService, ...). */
  private async withCycleLock<T>(cycleId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BILLING_CYCLE_LOCK_NAMESPACE}, hashtext(${cycleId}))`;
      return fn(tx);
    });
  }

  private async mustFind(tx: Prisma.TransactionClient, cycleId: string): Promise<BillingCycleModel> {
    const cycle = await tx.billingCycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      throw new NotFoundException('Billing cycle not found');
    }
    return cycle;
  }

  private async findOwned(societyId: string, cycleId: string): Promise<BillingCycleModel> {
    const cycle = await this.prisma.billingCycle.findUnique({ where: { id: cycleId } });
    if (!cycle || cycle.societyId !== societyId) {
      throw new NotFoundException('Billing cycle not found');
    }
    return cycle;
  }

  private async loadTariffRaw(tx: Prisma.TransactionClient, tariffScheduleId: string): Promise<unknown> {
    const tariff = await tx.tariffSchedule.findUniqueOrThrow({ where: { id: tariffScheduleId } });
    return { slabs: tariff.slabs, fixedCharges: tariff.fixedCharges, dutyCess: tariff.dutyCess };
  }

  /**
   * Loads this cycle's water sources — tagged directly to `cycleId`, or
   * (a source recorded ahead of the cycle existing, per
   * WaterService.recordSource's doc comment) untagged rows matching the
   * cycle's own (societyId, period) — and blends them via
   * blendedRatePerKl. Rupee `cost` columns are converted to integer paise
   * at this boundary (the util's own convention — see its doc comment).
   */
  private async computeWaterBlend(tx: Prisma.TransactionClient, societyId: string, cycleId: string, period: string) {
    const sources = await tx.waterSource.findMany({
      where: { societyId, OR: [{ billingCycleId: cycleId }, { billingCycleId: null, period }] },
    });
    const blendInputs: WaterBlendSource[] = sources.map((s) => ({ kind: s.kind, kilolitres: Number(s.kilolitres), cost: Math.round(Number(s.cost) * 100) }));
    if (blendInputs.length === 0) {
      throw new BadRequestException(`No water sources recorded for period ${period} — cannot blend a per-kilolitre rate`);
    }
    return blendedRatePerKl(blendInputs);
  }

  private toDetail(cycle: BillingCycleModel, flatBillCount: number, anomalyCount: number): BillingCycleDetail {
    return {
      id: cycle.id,
      societyId: cycle.societyId,
      utility: cycle.utility,
      period: cycle.period,
      stage: cycle.stage,
      status: cycle.status,
      tariffScheduleId: cycle.tariffScheduleId,
      bulkInvoiceAmount: cycle.bulkInvoiceAmount?.toString() ?? null,
      bulkConsumption: cycle.bulkConsumption?.toString() ?? null,
      variance: cycle.variance?.toString() ?? null,
      haltedReason: cycle.haltedReason,
      flatBillCount,
      anomalyCount,
      createdAt: cycle.createdAt.toISOString(),
      updatedAt: cycle.updatedAt.toISOString(),
    };
  }
}
