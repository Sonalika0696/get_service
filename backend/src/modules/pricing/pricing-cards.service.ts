import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PricingBasis, PricingCardStatus } from '../../generated/prisma/enums.js';
import type { PricingCardModel, PricingLineModel } from '../../generated/prisma/models.js';
import type { CurrentUserContext, VendorPrincipal } from '../../common/types/current-user.js';
import type { CreatePricingCardDto } from './dto/create-pricing-card.dto.js';
import type { RevisePricingCardDto } from './dto/revise-pricing-card.dto.js';
import type { CreatePricingLineDto } from './dto/create-pricing-line.dto.js';
import type { UpdatePricingLineDto } from './dto/update-pricing-line.dto.js';

/** API-facing shape: a pricing card plus its lines. */
export type PricingCardDetail = PricingCardModel & { lines: PricingLineModel[] };

/**
 * Phase 7.2 (BACKEND_PLAN.md Phase 7 items 2-5): vendor-published, versioned
 * pricing cards. See PricingCard/PricingLine's schema doc comments for the
 * lifecycle and the "scoped to vendor identity, not society" design call.
 *
 * Money-safety note: this service NEVER touches the ledger or any Account —
 * a card is a price sheet an engagement freezes onto itself later (Phase
 * 8). Nothing here posts, moves or reserves money.
 */
