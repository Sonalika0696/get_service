import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { DonationCampaignStatus, DonationContributionStatus, DonationMode, RatificationStatus, RoleKind } from '../../generated/prisma/enums.js';
import type { DonationCampaignModel, DonationContributionModel } from '../../generated/prisma/models.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import { maskContributor, type MaskedContributor } from './donation-masking.util.js';
import type { CreateDonationCampaignDto } from './dto/create-donation-campaign.dto.js';
import type { ContributeDto } from './dto/contribute.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

const OFFICER_ROLES: ReadonlySet<RoleKind> = new Set([RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE]);

export interface DonationCampaignPage {
  items: DonationCampaignModel[];
  nextCursor: string | null;
}

export interface DonationCampaignDetail extends DonationCampaignModel {
  totalReceived: string;
  contributorCount: number;
  contributors: MaskedContributor[];
}

export interface ListDonationCampaignsParams {
  cursor?: string;
  limit?: string;
}

/**
 * M10 — donation campaigns. Two modes with different legal characters (see
 * schema.prisma's doc comment above DonationMode): INTERNAL_WELFARE collects
 * into the society's own WELFARE pocket; EXTERNAL_PASS_THROUGH is paid by
 * the resident DIRECTLY to the recipient organisation — this service never
 * creates a Payment or a LedgerEntry for it, only a participation record.
 */
