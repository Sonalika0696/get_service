import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService, type AppendAuditLogInput } from '../audit/audit.service.js';
import { BulkBuyService } from '../bulk-buy/bulk-buy.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService, type DomainEventType } from '../realtime/realtime.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  JobCardTier,
  ParticipationStatus,
  PricingCardStatus,
  ServiceRequestOrigin,
  ServiceRequestStatus,
  ServiceRequestType,
} from '../../generated/prisma/enums.js';
import type { ServiceRequestModel } from '../../generated/prisma/models.js';
import { resolveServiceRequestThreshold } from './service-request-threshold.util.js';
import type { CreateServiceRequestDto } from './dto/create-service-request.dto.js';
import type { CreateServiceRequestCommitteeDto } from './dto/create-service-request-committee.dto.js';
import type { AssignVendorDto } from './dto/assign-vendor.dto.js';
import type { ConfirmServiceRequestDto } from './dto/confirm-service-request.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** Kind of Phase 8.3 lifecycle transition a service-request notification is reporting. */
type ServiceRequestNotificationKind = 'pooled' | 'assigned' | 'confirmed';

/**
 * Phase 8.3: what dispatchNotifications needs to fan mail out AFTER a
 * transaction has committed — just the recipient list plus enough context
 * to pick a template. No DB handles — those only live inside the tx that
 * produced this. Mirrors PollsService's PendingNotification exactly (see
 * that file's doc comment for the post-commit/best-effort rationale this
 * reuses verbatim).
 */
interface PendingServiceRequestNotification {
  requestId: string;
  title: string;
  kind: ServiceRequestNotificationKind;
  recipientEmails: string[];
}

/** Lean, non-sensitive real-time push payload — clients refetch full detail via REST; no money/contribution fields ride along here. */
interface ServiceRequestRealtimePayload {
  id: string;
  type: string;
  title: string;
  status: string;
  societyId: string;
}

/**
 * Phase 8.2: serializes join() (threshold evaluation) and confirm() on the
 * SAME ServiceRequest against each other — same shape as
 * BulkBuyService.RESIDENT_POLL_FIRE_LOCK_NAMESPACE (53) and
 * PAYOUT_LOCK_NAMESPACE (52), a NEW namespace since this locks a different
 * entity/lifecycle than either of those. Taken as the FIRST statement in
 * every transaction that reads-then-decides on a request's participation
 * count or status, so a resident joining at the exact instant a committee
 * member confirms can't race past POOLED/ASSIGNED into a state where the
 * confirm reads a stale participant list.
 */
const SERVICE_REQUEST_LOCK_NAMESPACE = 54;

/** API-facing shape: the request row plus a live participant count, the caller's own join state, and (once CONFIRMED) the Booking it fired into. */
export type ServiceRequestDetail = ServiceRequestModel & {
  participantCount: number;
  hasJoined?: boolean;
  bookingId: string | null;
};

