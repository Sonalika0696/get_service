import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { MeterKind, MeterStatus } from '../../../generated/prisma/enums.js';
import type { MeterModel } from '../../../generated/prisma/models.js';
import type { RegisterMeterDto } from './dto/register-meter.dto.js';
import type { ListMetersQuery } from './dto/list-meters.query.js';

/**
 * Phase 10 (BACKEND_HANDOFF.md / SOFTWARE_DESIGN.md §"electricity/water") —
 * the meter registry. A Meter is either a per-flat sub-meter (kind=FLAT,
 * `flatId` set) or a society-level meter (kind=COMMON/BULK, `flatId` null —
 * see the Meter model's doc comment in schema.prisma). This service owns
 * only the registry CRUD; deriving consumption/anomalies from a meter's
 * Readings is ReadingsService/reading-validation.util.ts's job.
 */
@Injectable()
export class MetersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a Meter. Cross-field rule (can't be expressed on RegisterMeterDto
   * alone): kind=FLAT requires a `flatId` belonging to this society;
   * kind=COMMON/BULK must NOT carry a `flatId` (both are society-level, not
   * tied to a unit). A duplicate `serial` within the same society (the
   * `@@unique([societyId, serial])` constraint) maps to 409, not a raw 500.
   */
  async register(societyId: string, dto: RegisterMeterDto): Promise<MeterModel> {
    let flatId: string | null = null;

    if (dto.kind === MeterKind.FLAT) {
      if (!dto.flatId) {
        throw new BadRequestException('flatId is required for a FLAT meter');
      }
      const flat = await this.prisma.flat.findUnique({ where: { id: dto.flatId } });
      if (!flat || flat.societyId !== societyId) {
        throw new BadRequestException('flatId does not belong to this society');
      }
      flatId = flat.id;
    } else if (dto.flatId) {
      throw new BadRequestException(`flatId must be omitted for a ${dto.kind} meter`);
    }

    try {
      return await this.prisma.meter.create({
        data: {
          societyId,
          flatId,
          utility: dto.utility,
          kind: dto.kind,
          serial: dto.serial,
          multiplier: dto.multiplier ?? 1,
          consumerNumber: dto.consumerNumber ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A meter with serial "${dto.serial}" already exists in this society`);
      }
      throw error;
    }
  }

  async list(societyId: string, query: ListMetersQuery): Promise<MeterModel[]> {
    return this.prisma.meter.findMany({
      where: {
        societyId,
        ...(query.utility ? { utility: query.utility } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.flatId ? { flatId: query.flatId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Idempotent: retiring an already-RETIRED meter is a no-op success (returns it unchanged), never an error. */
  async retire(societyId: string, meterId: string): Promise<MeterModel> {
    const meter = await this.findOwned(societyId, meterId);
    if (meter.status === MeterStatus.RETIRED) {
      return meter;
    }
    return this.prisma.meter.update({
      where: { id: meterId },
      data: { status: MeterStatus.RETIRED, retiredAt: new Date() },
    });
  }

  /** Shared existence/ownership check reused by ReadingsService before it accepts a reading against a meter. */
  async findOwned(societyId: string, meterId: string): Promise<MeterModel> {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter || meter.societyId !== societyId) {
      throw new NotFoundException('Meter not found');
    }
    return meter;
  }

  /** Same as findOwned, but additionally rejects a RETIRED meter — the gate ReadingsService.capture applies before accepting a new reading. */
  async assertActiveMeter(societyId: string, meterId: string): Promise<MeterModel> {
    const meter = await this.findOwned(societyId, meterId);
    if (meter.status === MeterStatus.RETIRED) {
      throw new BadRequestException('Meter is retired and cannot accept new readings');
    }
    return meter;
  }
}