@Injectable()
export class DonationCampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly payments: PaymentsService,
  ) {}

  // -------------------------------------------------------------------
  // Committee
  // -------------------------------------------------------------------

  async create(societyId: string, createdById: string, dto: CreateDonationCampaignDto): Promise<DonationCampaignModel> {
    const opensAt = new Date(dto.opensAt);
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;
    if (closesAt && closesAt.getTime() <= opensAt.getTime()) {
      throw new BadRequestException('closesAt must be after opensAt');
    }

    if (dto.mode === DonationMode.INTERNAL_WELFARE) {
      if (dto.recipientOrgName !== undefined || dto.recipientOrgUrl !== undefined || dto.recipientIssues80G !== undefined) {
        throw new BadRequestException('An INTERNAL_WELFARE campaign cannot carry any recipientOrg* field');
      }
    } else {
      if (!dto.recipientOrgName) {
        throw new BadRequestException('recipientOrgName is required for an EXTERNAL_PASS_THROUGH campaign');
      }
    }

    return this.prisma.donationCampaign.create({
      data: {
        societyId,
        createdById,
        mode: dto.mode,
        title: dto.title,
        purpose: dto.purpose,
        targetAmount: dto.targetAmount !== undefined ? new Decimal(dto.targetAmount) : undefined,
        recipientOrgName: dto.recipientOrgName,
        recipientOrgUrl: dto.recipientOrgUrl,
        recipientIssues80G: dto.recipientIssues80G ?? false,
        opensAt,
        closesAt,
        status: DonationCampaignStatus.OPEN,
      },
    });
  }

  async close(societyId: string, campaignId: string): Promise<DonationCampaignModel> {
    const campaign = await this.getOwned(societyId, campaignId);
    if (campaign.status === DonationCampaignStatus.CLOSED) {
      return campaign;
    }
    return this.prisma.donationCampaign.update({ where: { id: campaignId }, data: { status: DonationCampaignStatus.CLOSED } });
  }

  // -------------------------------------------------------------------
  // Resident
  // -------------------------------------------------------------------

  async list(societyId: string, params: ListDonationCampaignsParams): Promise<DonationCampaignPage> {
    const limit = parsePageLimit(params.limit);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const cursorFilter: Prisma.DonationCampaignWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.sortValue!) } },
            { createdAt: new Date(cursor.sortValue!), id: { lt: cursor.id } },
          ],
        }
      : undefined;

    const rows = await this.prisma.donationCampaign.findMany({
      where: { societyId, ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { items, nextCursor } = buildPage(rows, limit, (row) => ({ sortValue: row.createdAt.toISOString(), id: row.id }));
    return { items, nextCursor };
  }

  async getDetail(societyId: string, viewerId: string, campaignId: string): Promise<DonationCampaignDetail> {
    const campaign = await this.getOwned(societyId, campaignId);
    const viewerIsOfficer = await this.isOfficer(societyId, viewerId);

    // "Received" contributions: INTERNAL captured into WELFARE (RECEIVED), or
    // EXTERNAL participation recorded (RECORDED) — PENDING/CANCELLED never count.
    const countedStatuses = [DonationContributionStatus.RECEIVED, DonationContributionStatus.RECORDED];
    const contributions = await this.prisma.donationContribution.findMany({
      where: { campaignId, status: { in: countedStatuses } },
      include: { flat: { select: { unitNo: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalReceived = contributions.reduce((sum, c) => sum.plus(c.amount), new Decimal(0));
    const contributors = contributions.map((c) =>
      maskContributor(
        { id: c.id, amount: c.amount.toString(), anonymous: c.anonymous, createdAt: c.createdAt, flatUnitNo: c.flat.unitNo, residentId: c.residentId },
        viewerIsOfficer,
      ),
    );

    return {
      ...campaign,
      totalReceived: totalReceived.toString(),
      contributorCount: contributions.length,
      contributors,
    };
  }

  async contribute(societyId: string, residentId: string, campaignId: string, dto: ContributeDto): Promise<DonationContributionModel> {
    const flatId = await this.activeFlatId(societyId, residentId);
    const campaign = await this.getOwned(societyId, campaignId);

    if (campaign.status !== DonationCampaignStatus.OPEN) {
      throw new BadRequestException(`Campaign is not open (status=${campaign.status})`);
    }
    const now = this.clock.now();
    if (now.getTime() < campaign.opensAt.getTime()) {
      throw new BadRequestException('Campaign has not opened yet');
    }
    if (campaign.closesAt && now.getTime() > campaign.closesAt.getTime()) {
      throw new BadRequestException('Campaign has closed');
    }

    if (campaign.mode === DonationMode.INTERNAL_WELFARE) {
      if (dto.externalReference !== undefined) {
        throw new BadRequestException('externalReference is not accepted for an INTERNAL_WELFARE campaign');
      }

      return this.prisma.$transaction(async (tx) => {
        const contribution = await tx.donationContribution.create({
          data: {
            campaignId,
            flatId,
            residentId,
            amount: new Decimal(dto.amount),
            anonymous: dto.anonymous ?? false,
            status: DonationContributionStatus.PENDING,
          },
        });

        const payment = await this.payments.createOrderForLink(
          {
            societyId,
            residentId,
            amount: dto.amount,
            purpose: `Donation: ${campaign.title}`,
            linkedEntityType: 'DonationContribution',
            linkedEntityId: contribution.id,
            idempotencyKey: `donation-contribution:${contribution.id}`,
          },
          tx,
        );

        return tx.donationContribution.update({ where: { id: contribution.id }, data: { paymentId: payment.id } });
      });
    }

    // EXTERNAL_PASS_THROUGH: the resident already paid the organisation
    // directly. No order, no ledger — participation only.
    if (!dto.externalReference) {
      throw new BadRequestException('externalReference is required for an EXTERNAL_PASS_THROUGH campaign');
    }

    return this.prisma.donationContribution.create({
      data: {
        campaignId,
        flatId,
        residentId,
        amount: new Decimal(dto.amount),
        anonymous: dto.anonymous ?? false,
        status: DonationContributionStatus.RECORDED,
        externalReference: dto.externalReference,
      },
    });
  }

  // -------------------------------------------------------------------
  // Internal helpers — shared with WelfareDisbursementsService
  // -------------------------------------------------------------------

  async getOwned(societyId: string, campaignId: string): Promise<DonationCampaignModel> {
    const campaign = await this.prisma.donationCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.societyId !== societyId) {
      throw new NotFoundException('Donation campaign not found');
    }
    return campaign;
  }

  private async isOfficer(societyId: string, userId: string): Promise<boolean> {
    const role = await this.prisma.role.findFirst({ where: { societyId, userId, kind: { in: [...OFFICER_ROLES] } } });
    return role !== null;
  }

  /** The caller's own flat, resolved server-side from their active RATIFIED occupancy — never client-supplied. */
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