/**
 * Phase 8.2 (BACKEND_PLAN.md Phase 8 item 2) — the NEW ServiceRequest
 * pooling loop, built ADDITIVELY alongside the Phase 3 EVENT poll engine
 * (src/modules/polls) and the Phase 5 Flow B resident-polls path
 * (BulkBuyService's "Resident polls (Flow B)" section) — neither of those
 * is touched or retired here (that's Phase 8.3's job); this module owns
 * ServiceRequestType.SERVICE_REQUEST end-to-end, exactly like BulkBuyService
 * owns BULK_BUY_RESIDENT (see PollsService's ownership-split guards).
 *
 * Lifecycle: create (RESIDENT or COMMITTEE origin) -> join (threshold
 * evaluated on each join; OPEN -> POOLED once met) -> assign (a COMMITTEE
 * member names a vendor already linked to the society with a current
 * PUBLISHED PricingCard for the category; OPEN/POOLED -> ASSIGNED) ->
 * confirm (a COMMITTEE member relays the assigned vendor's EXPLICIT
 * per-flat quote — no vendor login on this path yet, same stance as
 * BulkBuyService's vendorConfirm/Flow B; ASSIGNED -> CONFIRMED, the
 * vendor's current PricingCard is FROZEN onto the request, and the escrow
 * Booking/Payments are created via BulkBuyService.createBookingWithEscrow —
 * the EXACT SAME helper Flow A/Flow B fire down). A request can also LAPSE:
 * structurally (closeBelowThreshold: OPEN past closesAt with too few
 * participants — no money has ever existed yet, so there is nothing to
 * reverse) or via decline (a committee-relayed vendor decline from
 * ASSIGNED — also structural, since confirm/escrow hasn't happened yet).
 *
 * Money-safety notes:
 *  - The vendor's quote at confirm is an EXPLICIT figure the caller
 *    supplies (ConfirmServiceRequestDto.contribution), never auto-summed
 *    from the frozen PricingCard's lines — the card is evidence of what the
 *    vendor is capable of charging for this category, not a computed total
 *    (a real job's mix of PER_VISIT/PER_HOUR/PER_UNIT/PERCENTAGE lines has
 *    no single canonical "total" without human judgement about what this
 *    specific job needs).
 *  - The SAME quoted contribution is charged to every participating flat
 *    (one escrow Payment per ACTIVE Participation, all at that one
 *    contribution figure) — this loop has no per-resident discount ladder,
 *    unlike Flow A/Flow B.
 *  - Everything downstream of confirm (webhook capture, ledger posting,
 *    JobCard sign-off, payout) is the UNMODIFIED Flow A/Flow B rail — a
 *    Booking fired from here (sourceType='SERVICE_REQUEST') is
 *    indistinguishable from a Flow B one except for the ServiceRequest row
 *    it points at carrying origin/threshold/assignedVendorId/etc.
 */
