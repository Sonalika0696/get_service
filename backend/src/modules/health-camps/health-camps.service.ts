import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CampRegistrationStatus, HealthCampStatus, RatificationStatus } from '../../generated/prisma/enums.js';
import type { CampRegistrationModel, HealthCampModel } from '../../generated/prisma/models.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import type { CreateHealthCampDto } from './dto/create-health-camp.dto.js';
import type { RegisterCampDto } from './dto/register-camp.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Advisory-lock namespace reserved for THIS lane (p12cd) for camp-slot
 * capacity, keyed per slot id — see LANE_RULES.md §5 for every other
 * namespace already in use in this codebase (42 audit, 51 idempotency, 52/53
 * bulk-buy, 56 pocket-transfers, ...). Never used for anything else.
 */
const CAMP_SLOT_LOCK_NAMESPACE = 65;

export interface HealthCampSlotWithRemaining {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  remaining: number;
}

export interface HealthCampListItem extends HealthCampModel {
  slotCount: number;
}

export interface HealthCampDetail extends HealthCampModel {
  slots: HealthCampSlotWithRemaining[];
  /** The caller's own flat's registrations (never another flat's) — resident-facing detail only. */
  myRegistrations: CampRegistrationModel[];
}

export interface HealthCampPage {
  items: HealthCampListItem[];
  nextCursor: string | null;
}

export interface RosterRow {
  attendeeName: string;
  flatUnitNo: string;
  slotStartsAt: Date;
  slotEndsAt: Date;
}

export interface ListHealthCampsParams {
  cursor?: string;
  limit?: string;
}

