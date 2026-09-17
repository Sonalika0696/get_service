import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AuditService, type AppendAuditLogInput } from '../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, DonationMode, RoleKind, WelfareDisbursementStatus } from '../../generated/prisma/enums.js';
import type { WelfareDisbursementModel } from '../../generated/prisma/models.js';
import { parseApprovalConfig } from '../bulk-buy/approval-ladder.util.js';
import { requiredDisbursementApprovers } from './welfare-disbursement-approval.util.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import type { RequestDisbursementDto } from './dto/request-disbursement.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Advisory-lock namespace reserved for THIS lane (p12cd) for welfare
 * disbursement authorisation, keyed per disbursement id — see
 * LANE_RULES.md §5 for every other namespace already in use (42, 51, 52,
 * 53, 56, and this module's own 65 for camp-slot capacity). Never used for
 * anything else.
 */
const WELFARE_DISBURSEMENT_LOCK_NAMESPACE = 66;

export type WelfareDisbursementDetail = WelfareDisbursementModel & {
  authorisedCount: number;
  requiredApprovers: number;
};

export interface WelfareDisbursementPage {
  items: WelfareDisbursementDetail[];
  nextCursor: string | null;
}

export interface ListWelfareDisbursementsParams {
  status?: string;
  cursor?: string;
  limit?: string;
}

/**
 * M10 — money OUT of the WELFARE pocket, dual/ladder-authorised exactly like
 * a PocketTransfer (see pocket-transfers.service.ts's doc comment for the
 * concurrency argument this mirrors almost exactly). One deliberate
 * divergence from PocketTransfer, per this lane's brief: `request()` auto-
 * records the requester's OWN authorisation ("the requester's request counts
 * as their signature") — so unlike a pocket transfer, a lone requester is
 * already 1 of however many are required, never 0. A second divergence: a
 * REPEAT identity on `authorise()` is REJECTED (409), not silently
 * absorbed by an upsert — the brief is explicit that a re-authorising
 * officer must be turned away rather than have their second click ignored.
 */
@Injectable()
export class WelfareDisbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  async request(societyId: string, requesterId: string, dto: RequestDisbursementDto): Promise<WelfareDisbursementDetail> {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    if (dto.campaignId) {
      const campaign = await this.prisma.donationCampaign.findUnique({ where: { id: dto.campaignId } });
      if (!campaign || campaign.societyId !== societyId) {
        throw new NotFoundException('Donation campaign not found');
      }
      if (campaign.mode !== DonationMode.INTERNAL_WELFARE) {
        throw new BadRequestException('A welfare disbursement can only be tied to an INTERNAL_WELFARE campaign');
      }
    }

    const disbursement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.welfareDisbursement.create({
        data: {
          societyId,
          campaignId: dto.campaignId,
          payeeName: dto.payeeName,
          purpose: dto.purpose,
          amount: new Decimal(dto.amount),
          status: WelfareDisbursementStatus.PENDING,
          requestedById: requesterId,
        },
      });

      // "The requester's request counts as their signature" (this lane's
      // brief) — deliberately different from PocketTransfer's `request`,
      // which never auto-records an authorisation.
      await tx.welfareDisbursementAuthorisation.create({ data: { disbursementId: created.id, authoriserId: requesterId } });

      return created;
    });

    return this.toDetail(this.prisma, disbursement);
  }

  /**
   * Mirrors PocketTransfersService.authoriseTransfer's shape (advisory lock
   * first, re-check status under the lock, execute the instant the
   * distinct-officer threshold is crossed) with the two divergences
   * documented on this class.
   */
  async authorise(societyId: string, disbursementId: string, officerId: string): Promise<WelfareDisbursementDetail> {
    let executedAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WELFARE_DISBURSEMENT_LOCK_NAMESPACE}, hashtext(${disbursementId}))`;

      const disbursement = await tx.welfareDisbursement.findUnique({ where: { id: disbursementId } });
      if (!disbursement || disbursement.societyId !== societyId) {
        throw new NotFoundException('Welfare disbursement not found');
      }

      if (disbursement.status === WelfareDisbursementStatus.EXECUTED) {
        return this.toDetail(tx, disbursement);
      }
      if (disbursement.status === WelfareDisbursementStatus.CANCELLED) {
        throw new BadRequestException('This disbursement has been cancelled');
      }

      try {
        await tx.welfareDisbursementAuthorisation.create({ data: { disbursementId: disbursement.id, authoriserId: officerId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('You have already authorised this disbursement');
        }
        throw error;
      }

      const distinctApprovers = await tx.welfareDisbursementAuthorisation.count({ where: { disbursementId: disbursement.id } });
      const [society, rosterSize] = await Promise.all([
        tx.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } }),
        this.committeeRosterSize(tx, societyId),
      ]);
      const approvalConfig = parseApprovalConfig(society.config);
      const required = requiredDisbursementApprovers(Number(disbursement.amount), approvalConfig, rosterSize);

      let updated = disbursement;
      if (distinctApprovers >= required) {
        const welfareAccount = await this.ledger.getOrCreateAccount(societyId, AccountKind.WELFARE, tx);
        if (new Decimal(welfareAccount.balance).lessThan(disbursement.amount)) {
          throw new BadRequestException('Insufficient WELFARE balance for this disbursement');
        }

        await this.ledger.post(
          {
            societyId,
            debitKind: AccountKind.WELFARE,
            creditKind: AccountKind.EXTERNAL,
            amount: disbursement.amount,
            reasonCode: 'WELFARE_DISBURSEMENT_EXECUTE',
            linkedEntityType: 'WelfareDisbursement',
            linkedEntityId: disbursement.id,
          },
          tx,
        );

        updated = await tx.welfareDisbursement.update({
          where: { id: disbursement.id },
          data: { status: WelfareDisbursementStatus.EXECUTED, executedAt: this.clock.now() },
        });

        executedAudit = {
          societyId,
          actorId: officerId,
          action: 'WELFARE_DISBURSEMENT_EXECUTED',
          subjectType: 'WelfareDisbursement',
          subjectId: disbursement.id,
          payload: { payeeName: disbursement.payeeName, amount: disbursement.amount.toString(), distinctApprovers, required },
        };
      }

      return this.toDetail(tx, updated, distinctApprovers, required);
    });

    if (executedAudit) {
      await this.auditService.appendBestEffort(executedAudit);
    }

    return detail;
  }

  async cancel(societyId: string, disbursementId: string): Promise<WelfareDisbursementDetail> {
    return this.prisma.$transaction(async (tx) => {
      const disbursement = await tx.welfareDisbursement.findUnique({ where: { id: disbursementId } });
      if (!disbursement || disbursement.societyId !== societyId) {
        throw new NotFoundException('Welfare disbursement not found');
      }
      if (disbursement.status === WelfareDisbursementStatus.CANCELLED) {
        return this.toDetail(tx, disbursement);
      }
      if (disbursement.status !== WelfareDisbursementStatus.PENDING) {
        throw new BadRequestException(`Only a PENDING disbursement can be cancelled (status=${disbursement.status})`);
      }

      const cancelled = await tx.welfareDisbursement.update({ where: { id: disbursement.id }, data: { status: WelfareDisbursementStatus.CANCELLED } });
      return this.toDetail(tx, cancelled);
    });
  }

  async list(societyId: string, params: ListWelfareDisbursementsParams): Promise<WelfareDisbursementPage> {
    const limit = parsePageLimit(params.limit);
    const status = this.parseStatus(params.status);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const cursorFilter: Prisma.WelfareDisbursementWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.sortValue!) } },
            { createdAt: new Date(cursor.sortValue!), id: { lt: cursor.id } },
          ],
        }
      : undefined;

    const rows = await this.prisma.welfareDisbursement.findMany({
      where: { societyId, ...(status ? { status } : {}), ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { items: pageRows, nextCursor } = buildPage(rows, limit, (row) => ({ sortValue: row.createdAt.toISOString(), id: row.id }));
    const items = await Promise.all(pageRows.map((row) => this.toDetail(this.prisma, row)));

    return { items, nextCursor };
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /** Mirrors PocketTransfersService.committeeRosterSize exactly — a deliberate, documented duplication (that method is private and not exported). */
  private async committeeRosterSize(client: Prisma.TransactionClient | PrismaService, societyId: string): Promise<number> {
    const officers = await client.role.findMany({
      where: { societyId, kind: { in: [RoleKind.COMMITTEE, RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return officers.length;
  }

  private parseStatus(raw: string | undefined): WelfareDisbursementStatus | null {
    if (raw === undefined) return null;
    if (!Object.values(WelfareDisbursementStatus).includes(raw as WelfareDisbursementStatus)) {
      throw new BadRequestException(`status must be one of ${Object.values(WelfareDisbursementStatus).join(', ')}`);
    }
    return raw as WelfareDisbursementStatus;
  }

  private async toDetail(
    client: Prisma.TransactionClient | PrismaService,
    disbursement: WelfareDisbursementModel,
    knownAuthorisedCount?: number,
    knownRequired?: number,
  ): Promise<WelfareDisbursementDetail> {
    if (knownAuthorisedCount !== undefined && knownRequired !== undefined) {
      return { ...disbursement, authorisedCount: knownAuthorisedCount, requiredApprovers: knownRequired };
    }

    const [authorisedCount, society, rosterSize] = await Promise.all([
      client.welfareDisbursementAuthorisation.count({ where: { disbursementId: disbursement.id } }),
      client.society.findUniqueOrThrow({ where: { id: disbursement.societyId }, select: { config: true } }),
      this.committeeRosterSize(client, disbursement.societyId),
    ]);
    const approvalConfig = parseApprovalConfig(society.config);
    const requiredApproversCount = requiredDisbursementApprovers(Number(disbursement.amount), approvalConfig, rosterSize);

    return { ...disbursement, authorisedCount, requiredApprovers: requiredApproversCount };
  }
}
