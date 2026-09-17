import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Utility } from '../../generated/prisma/enums.js';
import type { TariffScheduleModel } from '../../generated/prisma/models.js';
import { parseTariffConfig } from './tariff/tariff-config.parser.js';
import type { CreateTariffScheduleDto } from './dto/create-tariff-schedule.dto.js';
import type { ListTariffsQuery } from './dto/list-tariffs.query.js';

/**
 * Phase 10 — the utility-config plane's tariff-schedule CRUD (create + read
 * only; a schedule is versioned and immutable once created — a corrected
 * tariff is a NEW schedule with a later `effectiveFrom`, mirroring how
 * Reading corrections post a new row rather than mutating one, see
 * schema.prisma's TariffSchedule doc comment). `currentFor` is the "tariff
 * in force" lookup a billing cycle snapshots onto
 * `BillingCycle.tariffScheduleId` — not wired to the billing pipeline here
 * (that's a different lane), just the lookup itself.
 */
@Injectable()
export class TariffScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates `dto.slabs`/`fixedCharges`/`dutyCess` via `parseTariffConfig`
   * — a malformed `slabs` array (see tariff-config.parser.ts's doc comment
   * on why this one throws instead of defaulting) is rejected with 400
   * BEFORE anything is persisted. `fixedCharges`/`dutyCess` are stored
   * exactly as given (defaulting to `{}` when omitted) — parseTariffConfig
   * is called here purely as a validation gate, not to normalise the
   * stored JSON; the all-zero defaulting it documents happens again,
   * identically, whenever a reader later parses this row.
   */
  async create(societyId: string, dto: CreateTariffScheduleDto, userId: string): Promise<TariffScheduleModel> {
    try {
      parseTariffConfig({ slabs: dto.slabs, fixedCharges: dto.fixedCharges, dutyCess: dto.dutyCess });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid tariff configuration');
    }

    return this.prisma.tariffSchedule.create({
      data: {
        societyId,
        utility: dto.utility,
        effectiveFrom: new Date(dto.effectiveFrom),
        slabs: dto.slabs as object,
        fixedCharges: (dto.fixedCharges ?? {}) as object,
        dutyCess: (dto.dutyCess ?? {}) as object,
        note: dto.note ?? null,
        createdById: userId,
      },
    });
  }

  /** Ordered newest-effective-first — the natural "history" view for a treasurer. */
  async list(societyId: string, params: ListTariffsQuery): Promise<TariffScheduleModel[]> {
    return this.prisma.tariffSchedule.findMany({
      where: { societyId, ...(params.utility ? { utility: params.utility } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * The schedule "in force" for `period` ('YYYY-MM'): the greatest
   * `effectiveFrom` that is <= the first calendar day of `period`. This is
   * exactly the lookup a billing cycle snapshots onto
   * `BillingCycle.tariffScheduleId` (see schema.prisma's TariffSchedule doc
   * comment) — 404s when no schedule has ever taken effect by that period,
   * since billing with no tariff at all would be a silent zero-rate charge.
   */
  async currentFor(societyId: string, utility: Utility, period: string): Promise<TariffScheduleModel> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('period must be in YYYY-MM format');
    }
    const periodStart = new Date(`${period}-01T00:00:00.000Z`);

    const schedule = await this.prisma.tariffSchedule.findFirst({
      where: { societyId, utility, effectiveFrom: { lte: periodStart } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!schedule) {
      throw new NotFoundException(`No ${utility} tariff schedule is in force for period ${period}`);
    }
    return schedule;
  }
}