@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly bulkBuy: BulkBuyService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // -------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------

  /** A resident raises a request for their OWN flat (resolved from their active occupancy — never client-supplied). */
  async createResident(societyId: string, residentId: string, dto: CreateServiceRequestDto): Promise<ServiceRequestDetail> {
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId: residentId, tenureEndedAt: null, flat: { societyId } },
      select: { flatId: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }
    return this.createInternal(societyId, residentId, occupancy.flatId, ServiceRequestOrigin.RESIDENT, dto);
  }

  /** A COMMITTEE member raises a request on a NAMED flat's behalf (e.g. a common-area issue). */
  async createCommittee(societyId: string, actorId: string, dto: CreateServiceRequestCommitteeDto): Promise<ServiceRequestDetail> {
    const flat = await this.prisma.flat.findUnique({ where: { id: dto.raisedByFlatId } });
    if (!flat || flat.societyId !== societyId) {
      throw new NotFoundException('Flat not found in this society');
    }
    return this.createInternal(societyId, actorId, flat.id, ServiceRequestOrigin.COMMITTEE, dto);
  }

  private async createInternal(
    societyId: string,
    creatorId: string,
    raisedByFlatId: string,
    origin: ServiceRequestOrigin,
    dto: CreateServiceRequestDto,
  ): Promise<ServiceRequestDetail> {
    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('closesAt must be a valid date in the future');
    }

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    const threshold = resolveServiceRequestThreshold(dto.category, society.config);

    const created = await this.prisma.serviceRequest.create({
      data: {
        societyId,
        creatorId,
        pollType: ServiceRequestType.SERVICE_REQUEST,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        closesAt,
        status: ServiceRequestStatus.OPEN,
        origin,
        raisedByFlatId,
        threshold,
      },
    });

    // Post-commit, best-effort (see pushRealtime's doc comment) — the row
    // is already durably created above; this is a live-push convenience on
    // top of it, never a precondition for the create to have succeeded.
    await this.pushRealtime('service_request.created', created);

    return this.toDetail(created, creatorId);
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  async list(societyId: string, callerId: string, status?: ServiceRequestStatus): Promise<ServiceRequestDetail[]> {
    const requests = await this.prisma.serviceRequest.findMany({
      where: { societyId, pollType: ServiceRequestType.SERVICE_REQUEST, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(requests.map((r) => this.toDetail(r, callerId)));
  }

  async get(societyId: string, id: string, callerId: string): Promise<ServiceRequestDetail> {
    const sr = await this.getInternal(societyId, id);
    return this.toDetail(sr, callerId);
  }

  // -------------------------------------------------------------------
  // Join
  // -------------------------------------------------------------------

  /**
   * Resident joins: one Participation per FLAT (not merely per resident —
   * enforced here in application code, under the advisory lock, since the
   * shared Participation table's own DB unique constraint is still keyed
   * on [serviceRequestId, residentId] for the older pollTypes). Re-checks
   * the ACTIVE participant count and status inside the SAME
   * advisory-locked transaction to decide whether to flip OPEN -> POOLED,
   * mirroring BulkBuyService.joinResidentPoll's synchronous auto-pool
   * pattern exactly.
   */
  async join(societyId: string, id: string, residentId: string): Promise<ServiceRequestDetail> {
    const sr = await this.getInternal(societyId, id);
    if (sr.status !== ServiceRequestStatus.OPEN) {
      throw new BadRequestException(`Service request is not open for joining (status=${sr.status})`);
    }
    if (sr.closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('Service request closesAt has passed');
    }

    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId: residentId, tenureEndedAt: null, flat: { societyId } },
      select: { flatId: true },
    });
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }

    let pooledAudit: AppendAuditLogInput | null = null;
    let pooledNotification: PendingServiceRequestNotification | null = null;

    await this.prisma.$transaction(async (tx) => {
      // Must be the first statement — see SERVICE_REQUEST_LOCK_NAMESPACE's
      // doc comment: serializes against every other join AND against
      // confirm() on this same request.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SERVICE_REQUEST_LOCK_NAMESPACE}, hashtext(${id}))`;

      const existingForFlat = await tx.participation.findFirst({
        where: { serviceRequestId: id, flatId: occupancy.flatId, status: ParticipationStatus.ACTIVE },
      });
      if (existingForFlat) {
        throw new ConflictException('This flat has already joined this service request');
      }

      try {
        await tx.participation.create({ data: { serviceRequestId: id, residentId, flatId: occupancy.flatId, status: ParticipationStatus.ACTIVE } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Already joined');
        }
        throw error;
      }

      const stillOpen = await tx.serviceRequest.findUnique({ where: { id }, select: { status: true, threshold: true } });
      if (!stillOpen || stillOpen.status !== ServiceRequestStatus.OPEN || stillOpen.threshold === null) {
        return;
      }

      const activeCount = await tx.participation.count({ where: { serviceRequestId: id, status: ParticipationStatus.ACTIVE } });
      if (activeCount >= stillOpen.threshold) {
        const now = this.clock.now();
        await tx.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.POOLED, pooledAt: now } });
        pooledAudit = {
          societyId,
          actorId: residentId,
          action: 'SERVICE_REQUEST_POOLED',
          subjectType: 'ServiceRequest',
          subjectId: id,
          payload: { threshold: stillOpen.threshold, participantCount: activeCount },
        };
        // Read-only, still inside the tx — see collectRecipients's doc
        // comment. Dispatch itself happens only after this transaction
        // has committed, below.
        pooledNotification = await this.collectRecipients(tx, id, sr.title, 'pooled');
      }
    });

    if (pooledAudit) {
      await this.auditService.appendBestEffort(pooledAudit);
    }
    if (pooledNotification) {
      await this.dispatchNotifications(pooledNotification);
      // Reuses the exact same "did this transition actually happen" signal
      // as the notification dispatch above (both are only set once the tx
      // flipped status to POOLED) — post-commit, best-effort, right
      // alongside it.
      await this.pushRealtime('service_request.pooled', { id, pollType: sr.pollType, title: sr.title, status: ServiceRequestStatus.POOLED, societyId });
    }

    return this.get(societyId, id, residentId);
  }

  // -------------------------------------------------------------------
  // Committee: assign vendor
  // -------------------------------------------------------------------

  /**
   * A COMMITTEE member assigns a vendor from OPEN or POOLED. Pre-checks:
   * the vendor is linked to this society (VendorSocietyLink) AND holds a
   * current PUBLISHED PricingCard for the request's category — 400
   * otherwise (never NotFound, so a committee member gets an actionable
   * reason rather than a bare 404). Uses a conditional `updateMany`
   * (status IN [OPEN, POOLED]) rather than a raw advisory lock — a single
   * committee actor is expected to drive assignment (no join/confirm race
   * touches this transition), same "single-writer" stance the task spec
   * calls out — but the conditional update still closes the narrow window
   * of two committee members racing to assign different vendors.
   */
  async assignVendor(societyId: string, id: string, actorId: string, dto: AssignVendorDto): Promise<ServiceRequestDetail> {
    const sr = await this.getInternal(societyId, id);
    if (sr.status !== ServiceRequestStatus.OPEN && sr.status !== ServiceRequestStatus.POOLED) {
      throw new BadRequestException(`Service request cannot be assigned a vendor (status=${sr.status})`);
    }

    const link = await this.prisma.vendorSocietyLink.findUnique({ where: { vendorId_societyId: { vendorId: dto.vendorId, societyId } } });
    if (!link) {
      throw new BadRequestException('Vendor is not linked to this society');
    }
    if (!sr.category) {
      throw new BadRequestException('Service request has no category to match a pricing card against');
    }
    const card = await this.prisma.pricingCard.findFirst({
      where: { vendorId: dto.vendorId, category: sr.category, status: PricingCardStatus.PUBLISHED, supersededAt: null },
    });
    if (!card) {
      throw new BadRequestException(`Vendor has no published pricing card for category "${sr.category}"`);
    }

    const now = this.clock.now();

    // Wrapped in a transaction purely so recipient collection for the
    // post-commit notification reads the SAME committed snapshot as the
    // status flip (collectRecipients's read-only-inside-tx contract) —
    // the conditional updateMany itself is still the only write here,
    // preserving the single-writer/no-advisory-lock stance from this
    // method's own doc comment.
    let assignedNotification: PendingServiceRequestNotification | null = null;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.serviceRequest.updateMany({
        where: { id, status: { in: [ServiceRequestStatus.OPEN, ServiceRequestStatus.POOLED] } },
        data: { status: ServiceRequestStatus.ASSIGNED, assignedVendorId: dto.vendorId, assignedAt: now, assignedByUserId: actorId },
      });
      if (result.count === 0) {
        throw new BadRequestException('Service request was assigned or moved on by a concurrent request');
      }
      assignedNotification = await this.collectRecipients(tx, id, sr.title, 'assigned');
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'SERVICE_REQUEST_ASSIGNED',
      subjectType: 'ServiceRequest',
      subjectId: id,
      payload: { vendorId: dto.vendorId, category: sr.category, pricingCardId: card.id },
    });
    if (assignedNotification) {
      await this.dispatchNotifications(assignedNotification);
      await this.pushRealtime('service_request.assigned', { id, pollType: sr.pollType, title: sr.title, status: ServiceRequestStatus.ASSIGNED, societyId });
    }

    return this.get(societyId, id, actorId);
  }

  // -------------------------------------------------------------------
  // Committee: confirm (relays the vendor's confirmation) — the money step
  // -------------------------------------------------------------------

  /**
   * Committee-relayed vendor confirmation (no vendor login on this path
   * yet — mirrors Flow B's vendorConfirm stopgap): ASSIGNED -> CONFIRMED.
   * Freezes the assigned vendor's CURRENT published PricingCard for the
   * request's category onto `frozenPricingCardId` (re-checked here, not
   * trusted from assign-time, in case it was revised/republished in the
   * meantime — assign only guaranteed one existed AT THAT MOMENT); sets
   * `vendorConfirmedContribution` from the caller's EXPLICIT quote (see
   * ConfirmServiceRequestDto's doc comment for why this is never
   * auto-summed); then creates the Booking + one escrow Payment per ACTIVE
   * Participation's flat, ALL at that one quoted contribution, by calling
   * BulkBuyService.createBookingWithEscrow — the exact same helper Flow
   * A/Flow B fire down, called from INSIDE this method's own transaction
   * (never a second one). Every participating flat ends up with the
   * IDENTICAL frozenPricingCardId/contribution recorded on both the
   * ServiceRequest and its own Participation row.
   *
   * Under the same per-request advisory lock (namespace 54) as join() —
   * see SERVICE_REQUEST_LOCK_NAMESPACE's doc comment — so a resident
   * joining at the exact instant of confirm can't slip in after the
   * participant snapshot this call escrows against.
   */
  async confirm(societyId: string, id: string, actorId: string, dto: ConfirmServiceRequestDto): Promise<ServiceRequestDetail> {
    let executedAudit: AppendAuditLogInput | null = null;
    let confirmedNotification: PendingServiceRequestNotification | null = null;
    // Captured alongside confirmedNotification, as its own primitive,
    // purely so the post-tx realtime push below doesn't need to dereference
    // a property off a variable TS can't keep narrowed past the
    // dispatchNotifications await (it's reassigned inside the $transaction
    // closure above) — see PollsService.pushRealtime's callers for the same
    // shape.
    let confirmedTitle: string | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SERVICE_REQUEST_LOCK_NAMESPACE}, hashtext(${id}))`;

      const sr = await tx.serviceRequest.findUnique({ where: { id } });
      if (!sr || sr.societyId !== societyId || sr.pollType !== ServiceRequestType.SERVICE_REQUEST) {
        throw new NotFoundException('Service request not found');
      }
      if (sr.status !== ServiceRequestStatus.ASSIGNED) {
        throw new BadRequestException(`Service request is not ASSIGNED (status=${sr.status})`);
      }
      if (!sr.assignedVendorId || !sr.category) {
        // Shouldn't happen — assignVendor always sets both together.
        throw new BadRequestException('Service request has no assigned vendor/category to confirm against');
      }

      const card = await tx.pricingCard.findFirst({
        where: { vendorId: sr.assignedVendorId, category: sr.category, status: PricingCardStatus.PUBLISHED, supersededAt: null },
      });
      if (!card) {
        throw new BadRequestException('The assigned vendor no longer has a published pricing card for this category');
      }

      const participations = await tx.participation.findMany({
        where: { serviceRequestId: id, status: ParticipationStatus.ACTIVE },
        include: { resident: true },
      });
      if (participations.length === 0) {
        throw new BadRequestException('No active participants to confirm against');
      }

      // Read-only, still inside the tx — see collectRecipients's doc
      // comment. Built from the same participations snapshot the escrow
      // is about to be created against; dispatch happens only after this
      // transaction (money and all) has committed, below.
      confirmedNotification = {
        requestId: id,
        title: sr.title,
        kind: 'confirmed',
        recipientEmails: participations.map((p) => p.resident.email),
      };
      confirmedTitle = sr.title;

      const contribution = new Decimal(dto.contribution).toDecimalPlaces(2);
      const now = this.clock.now();

      const updated = await tx.serviceRequest.update({
        where: { id },
        data: {
          status: ServiceRequestStatus.CONFIRMED,
          vendorConfirmedAt: now,
          vendorConfirmedContribution: contribution,
          frozenPricingCardId: card.id,
        },
      });

      const participants: { commitmentId: string; residentId: string; flatId: string }[] = [];
      for (const participation of participations) {
        const commitment = await tx.commitment.create({
          data: { serviceRequestId: id, residentId: participation.residentId, flatId: participation.flatId },
        });
        participants.push({ commitmentId: commitment.id, residentId: participation.residentId, flatId: participation.flatId });
        await tx.participation.update({ where: { id: participation.id }, data: { contribution } });
      }

      // Reuse Flow A/Flow B's exact booking/escrow helper — see this
      // method's doc comment and createBookingWithEscrow's own updated
      // doc comment (Phase 8.2 made it public for this call).
      await this.bulkBuy.createBookingWithEscrow(tx, {
        societyId,
        vendorId: sr.assignedVendorId,
        sourceType: 'SERVICE_REQUEST',
        sourceId: id,
        tier: JobCardTier.SMALL,
        milestoneTemplate: null,
        retentionDays: null,
        discountedUnitPrice: contribution,
        appliedDiscountPct: 0,
        scope: sr.title,
        idempotencyPrefix: `service-request:${id}`,
        participants,
      });

      executedAudit = {
        societyId,
        actorId,
        action: 'SERVICE_REQUEST_CARD_FROZEN',
        subjectType: 'ServiceRequest',
        subjectId: id,
        payload: { vendorId: sr.assignedVendorId, category: sr.category, pricingCardId: card.id, version: card.version, contribution: contribution.toString() },
      };

      return this.loadDetail(tx, updated, null);
    });

    if (executedAudit) {
      await this.auditService.appendBestEffort(executedAudit);
    }
    if (confirmedNotification) {
      await this.dispatchNotifications(confirmedNotification);
    }
    if (confirmedTitle) {
      // Escrow/booking/commitments are already committed by this point
      // (the transaction above returned) — this push is a pure convenience
      // on top of that, never a precondition of it. pollType is always
      // SERVICE_REQUEST here (checked inside the tx above).
      await this.pushRealtime('service_request.confirmed', {
        id,
        pollType: ServiceRequestType.SERVICE_REQUEST,
        title: confirmedTitle,
        status: ServiceRequestStatus.CONFIRMED,
        societyId,
      });
    }

    return detail;
  }

  // -------------------------------------------------------------------
  // Committee-relayed decline / structural below-threshold close
  // -------------------------------------------------------------------

  /** Committee-relayed vendor decline — ASSIGNED -> LAPSED. Structural: confirm never ran, so no Payment/escrow exists to reverse. */
  async decline(societyId: string, id: string, actorId: string): Promise<ServiceRequestDetail> {
    const sr = await this.getInternal(societyId, id);
    if (sr.status !== ServiceRequestStatus.ASSIGNED) {
      throw new BadRequestException(`Service request is not ASSIGNED (status=${sr.status})`);
    }

    const now = this.clock.now();
    const updated = await this.prisma.serviceRequest.update({
      where: { id },
      data: { status: ServiceRequestStatus.LAPSED, vendorDeclinedAt: now, closedAt: now },
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'SERVICE_REQUEST_LAPSED',
      subjectType: 'ServiceRequest',
      subjectId: id,
      payload: { reason: 'vendor_declined', assignedVendorId: sr.assignedVendorId },
    });

    return this.toDetail(updated, actorId);
  }

  /**
   * Committee-triggered stand-in for a scheduler (v1 has none — same stance
   * as PollsService.processExpired / BulkBuyService.rollOffer): closes an
   * OPEN request whose closesAt has passed without reaching threshold.
   * STRUCTURAL — no Payment/escrow has ever existed for a request that
   * never left OPEN, so there is nothing to reverse; every Participation on
   * it is flipped LAPSED too (they no longer count toward anything).
   */
  async closeBelowThreshold(societyId: string, id: string, actorId: string): Promise<ServiceRequestDetail> {
    const sr = await this.getInternal(societyId, id);
    if (sr.status !== ServiceRequestStatus.OPEN) {
      throw new BadRequestException(`Service request is not OPEN (status=${sr.status})`);
    }
    if (sr.closesAt.getTime() > this.clock.now().getTime()) {
      throw new BadRequestException('Service request closesAt has not passed yet');
    }

    const activeCount = await this.prisma.participation.count({ where: { serviceRequestId: id, status: ParticipationStatus.ACTIVE } });
    if (sr.threshold !== null && activeCount >= sr.threshold) {
      throw new BadRequestException('Threshold was already met — this request should have pooled, not closed');
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.LAPSED, closedAt: now } });
      await tx.participation.updateMany({ where: { serviceRequestId: id, status: ParticipationStatus.ACTIVE }, data: { status: ParticipationStatus.LAPSED } });
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'SERVICE_REQUEST_LAPSED',
      subjectType: 'ServiceRequest',
      subjectId: id,
      payload: { reason: 'below_threshold', threshold: sr.threshold, participantCount: activeCount },
    });

    return this.get(societyId, id, actorId);
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Phase 8.3 — read-only, runs INSIDE the caller's transaction: gathers
   * who to notify for a pooled/assigned/confirmed transition — never
   * calls the mailer. Mirrors PollsService.collectRecipients exactly.
   */
  private async collectRecipients(
    tx: Prisma.TransactionClient,
    id: string,
    title: string,
    kind: ServiceRequestNotificationKind,
  ): Promise<PendingServiceRequestNotification> {
    const participations = await tx.participation.findMany({
      where: { serviceRequestId: id, status: ParticipationStatus.ACTIVE },
      include: { resident: true },
    });
    return { requestId: id, title, kind, recipientEmails: participations.map((p) => p.resident.email) };
  }

  /**
   * Phase 8.3 — runs AFTER the transaction has committed. Best-effort:
   * each send is isolated in its own try/catch so one recipient's
   * bounced/broken mailbox can't stop the rest of the batch, and any
   * failure is logged rather than thrown — this must never be able to
   * roll back or otherwise reverse the already-committed POOLED / ASSIGNED
   * / CONFIRMED transition (or, for CONFIRMED, the escrow it created).
   * Mirrors PollsService.dispatchNotifications exactly.
   */
  private async dispatchNotifications(pending: PendingServiceRequestNotification): Promise<void> {
    for (const email of pending.recipientEmails) {
      try {
        if (pending.kind === 'pooled') {
          await this.notifications.sendServiceRequestPooled(email, pending.title);
        } else if (pending.kind === 'assigned') {
          await this.notifications.sendVendorAssigned(email, pending.title);
        } else {
          await this.notifications.sendVendorConfirmed(email, pending.title);
        }
      } catch (error) {
        this.logger.error(
          `Post-commit service-request-${pending.kind} notification failed for request ${pending.requestId} -> ${email} (state change already committed)`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Post-commit, best-effort real-time push — called from the exact same
   * spots as dispatchNotifications, right alongside it. RealtimeService's
   * own emitToSociety already never throws (see its doc comment), but this
   * wraps the call again anyway: a live-push failure — of ANY kind,
   * including a misbehaving RealtimeService — must never be able to make
   * an already-committed create/pool/assign/confirm look like it failed to
   * the caller.
   */
  private async pushRealtime(type: DomainEventType, sr: { id: string; pollType: string; title: string; status: string; societyId: string }): Promise<void> {
    try {
      await this.realtime.emitToSociety(sr.societyId, type, {
        id: sr.id,
        type: sr.pollType,
        title: sr.title,
        status: sr.status,
        societyId: sr.societyId,
      } satisfies ServiceRequestRealtimePayload);
    } catch (error) {
      this.logger.error(`Post-commit realtime push "${type}" failed for request ${sr.id} (state change already committed)`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async getInternal(societyId: string, id: string): Promise<ServiceRequestModel> {
    const sr = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!sr || sr.societyId !== societyId || sr.pollType !== ServiceRequestType.SERVICE_REQUEST) {
      throw new NotFoundException('Service request not found');
    }
    return sr;
  }

  private async toDetail(sr: ServiceRequestModel, callerId: string | null): Promise<ServiceRequestDetail> {
    return this.loadDetail(this.prisma, sr, callerId);
  }

  private async loadDetail(client: PrismaService | Prisma.TransactionClient, sr: ServiceRequestModel, callerId: string | null): Promise<ServiceRequestDetail> {
    const [participantCount, hasJoined, booking] = await Promise.all([
      client.participation.count({ where: { serviceRequestId: sr.id, status: ParticipationStatus.ACTIVE } }),
      callerId
        ? client.participation
            .findUnique({ where: { serviceRequestId_residentId: { serviceRequestId: sr.id, residentId: callerId } } })
            .then((p) => Boolean(p && p.status === ParticipationStatus.ACTIVE))
        : Promise.resolve(undefined),
      sr.status === ServiceRequestStatus.CONFIRMED ? client.booking.findFirst({ where: { sourceType: 'SERVICE_REQUEST', sourceId: sr.id } }) : Promise.resolve(null),
    ]);

    return {
      ...sr,
      participantCount,
      ...(callerId ? { hasJoined } : {}),
      bookingId: booking?.id ?? null,
    };
  }
}