@Injectable()
export class PricingCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates the first (version 1) DRAFT for a (vendor, category). Rejected
   * if ANY card — draft or published — already exists for that category:
   * a live category is revised (`revise`), and an existing unpublished
   * draft should be continued via its own add-line/publish routes rather
   * than creating a second, orphaned draft. Keeps "one card in flight per
   * category" an invariant enforced here rather than left to callers.
   */
  async createDraft(vendorId: string, dto: CreatePricingCardDto): Promise<PricingCardDetail> {
    const existing = await this.prisma.pricingCard.findFirst({ where: { vendorId, category: dto.category } });
    if (existing) {
      throw new BadRequestException(
        `A pricing card already exists for category "${dto.category}" (version ${existing.version}, ${existing.status}). Continue editing that draft, or revise the published card.`,
      );
    }

    const card = await this.prisma.pricingCard.create({
      data: {
        vendorId,
        category: dto.category,
        version: 1,
        gstRatePct: dto.gstRatePct,
        effectiveFrom: new Date(dto.effectiveFrom),
        status: PricingCardStatus.DRAFT,
      },
      include: { lines: true },
    });
    return card;
  }

  /** All of a vendor's own cards (every status/version), optionally filtered to one category. Draft management surface — not the public reader. */
  async listMine(vendorId: string, category?: string): Promise<PricingCardDetail[]> {
    return this.prisma.pricingCard.findMany({
      where: { vendorId, ...(category ? { category } : {}) },
      include: { lines: true },
      orderBy: [{ category: 'asc' }, { version: 'asc' }],
    });
  }

  /** Fetch one of the vendor's own cards by id, any status. 404s (not 403) if it exists but belongs to someone else — never confirms another vendor's card id. */
  async getOwnCard(vendorId: string, cardId: string): Promise<PricingCardDetail> {
    return this.getOwnedCardInternal(vendorId, cardId);
  }

  /**
   * Draft-only. Rejects with 400 on a published card — see
   * PricingCard's schema doc comment: immutability is enforced HERE, not
   * at the DB layer, on every mutation entry point (this, updateLine,
   * deleteLine, publish's own guard).
   */
  async addLine(vendorId: string, cardId: string, dto: CreatePricingLineDto): Promise<PricingCardDetail> {
    const card = await this.getOwnedCardInternal(vendorId, cardId);
    this.assertMutable(card);

    await this.prisma.pricingLine.create({
      data: {
        cardId: card.id,
        label: dto.label,
        basis: dto.basis,
        rate: dto.rate,
        minimum: dto.minimum ?? null,
        conditions: dto.conditions ?? null,
      },
    });
    return this.getOwnedCardInternal(vendorId, cardId);
  }

  async updateLine(vendorId: string, cardId: string, lineId: string, dto: UpdatePricingLineDto): Promise<PricingCardDetail> {
    const card = await this.getOwnedCardInternal(vendorId, cardId);
    this.assertMutable(card);

    const line = card.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException('Pricing line not found on this card');
    }

    await this.prisma.pricingLine.update({
      where: { id: lineId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.basis !== undefined ? { basis: dto.basis } : {}),
        ...(dto.rate !== undefined ? { rate: dto.rate } : {}),
        ...(dto.minimum !== undefined ? { minimum: dto.minimum } : {}),
        ...(dto.conditions !== undefined ? { conditions: dto.conditions } : {}),
      },
    });
    return this.getOwnedCardInternal(vendorId, cardId);
  }

  async deleteLine(vendorId: string, cardId: string, lineId: string): Promise<PricingCardDetail> {
    const card = await this.getOwnedCardInternal(vendorId, cardId);
    this.assertMutable(card);

    const line = card.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException('Pricing line not found on this card');
    }

    await this.prisma.pricingLine.delete({ where: { id: lineId } });
    return this.getOwnedCardInternal(vendorId, cardId);
  }

  /**
   * Publishes a DRAFT card. Requires at least one PER_VISIT line — the
   * visit/callout charge is a first-class line (BACKEND_PLAN.md Phase 7
   * item 2), never an implicit extra bolted on later, so a card can't go
   * live without one.
   *
   * Supersession happens HERE, not at revise()-time: the previous current
   * published card for this (vendor, category) — if any — has its
   * `supersededAt` stamped in the SAME transaction that publishes this
   * one, so an abandoned revision draft never orphans the live card, and
   * there is never a moment with two "current" published cards.
   *
   * Writes a best-effort PRICING_CARD_PUBLISHED audit entry scoped to a
   * society this vendor is linked to — see resolveAuditSocietyId's doc
   * comment for which one and why.
   */
  async publish(vendor: VendorPrincipal, cardId: string): Promise<PricingCardDetail> {
    const card = await this.getOwnedCardInternal(vendor.vendorId, cardId);
    if (card.status !== PricingCardStatus.DRAFT) {
      throw new BadRequestException('Only a DRAFT card can be published');
    }
    if (!card.lines.some((l) => l.basis === PricingBasis.PER_VISIT)) {
      throw new BadRequestException('A pricing card must include at least one PER_VISIT line (the visit/callout charge) before it can be published');
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const previousCurrent = await tx.pricingCard.findFirst({
        where: { vendorId: card.vendorId, category: card.category, status: PricingCardStatus.PUBLISHED, supersededAt: null, version: { lt: card.version } },
      });
      if (previousCurrent) {
        await tx.pricingCard.update({ where: { id: previousCurrent.id }, data: { supersededAt: now } });
      }
      await tx.pricingCard.update({ where: { id: card.id }, data: { status: PricingCardStatus.PUBLISHED, publishedAt: now } });
    });

    const societyId = await this.resolveAuditSocietyId(card.vendorId);
    if (societyId) {
      await this.auditService.appendBestEffort({
        societyId,
        actorId: vendor.id,
        action: 'PRICING_CARD_PUBLISHED',
        subjectType: 'PricingCard',
        subjectId: card.id,
        payload: { vendorId: card.vendorId, category: card.category, version: card.version },
      });
    }

    return this.getOwnedCardInternal(vendor.vendorId, cardId);
  }

  /**
   * Revises the CURRENT published card for a category into a new DRAFT
   * (version + 1). `:id` must name that exact current card (status
   * PUBLISHED, supersededAt null) — naming it explicitly, rather than
   * keying revise off just (vendor, category), means a caller working off
   * a stale read gets a clear 400 instead of silently revising whatever
   * happens to be current by the time the request lands.
   *
   * The new draft starts as a copy of the previous card's lines (a
   * revision is far more often "adjust one rate" than "start from
   * scratch") — freely editable via addLine/updateLine/deleteLine until
   * published, and entirely independent of the original card's rows from
   * that point on (no shared line ids).
   */
  async revise(vendorId: string, cardId: string, dto: RevisePricingCardDto): Promise<PricingCardDetail> {
    const card = await this.getOwnedCardInternal(vendorId, cardId);
    if (card.status !== PricingCardStatus.PUBLISHED || card.supersededAt !== null) {
      throw new BadRequestException('Can only revise the current published card for a category (status PUBLISHED, not already superseded)');
    }

    const pendingDraft = await this.prisma.pricingCard.findFirst({
      where: { vendorId, category: card.category, status: PricingCardStatus.DRAFT },
    });
    if (pendingDraft) {
      throw new BadRequestException(`A draft revision (version ${pendingDraft.version}) is already pending for category "${card.category}"`);
    }

    const created = await this.prisma.pricingCard.create({
      data: {
        vendorId,
        category: card.category,
        version: card.version + 1,
        gstRatePct: dto.gstRatePct,
        effectiveFrom: new Date(dto.effectiveFrom),
        status: PricingCardStatus.DRAFT,
        lines: {
          create: card.lines.map((l) => ({ label: l.label, basis: l.basis, rate: l.rate, minimum: l.minimum, conditions: l.conditions })),
        },
      },
      include: { lines: true },
    });
    return created;
  }

  /** Public reader: the current (non-superseded, PUBLISHED) card for a category. Authz per assertReaderAccess. */
  async getCurrentPublished(currentUser: CurrentUserContext, vendorId: string, category: string): Promise<PricingCardDetail> {
    await this.assertReaderAccess(currentUser, vendorId);
    const card = await this.prisma.pricingCard.findFirst({
      where: { vendorId, category, status: PricingCardStatus.PUBLISHED, supersededAt: null },
      include: { lines: true },
    });
    if (!card) {
      throw new NotFoundException('No published pricing card for this vendor/category');
    }
    return card;
  }

  /** Public reader: a specific historical (or current) version by number. Never returns a DRAFT — only ever-published rows are "history". */
  async getVersion(currentUser: CurrentUserContext, vendorId: string, category: string, version: number): Promise<PricingCardDetail> {
    await this.assertReaderAccess(currentUser, vendorId);
    const card = await this.prisma.pricingCard.findFirst({
      where: { vendorId, category, version, status: PricingCardStatus.PUBLISHED },
      include: { lines: true },
    });
    if (!card) {
      throw new NotFoundException('No published pricing card at that version for this vendor/category');
    }
    return card;
  }

  /**
   * Reader authz for the public (non-vendor-owned-draft) endpoints
   * (BACKEND_PLAN.md Phase 7 item 5): either the vendor viewing its OWN
   * pricing (self-service parity with the `/mine` surface), or a RESIDENT
   * of a society the vendor is actually linked to (VendorSocietyLink) —
   * the same "must be linked" rule VendorsService.getResidentContact and
   * getInternal already apply. An OPERATOR has no business here in this
   * phase (no operator-facing pricing console yet) and a resident of an
   * unrelated society is refused rather than silently 404'd, since the
   * vendor id itself isn't a secret (it's visible in that society's own
   * vendor directory).
   */
  private async assertReaderAccess(currentUser: CurrentUserContext, vendorId: string): Promise<void> {
    if (currentUser.principalKind === 'VENDOR') {
      if (currentUser.vendorId !== vendorId) {
        throw new ForbiddenException('A vendor may only read its own pricing cards');
      }
      return;
    }
    if (currentUser.principalKind === 'RESIDENT') {
      const link = await this.prisma.vendorSocietyLink.findUnique({ where: { vendorId_societyId: { vendorId, societyId: currentUser.societyId } } });
      if (!link) {
        throw new ForbiddenException('This vendor is not linked to your society');
      }
      return;
    }
    throw new ForbiddenException('Not authorized to read pricing cards');
  }

  /**
   * Which society a card-publish (or verify.chain scoped elsewhere) audit
   * entry is written against: the vendor's OLDEST VendorSocietyLink
   * (earliest createdAt, id as a tie-break for full determinism when two
   * links land in the same millisecond — as in tests). Pricing is scoped
   * to the vendor's global identity, not any one society (see PricingCard's
   * schema doc comment), so there is no single "correct" society to
   * attribute the write to; the audit chain itself is per-society
   * (AuditService's doc comment), so SOME society must be picked. "Oldest
   * link" is the vendor's original home society — a stable, deterministic
   * choice that doesn't change as the vendor is linked to more societies
   * later. Returns null (caller skips the audit write) for the edge case
   * of a vendor with zero society links.
   */
  private async resolveAuditSocietyId(vendorId: string): Promise<string | null> {
    const link = await this.prisma.vendorSocietyLink.findFirst({
      where: { vendorId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return link?.societyId ?? null;
  }

  private async getOwnedCardInternal(vendorId: string, cardId: string): Promise<PricingCardDetail> {
    const card = await this.prisma.pricingCard.findUnique({ where: { id: cardId }, include: { lines: true } });
    if (!card || card.vendorId !== vendorId) {
      throw new NotFoundException('Pricing card not found');
    }
    return card;
  }

  private assertMutable(card: PricingCardDetail): void {
    if (card.status !== PricingCardStatus.DRAFT) {
      throw new BadRequestException('Cannot modify a published pricing card — publishing makes a card and its lines immutable; revise it to create a new version');
    }
  }
}