@Injectable()
export class HealthCampsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly payments: PaymentsService,
  ) {}

  // -------------------------------------------------------------------
  // Committee
  // -------------------------------------------------------------------

  async create(societyId: string, createdById: string, dto: CreateHealthCampDto): Promise<HealthCampModel> {
    const campDate = new Date(dto.campDate);
    const registrationClosesAt = new Date(dto.registrationClosesAt);
    if (registrationClosesAt.getTime() > campDate.getTime()) {
      throw new BadRequestException('registrationClosesAt must be at or before campDate');
    }

    const dayStart = new Date(Date.UTC(campDate.getUTCFullYear(), campDate.getUTCMonth(), campDate.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const slots = [...dto.slots].map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), capacity: s.capacity }));
    for (const slot of slots) {
      if (slot.endsAt.getTime() <= slot.startsAt.getTime()) {
        throw new BadRequestException('Every slot must have endsAt after startsAt');
      }
      if (slot.startsAt.getTime() < dayStart.getTime() || slot.endsAt.getTime() > dayEnd.getTime()) {
        throw new BadRequestException('Every slot must fall within the camp date');
      }
      if (slot.capacity < 1) {
        throw new BadRequestException('Every slot must have capacity >= 1');
      }
    }

    const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startsAt.getTime() < sorted[i - 1].endsAt.getTime()) {
        throw new BadRequestException('Slots must not overlap');
      }
    }

    return this.prisma.healthCamp.create({
      data: {
        societyId,
        createdById,
        providerName: dto.providerName,
        title: dto.title,
        description: dto.description,
        venue: dto.venue,
        campDate,
        registrationClosesAt,
        chargePerRegistration: new Decimal(dto.chargePerRegistration),
        status: HealthCampStatus.OPEN,
        slots: { create: slots },
      },
    });
  }

  /** Cancels the camp, cancels every REGISTERED registration, and refunds paid ones in full. */
  async cancel(societyId: string, campId: string): Promise<HealthCampModel> {
    const toRefund: { registrationId: string; paymentId: string }[] = [];

    const camp = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.healthCamp.findUnique({ where: { id: campId } });
      if (!existing || existing.societyId !== societyId) {
        throw new NotFoundException('Health camp not found');
      }
      if (existing.status === HealthCampStatus.CANCELLED) {
        return existing;
      }
      if (existing.status === HealthCampStatus.COMPLETED) {
        throw new BadRequestException('A completed camp cannot be cancelled');
      }

      const registrations = await tx.campRegistration.findMany({
        where: { campId, status: CampRegistrationStatus.REGISTERED },
      });

      for (const reg of registrations) {
        if (reg.paidAmount.greaterThan(0) && reg.paymentId) {
          toRefund.push({ registrationId: reg.id, paymentId: reg.paymentId });
        }
      }

      await tx.campRegistration.updateMany({
        where: { campId, status: CampRegistrationStatus.REGISTERED },
        data: { status: CampRegistrationStatus.CANCELLED },
      });

      return tx.healthCamp.update({ where: { id: campId }, data: { status: HealthCampStatus.CANCELLED } });
    });

    // Refunds are external-API calls — run AFTER the state-transition commits,
    // never inside it. The registrations are already CANCELLED above; the
    // link handler's onRefunded is guarded (idempotent no-op) once the
    // refund.processed webhook eventually arrives.
    for (const { paymentId } of toRefund) {
      await this.payments.refund(societyId, paymentId);
    }

    return camp;
  }

  async complete(societyId: string, campId: string): Promise<HealthCampModel> {
    const camp = await this.getOwned(societyId, campId);
    if (camp.status === HealthCampStatus.CANCELLED || camp.status === HealthCampStatus.COMPLETED) {
      throw new BadRequestException(`Camp cannot be completed from status ${camp.status}`);
    }
    return this.prisma.healthCamp.update({ where: { id: campId }, data: { status: HealthCampStatus.COMPLETED } });
  }

  /** Scheduler stand-in (LANE_RULES.md §5): closes every OPEN camp past its registrationClosesAt. */
  async processDue(societyId: string): Promise<{ closed: number }> {
    const now = this.clock.now();
    const result = await this.prisma.healthCamp.updateMany({
      where: { societyId, status: HealthCampStatus.OPEN, registrationClosesAt: { lte: now } },
      data: { status: HealthCampStatus.CLOSED },
    });
    return { closed: result.count };
  }

  /**
   * Committee/provider roster — returns EXACTLY the 4 allowed fields per
   * REGISTERED registration (I5). Never widen this shape.
   */
  async roster(societyId: string, campId: string): Promise<RosterRow[]> {
    await this.getOwned(societyId, campId);
    const registrations = await this.prisma.campRegistration.findMany({
      where: { campId, status: CampRegistrationStatus.REGISTERED },
      include: { slot: { select: { startsAt: true, endsAt: true } }, flat: { select: { unitNo: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return registrations.map((r) => ({
      attendeeName: r.attendeeName,
      flatUnitNo: r.flat.unitNo,
      slotStartsAt: r.slot.startsAt,
      slotEndsAt: r.slot.endsAt,
    }));
  }

  // -------------------------------------------------------------------
  // Resident
  // -------------------------------------------------------------------

  async list(societyId: string, params: ListHealthCampsParams): Promise<HealthCampPage> {
    const limit = parsePageLimit(params.limit);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const cursorFilter: Prisma.HealthCampWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.sortValue!) } },
            { createdAt: new Date(cursor.sortValue!), id: { lt: cursor.id } },
          ],
        }
      : undefined;

    const rows = await this.prisma.healthCamp.findMany({
      where: { societyId, ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { slots: true } } },
      take: limit + 1,
    });

    const { items: pageRows, nextCursor } = buildPage(rows, limit, (row) => ({ sortValue: row.createdAt.toISOString(), id: row.id }));
    const items = pageRows.map(({ _count, ...camp }) => ({ ...camp, slotCount: _count.slots }));

    return { items, nextCursor };
  }

  async getDetail(societyId: string, residentId: string, campId: string): Promise<HealthCampDetail> {
    const camp = await this.prisma.healthCamp.findUnique({
      where: { id: campId },
      include: { slots: { include: { _count: { select: { registrations: { where: { status: CampRegistrationStatus.REGISTERED } } } } } } },
    });
    if (!camp || camp.societyId !== societyId) {
      throw new NotFoundException('Health camp not found');
    }

    const { slots, ...campFields } = camp;
    const flat = await this.activeFlatId(societyId, residentId).catch(() => null);
    const myRegistrations = flat
      ? await this.prisma.campRegistration.findMany({ where: { campId, flatId: flat } })
      : [];

    return {
      ...campFields,
      slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, capacity: s.capacity, remaining: s.capacity - s._count.registrations })),
      myRegistrations,
    };
  }

  async register(societyId: string, residentId: string, campId: string, dto: RegisterCampDto): Promise<CampRegistrationModel> {
    const flatId = await this.activeFlatId(societyId, residentId);

    const registration = await this.prisma.$transaction(async (tx) => {
      // First statement — serializes every registration attempt for a given
      // slot, so the last seat is never double-booked.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CAMP_SLOT_LOCK_NAMESPACE}, hashtext(${dto.slotId}))`;

      const camp = await tx.healthCamp.findUnique({ where: { id: campId } });
      if (!camp || camp.societyId !== societyId) {
        throw new NotFoundException('Health camp not found');
      }
      if (camp.status !== HealthCampStatus.OPEN) {
        throw new BadRequestException(`Camp is not open for registration (status=${camp.status})`);
      }
      if (this.clock.now().getTime() >= camp.registrationClosesAt.getTime()) {
        throw new BadRequestException('Registration for this camp has closed');
      }

      const slot = await tx.healthCampSlot.findUnique({ where: { id: dto.slotId } });
      if (!slot || slot.campId !== campId) {
        throw new BadRequestException('Slot does not belong to this camp');
      }

      const takenCount = await tx.campRegistration.count({ where: { slotId: slot.id, status: CampRegistrationStatus.REGISTERED } });
      if (takenCount >= slot.capacity) {
        throw new ConflictException('This slot is full');
      }

      let created: CampRegistrationModel;
      try {
        created = await tx.campRegistration.create({
          data: {
            campId,
            slotId: slot.id,
            flatId,
            residentId,
            attendeeName: dto.attendeeName,
            status: CampRegistrationStatus.REGISTERED,
            amountDue: camp.chargePerRegistration,
            paidAmount: 0,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('This flat has already registered this attendee for this camp');
        }
        throw error;
      }

      if (camp.chargePerRegistration.greaterThan(0)) {
        const payment = await this.payments.createOrderForLink(
          {
            societyId,
            residentId,
            amount: camp.chargePerRegistration,
            purpose: `Health camp registration: ${camp.title}`,
            linkedEntityType: 'CampRegistration',
            linkedEntityId: created.id,
            idempotencyKey: `camp-registration:${created.id}`,
          },
          tx,
        );
        created = await tx.campRegistration.update({ where: { id: created.id }, data: { paymentId: payment.id } });
      }

      return created;
    });

    return registration;
  }

  async cancelRegistration(societyId: string, residentId: string, campId: string, regId: string): Promise<CampRegistrationModel> {
    const flatId = await this.activeFlatId(societyId, residentId);

    const registration = await this.prisma.campRegistration.findUnique({ where: { id: regId } });
    if (!registration || registration.campId !== campId) {
      throw new NotFoundException('Registration not found');
    }
    if (registration.flatId !== flatId) {
      throw new ForbiddenException("Cannot cancel another flat's registration");
    }
    if (registration.status === CampRegistrationStatus.CANCELLED) {
      return registration;
    }

    const updated = await this.prisma.campRegistration.update({ where: { id: regId }, data: { status: CampRegistrationStatus.CANCELLED } });

    if (registration.paidAmount.greaterThan(0) && registration.paymentId) {
      await this.payments.refund(societyId, registration.paymentId);
    }

    return updated;
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async getOwned(societyId: string, campId: string): Promise<HealthCampModel> {
    const camp = await this.prisma.healthCamp.findUnique({ where: { id: campId } });
    if (!camp || camp.societyId !== societyId) {
      throw new NotFoundException('Health camp not found');
    }
    return camp;
  }

  /** The caller's own flat, resolved server-side from their active RATIFIED occupancy — never client-supplied (see society-roles.service.ts's identical pattern). */
  private async activeFlatId(societyId: string, residentId: string): Promise<string> {
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId: residentId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED, flat: { societyId } },
      select: { flatId: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a ratified resident of this society');
    }
    return occupancy.flatId;
  }
}
