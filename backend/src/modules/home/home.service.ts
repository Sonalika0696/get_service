import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { MaintenanceChargeStatus, ServiceRequestStatus } from '../../generated/prisma/enums.js';

export interface HomeJoinableServiceRequest {
  id: string;
  title: string;
  status: ServiceRequestStatus;
  participantCount: number;
  threshold: number | null;
}

export interface HomeAggregate {
  amountDue: string;
  overdueCount: number;
  actionsNeeded: number;
  joinableServiceRequests: HomeJoinableServiceRequest[];
  /** Phase 11 (Event entity) will populate this — empty until then. */
  upcomingEvents: [];
}

/**
 * Phase 9.4 — mobile home-tab aggregate for the current resident. Deliberately
 * does NOT depend on the 9.2 maintenance service or the 9.3 bills service
 * (both built in parallel, in sibling worktrees) — it reads MaintenanceCharge
 * / ServiceRequest / Participation / Occupancy directly, the same way
 * DashboardService reads Prisma directly rather than reaching into other
 * modules' service classes (see that class's doc comment for the same
 * rationale).
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async aggregate(residentId: string, societyId: string): Promise<HomeAggregate> {
    const now = this.clock.now();

    // Resident's flat(s): only a LIVE (tenureEndedAt: null), RATIFIED
    // occupancy counts as "their" flat — mirrors
    // ServiceRequestsService.join's own occupancy lookup and
    // DashboardService.countResidents' RATIFIED + tenureEndedAt:null filter.
    const occupancies = await this.prisma.occupancy.findMany({
      where: { userId: residentId, tenureEndedAt: null, ratificationStatus: 'RATIFIED' },
      select: { flatId: true },
    });
    const flatIds = occupancies.map((o) => o.flatId);

    const [charges, openRequests] = await Promise.all([
      flatIds.length === 0
        ? Promise.resolve([])
        : this.prisma.maintenanceCharge.findMany({
            where: {
              flatId: { in: flatIds },
              status: { notIn: [MaintenanceChargeStatus.PAID, MaintenanceChargeStatus.WAIVED] },
            },
            select: { amount: true, lateFeeAccrued: true, paidAmount: true, dueDate: true },
          }),
      // "Joinable" = the same window ServiceRequestsService.join itself
      // enforces before creating a Participation: status OPEN and closesAt
      // still in the future (see that method's own two guard checks).
      this.prisma.serviceRequest.findMany({
        where: { societyId, status: ServiceRequestStatus.OPEN, closesAt: { gt: now } },
        select: {
          id: true,
          title: true,
          status: true,
          threshold: true,
          participations: { where: { status: 'ACTIVE' }, select: { id: true } },
        },
        orderBy: { closesAt: 'asc' },
        take: 10,
      }),
    ]);

    let amountDue = 0;
    let overdueCount = 0;
    for (const charge of charges) {
      const balance = Number(charge.amount) + Number(charge.lateFeeAccrued) - Number(charge.paidAmount);
      amountDue += balance;
      if (charge.dueDate.getTime() < now.getTime()) {
        overdueCount += 1;
      }
    }

    // "Actions needed" — today the only cheap, honest signal available
    // without reaching into an unbuilt/sibling module (Phase 9.2/9.3, or
    // the Phase 11 Event entity) is the same overdue-charge count above;
    // kept as its own field (rather than aliasing overdueCount in the
    // response) so a future phase can broaden it without a shape change.
    const actionsNeeded = overdueCount;

    const joinableServiceRequests: HomeJoinableServiceRequest[] = openRequests.map((sr) => ({
      id: sr.id,
      title: sr.title,
      status: sr.status,
      participantCount: sr.participations.length,
      threshold: sr.threshold,
    }));

    return {
      amountDue: amountDue.toFixed(2),
      overdueCount,
      actionsNeeded,
      joinableServiceRequests,
      // Phase 11: Event entity does not exist yet — populate here once it does.
      upcomingEvents: [],
    };
  }
}
