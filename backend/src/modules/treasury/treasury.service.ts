import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { AuditService, type AppendAuditLogInput } from '../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountKind, FixedDepositAction, FixedDepositStatus } from '../../generated/prisma/enums.js';
import type { FixedDepositAuthorisationModel, FixedDepositModel } from '../../generated/prisma/models.js';
import { buildPage, decodeCursor, parsePageLimit, type KeysetCursor } from '../../common/pagination/cursor.util.js';
import {
  DEFAULT_TREASURY_CONFIG,
  mergeTreasuryConfig,
  parseTreasuryConfig,
  validateTreasuryConfig,
  type TreasuryConfig,
} from './treasury-config.util.js';
import { addDays, availableToSweep, chooseSweepTenor, maturityAmount, monthKey, prematureWithdrawalRatePct, round2, simpleInterest } from './treasury-math.util.js';
import { assertInterestPosting } from './interest-posting-guard.util.js';
import type { ProposeDepositDto } from './dto/propose-deposit.dto.js';
import type { SetTreasuryConfigDto } from './dto/set-treasury-config.dto.js';
import type { RenewDepositDto } from './dto/renew-deposit.dto.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/**
 * Advisory-lock namespace reserved for this module (Phase 12, M12 — see
 * LANE_RULES.md §5: existing namespaces are 42 audit / 51 idempotency / 52
 * payout / 53 resident-poll-fire / 56 pocket-transfer / others; 64 is this
 * lane's own reservation, unused anywhere else in the codebase). Taken as
 * the FIRST statement inside authorisePlacement / authoriseWithdrawal /
 * mature's transaction, keyed on the deposit's own id.
 */
const TREASURY_LOCK_NAMESPACE = 64;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FixedDepositDetail extends FixedDepositModel {
  authorisations: FixedDepositAuthorisationModel[];
  placeAuthorisedCount: number;
  withdrawAuthorisedCount: number;
}

export interface FixedDepositPage {
  items: FixedDepositDetail[];
  nextCursor: string | null;
}

export interface ListDepositsParams {
  status?: string;
  cursor?: string;
  limit?: string;
}

export interface SweepProposeResult {
  proposed: FixedDepositDetail | null;
  reason?: string;
}

export interface LadderBucket {
  /** `YYYY-MM`. */
  month: string;
  count: number;
  principal: string;
  maturityAmount: string;
}

export interface TreasuryConfigReadoutDto extends TreasuryConfig {
  isDefault: boolean;
}

/**
 * Phase 12 (M12) — corpus treasury: fixed deposits, sweep rule, maturity
 * ladder. See schema.prisma's "M12 - Corpus treasury" doc comment for the
 * model shapes and this lane's brief for the full behavioural spec.
 *
 * Regulatory stance (non-negotiable, invariant I4): the corpus is the
 * society's own asset. Interest accrues ONLY to AccountKind.INTEREST_INCOME
 * — never to any flat-linked entry — enforced by the single
 * assertInterestPosting-gated `postInterest` helper below, the only place
 * in this module allowed to credit interest.
 *
 * Placement, renewal and premature withdrawal are all dual-authorised by
 * TWO DISTINCT officer identities (never the amount-based approval ladder
 * bulk-buy/pocket-transfers use — a corpus movement is dual-authorised
 * exactly like PocketTransfersService's floor-of-2, just fixed at 2, not
 * ladder-derived). Maturity itself needs no second signature: it only
 * returns money already committed on a schedule the society itself set at
 * placement time.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Sweep configuration
  // -------------------------------------------------------------------

  async getConfig(societyId: string): Promise<TreasuryConfigReadoutDto> {
    const { config, isDefault } = await this.readConfig(societyId);
    return { ...config, isDefault };
  }

  /**
   * Merges `{ treasury: candidate }` onto Society.config WITHOUT clobbering
   * any other key already stored there (approval ladder, service-request
   * thresholds, ...) — see mergeTreasuryConfig / BulkBuyService.setApprovalConfig's
   * identical stance.
   */
  async setConfig(societyId: string, actorId: string, dto: SetTreasuryConfigDto): Promise<TreasuryConfigReadoutDto> {
    const candidate: TreasuryConfig = {
      operatingFloatFloor: dto.operatingFloatFloor,
      minTenorDays: dto.minTenorDays,
      defaultTenorDays: dto.defaultTenorDays,
      defaultRatePct: dto.defaultRatePct,
      defaultBankName: dto.defaultBankName,
    };
    const validationError = validateTreasuryConfig(candidate);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId } });
    const merged = mergeTreasuryConfig(society.config, candidate);
    await this.prisma.society.update({ where: { id: societyId }, data: { config: merged as unknown as Prisma.InputJsonValue } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'TREASURY_CONFIG_SET',
      subjectType: 'Society',
      subjectId: societyId,
      payload: candidate,
    });

    return { ...candidate, isDefault: false };
  }

  // -------------------------------------------------------------------
  // Propose (manual / sweep)
  // -------------------------------------------------------------------

  async proposeDeposit(societyId: string, initiatorId: string, dto: ProposeDepositDto): Promise<FixedDepositDetail> {
    const { config } = await this.readConfig(societyId);
    if (dto.tenorDays < config.minTenorDays) {
      throw new BadRequestException(`tenorDays must be >= this society's minTenorDays (${config.minTenorDays})`);
    }

    return this.prisma.$transaction(async (tx) => {
      const corpus = await this.ledger.getOrCreateAccount(societyId, AccountKind.CORPUS, tx);
      const proposedSum = await this.sumProposedPrincipal(tx, societyId);
      const available = availableToSweep(Number(corpus.balance), config.operatingFloatFloor, proposedSum);

      if (dto.principal > available) {
        throw new BadRequestException(
          `principal exceeds what is available to place (CORPUS=${corpus.balance}, floor=${config.operatingFloatFloor}, alreadyProposed=${round2(proposedSum)}, available=${round2(available)})`,
        );
      }

      const deposit = await tx.fixedDeposit.create({
        data: {
          societyId,
          bankName: dto.bankName,
          principal: new Decimal(dto.principal),
          ratePct: new Decimal(dto.ratePct),
          tenorDays: dto.tenorDays,
          status: FixedDepositStatus.PROPOSED,
          initiatedById: initiatorId,
        },
      });
      await tx.fixedDepositAuthorisation.create({
        data: { depositId: deposit.id, action: FixedDepositAction.PLACE, authoriserId: initiatorId },
      });

      return this.toDetail(tx, deposit);
    });
  }

  /**
   * Sweep-rule proposal (brief step 2): computes
   * `available = CORPUS - operatingFloatFloor - Σ(PROPOSED principal)` and,
   * if positive, proposes a deposit for the FULL available amount using the
   * society's own configured rate/bank and a tenor chosen by the maturity
   * ladder (chooseSweepTenor). Never partially sweeps and never rounds up
   * past what's actually available.
   */
  async sweepPropose(societyId: string, initiatorId: string): Promise<SweepProposeResult> {
    const { config } = await this.readConfig(societyId);

    return this.prisma.$transaction(async (tx) => {
      const corpus = await this.ledger.getOrCreateAccount(societyId, AccountKind.CORPUS, tx);
      const proposedSum = await this.sumProposedPrincipal(tx, societyId);
      const available = round2(availableToSweep(Number(corpus.balance), config.operatingFloatFloor, proposedSum));

      if (available <= 0) {
        return {
          proposed: null,
          reason: `Nothing available to sweep (CORPUS=${corpus.balance}, floor=${config.operatingFloatFloor}, alreadyProposed=${round2(proposedSum)})`,
        };
      }

      const activeDeposits = await tx.fixedDeposit.findMany({
        where: { societyId, status: FixedDepositStatus.ACTIVE, maturesAt: { not: null } },
        select: { maturesAt: true },
      });
      const activeMaturities = activeDeposits.map((d) => d.maturesAt!).filter((d): d is Date => d !== null);
      const tenorDays = chooseSweepTenor(this.clock.now(), activeMaturities, config.minTenorDays);

      const deposit = await tx.fixedDeposit.create({
        data: {
          societyId,
          bankName: config.defaultBankName,
          principal: new Decimal(available),
          ratePct: new Decimal(config.defaultRatePct),
          tenorDays,
          status: FixedDepositStatus.PROPOSED,
          initiatedById: initiatorId,
          proposedBySweep: true,
        },
      });
      await tx.fixedDepositAuthorisation.create({
        data: { depositId: deposit.id, action: FixedDepositAction.PLACE, authoriserId: initiatorId },
      });

      return { proposed: await this.toDetail(tx, deposit) };
    });
  }

  // -------------------------------------------------------------------
  // Authorise placement (dual officer -> ACTIVE)
  // -------------------------------------------------------------------

  async authorisePlacement(societyId: string, depositId: string, officerId: string): Promise<FixedDepositDetail> {
    let postCommitAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREASURY_LOCK_NAMESPACE}, hashtext(${depositId}))`;

      const deposit = await tx.fixedDeposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.societyId !== societyId) {
        throw new NotFoundException('Fixed deposit not found');
      }

      if (deposit.status === FixedDepositStatus.ACTIVE) {
        return this.toDetail(tx, deposit); // already executed — verified no-op
      }
      if (deposit.status !== FixedDepositStatus.PROPOSED) {
        throw new BadRequestException(`Only a PROPOSED deposit can be authorised for placement (status=${deposit.status})`);
      }

      // Regulatory stance: the initiator can NEVER be the second approver.
      if (officerId === deposit.initiatedById) {
        throw new ForbiddenException('The initiator of this deposit cannot also authorise its placement');
      }

      const existing = await tx.fixedDepositAuthorisation.findUnique({
        where: { depositId_action_authoriserId: { depositId, action: FixedDepositAction.PLACE, authoriserId: officerId } },
      });
      if (existing) {
        throw new ConflictException('You have already authorised this placement');
      }

      await tx.fixedDepositAuthorisation.create({
        data: { depositId, action: FixedDepositAction.PLACE, authoriserId: officerId },
      });
      const distinctApprovers = await tx.fixedDepositAuthorisation.count({ where: { depositId, action: FixedDepositAction.PLACE } });

      let updated: FixedDepositModel = deposit;
      if (distinctApprovers >= 2) {
        updated = await this.executePlacement(tx, deposit);
        postCommitAudit = {
          societyId,
          actorId: officerId,
          action: 'TREASURY_DEPOSIT_PLACED',
          subjectType: 'FixedDeposit',
          subjectId: deposit.id,
          payload: { principal: updated.principal.toString(), ratePct: updated.ratePct.toString(), tenorDays: updated.tenorDays, maturesAt: updated.maturesAt },
        };
      }

      return this.toDetail(tx, updated);
    });

    if (postCommitAudit) {
      await this.auditService.appendBestEffort(postCommitAudit);
    }
    return detail;
  }

  /**
   * Executes a PROPOSED deposit's placement: if it is a renewal
   * (`renewedFromId` set), the source deposit is first matured in this SAME
   * transaction (if still ACTIVE) so its principal returns to CORPUS, and
   * its already-booked/just-booked interest is reinvested INTEREST_INCOME
   * -> CORPUS (an ordinary internal transfer, not a fresh "interest
   * posting" under assertInterestPosting's guard — see that reinvestment
   * call's own comment) so the renewal's full principal (principal +
   * interest) can be funded without ever crediting a resident. Only THEN is
   * the usual CORPUS-covers-principal-plus-floor check applied and the
   * CORPUS -> FIXED_DEPOSIT posting made — so money never double-counts
   * between the maturing source and the newly-placed renewal.
   */
  private async executePlacement(tx: Prisma.TransactionClient, deposit: FixedDepositModel): Promise<FixedDepositModel> {
    if (deposit.renewedFromId) {
      const source = await tx.fixedDeposit.findUnique({ where: { id: deposit.renewedFromId } });
      if (source) {
        let matured = source;
        if (source.status === FixedDepositStatus.ACTIVE) {
          matured = await this.executeMaturity(tx, source);
        }
        const interestEarned = matured.interestEarned ? Number(matured.interestEarned) : 0;
        if (matured.status === FixedDepositStatus.MATURED && interestEarned > 0) {
          await this.ledger.post(
            {
              societyId: deposit.societyId,
              debitKind: AccountKind.INTEREST_INCOME,
              creditKind: AccountKind.CORPUS,
              amount: interestEarned,
              reasonCode: 'TREASURY_RENEWAL_REINVEST_INTEREST',
              linkedEntityType: 'FixedDeposit',
              linkedEntityId: deposit.id,
            },
            tx,
          );
        }
      }
    }

    const society = await tx.society.findUniqueOrThrow({ where: { id: deposit.societyId }, select: { config: true } });
    const { config } = parseTreasuryConfig(society.config);

    const corpusAccount = await this.ledger.getOrCreateAccount(deposit.societyId, AccountKind.CORPUS, tx);
    const requiredCorpus = new Decimal(deposit.principal).plus(config.operatingFloatFloor);
    if (new Decimal(corpusAccount.balance).lessThan(requiredCorpus)) {
      throw new BadRequestException("CORPUS balance no longer covers this deposit's principal plus the operating float floor");
    }

    await this.ledger.post(
      {
        societyId: deposit.societyId,
        debitKind: AccountKind.CORPUS,
        creditKind: AccountKind.FIXED_DEPOSIT,
        amount: deposit.principal,
        reasonCode: 'TREASURY_DEPOSIT_PLACE',
        linkedEntityType: 'FixedDeposit',
        linkedEntityId: deposit.id,
      },
      tx,
    );

    const placedAt = this.clock.now();
    const maturesAt = addDays(placedAt, deposit.tenorDays);
    const maturity = maturityAmount(Number(deposit.principal), Number(deposit.ratePct), deposit.tenorDays);

    return tx.fixedDeposit.update({
      where: { id: deposit.id },
      data: { status: FixedDepositStatus.ACTIVE, placedAt, maturesAt, maturityAmount: new Decimal(maturity) },
    });
  }

  // -------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------

  async cancel(societyId: string, depositId: string): Promise<FixedDepositDetail> {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.fixedDeposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.societyId !== societyId) {
        throw new NotFoundException('Fixed deposit not found');
      }
      if (deposit.status === FixedDepositStatus.CANCELLED) {
        return this.toDetail(tx, deposit);
      }
      if (deposit.status !== FixedDepositStatus.PROPOSED) {
        throw new BadRequestException(`Only a PROPOSED deposit can be cancelled (status=${deposit.status})`);
      }

      const cancelled = await tx.fixedDeposit.update({ where: { id: deposit.id }, data: { status: FixedDepositStatus.CANCELLED } });
      return this.toDetail(tx, cancelled);
    });
  }

  // -------------------------------------------------------------------
  // Maturity
  // -------------------------------------------------------------------

  async mature(societyId: string, depositId: string): Promise<FixedDepositDetail> {
    let postCommitAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREASURY_LOCK_NAMESPACE}, hashtext(${depositId}))`;

      const deposit = await tx.fixedDeposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.societyId !== societyId) {
        throw new NotFoundException('Fixed deposit not found');
      }
      if (deposit.status === FixedDepositStatus.MATURED) {
        return this.toDetail(tx, deposit); // idempotent no-op
      }
      if (deposit.status !== FixedDepositStatus.ACTIVE) {
        throw new BadRequestException(`Only an ACTIVE deposit can mature (status=${deposit.status})`);
      }
      if (!deposit.maturesAt || deposit.maturesAt.getTime() > this.clock.now().getTime()) {
        throw new BadRequestException('This deposit has not yet reached its maturity date');
      }

      const matured = await this.executeMaturity(tx, deposit);
      postCommitAudit = {
        societyId,
        actorId: null,
        action: 'TREASURY_DEPOSIT_MATURED',
        subjectType: 'FixedDeposit',
        subjectId: deposit.id,
        payload: { principal: matured.principal.toString(), interestEarned: matured.interestEarned?.toString() ?? '0' },
      };
      return this.toDetail(tx, matured);
    });

    if (postCommitAudit) {
      await this.auditService.appendBestEffort(postCommitAudit);
    }
    return detail;
  }

  /** Scheduler stand-in (brief step 5) — matures every ACTIVE deposit in this society whose maturesAt has passed. Each deposit matures under its own advisory-locked transaction (via `mature`), so one deposit's failure can't roll back another's. */
  async processMaturities(societyId: string): Promise<{ maturedIds: string[] }> {
    const due = await this.prisma.fixedDeposit.findMany({
      where: { societyId, status: FixedDepositStatus.ACTIVE, maturesAt: { lte: this.clock.now() } },
      select: { id: true },
    });

    const maturedIds: string[] = [];
    for (const { id } of due) {
      await this.mature(societyId, id);
      maturedIds.push(id);
    }
    return { maturedIds };
  }

  /**
   * The ONLY place in this module allowed to credit interest — every call
   * site (deposit maturity, premature withdrawal) routes through here,
   * which asserts I4 before ever touching the ledger (brief step 9).
   */
  private async postInterest(tx: Prisma.TransactionClient, societyId: string, amount: number, depositId: string, reasonCode: string): Promise<void> {
    assertInterestPosting(AccountKind.INTEREST_INCOME, 'FixedDeposit');
    if (amount <= 0) return; // a 0% or 0-day-held deposit earns nothing — no zero-amount ledger noise
    await this.ledger.post(
      {
        societyId,
        debitKind: AccountKind.EXTERNAL,
        creditKind: AccountKind.INTEREST_INCOME,
        amount,
        reasonCode,
        linkedEntityType: 'FixedDeposit',
        linkedEntityId: depositId,
      },
      tx,
    );
  }

  /** Shared by `mature` and renewal's "mature the source first" step: books the full-tenor simple interest and returns the principal to CORPUS, atomically. */
  private async executeMaturity(tx: Prisma.TransactionClient, deposit: FixedDepositModel): Promise<FixedDepositModel> {
    const principal = Number(deposit.principal);
    const ratePct = Number(deposit.ratePct);
    const interest = simpleInterest(principal, ratePct, deposit.tenorDays);

    await this.ledger.post(
      {
        societyId: deposit.societyId,
        debitKind: AccountKind.FIXED_DEPOSIT,
        creditKind: AccountKind.CORPUS,
        amount: principal,
        reasonCode: 'TREASURY_DEPOSIT_MATURE_PRINCIPAL',
        linkedEntityType: 'FixedDeposit',
        linkedEntityId: deposit.id,
      },
      tx,
    );
    await this.postInterest(tx, deposit.societyId, interest, deposit.id, 'TREASURY_DEPOSIT_MATURE_INTEREST');

    return tx.fixedDeposit.update({
      where: { id: deposit.id },
      data: { status: FixedDepositStatus.MATURED, closedAt: this.clock.now(), interestEarned: new Decimal(interest) },
    });
  }

  // -------------------------------------------------------------------
  // Premature withdrawal (dual officer -> WITHDRAWN)
  // -------------------------------------------------------------------

  async withdraw(societyId: string, depositId: string, officerId: string, reason: string): Promise<FixedDepositDetail> {
    let postCommitAudit: AppendAuditLogInput | null = null;

    const detail = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREASURY_LOCK_NAMESPACE}, hashtext(${depositId}))`;

      const deposit = await tx.fixedDeposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.societyId !== societyId) {
        throw new NotFoundException('Fixed deposit not found');
      }
      if (deposit.status === FixedDepositStatus.WITHDRAWN) {
        return this.toDetail(tx, deposit); // idempotent no-op
      }
      if (deposit.status !== FixedDepositStatus.ACTIVE) {
        throw new BadRequestException(`Only an ACTIVE deposit can be withdrawn (status=${deposit.status})`);
      }

      const existing = await tx.fixedDepositAuthorisation.findUnique({
        where: { depositId_action_authoriserId: { depositId, action: FixedDepositAction.WITHDRAW, authoriserId: officerId } },
      });
      if (existing) {
        throw new ConflictException('You have already authorised this withdrawal');
      }

      await tx.fixedDepositAuthorisation.create({
        data: { depositId, action: FixedDepositAction.WITHDRAW, authoriserId: officerId },
      });
      const distinctApprovers = await tx.fixedDepositAuthorisation.count({ where: { depositId, action: FixedDepositAction.WITHDRAW } });

      let updated: FixedDepositModel = deposit;
      if (distinctApprovers >= 2) {
        updated = await this.executeWithdrawal(tx, deposit, reason);
        postCommitAudit = {
          societyId,
          actorId: officerId,
          action: 'TREASURY_DEPOSIT_WITHDRAWN',
          subjectType: 'FixedDeposit',
          subjectId: deposit.id,
          payload: { principal: updated.principal.toString(), interestEarned: updated.interestEarned?.toString() ?? '0', reason },
        };
      }

      return this.toDetail(tx, updated);
    });

    if (postCommitAudit) {
      await this.auditService.appendBestEffort(postCommitAudit);
    }
    return detail;
  }

  private async executeWithdrawal(tx: Prisma.TransactionClient, deposit: FixedDepositModel, reason: string): Promise<FixedDepositModel> {
    const now = this.clock.now();
    const placedAt = deposit.placedAt ?? deposit.createdAt;
    const daysHeld = Math.max(0, Math.floor((now.getTime() - placedAt.getTime()) / MS_PER_DAY));
    const withdrawalRatePct = prematureWithdrawalRatePct(Number(deposit.ratePct));
    const interest = simpleInterest(Number(deposit.principal), withdrawalRatePct, daysHeld);

    await this.ledger.post(
      {
        societyId: deposit.societyId,
        debitKind: AccountKind.FIXED_DEPOSIT,
        creditKind: AccountKind.CORPUS,
        amount: deposit.principal,
        reasonCode: 'TREASURY_DEPOSIT_WITHDRAW_PRINCIPAL',
        linkedEntityType: 'FixedDeposit',
        linkedEntityId: deposit.id,
      },
      tx,
    );
    await this.postInterest(tx, deposit.societyId, interest, deposit.id, 'TREASURY_DEPOSIT_WITHDRAW_INTEREST');

    return tx.fixedDeposit.update({
      where: { id: deposit.id },
      data: { status: FixedDepositStatus.WITHDRAWN, closedAt: now, interestEarned: new Decimal(interest), closeReason: reason },
    });
  }

  // -------------------------------------------------------------------
  // Renewal
  // -------------------------------------------------------------------

  /**
   * Creates a NEW PROPOSED deposit rolling over `depositId` (brief step 7).
   * Allowed only for a source that is ACTIVE and already past its own
   * maturesAt (mature() just hasn't been called yet), or one already
   * MATURED. The new deposit's principal is the source's full matured value
   * (principal + full-tenor interest) — it must go through the SAME dual
   * PLACE authorisation as any other deposit; see executePlacement for how
   * the source is actually closed out and its value moved forward at that
   * point, never here.
   */
  async renew(societyId: string, initiatorId: string, depositId: string, dto: RenewDepositDto): Promise<FixedDepositDetail> {
    const { config } = await this.readConfig(societyId);

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.fixedDeposit.findUnique({ where: { id: depositId } });
      if (!source || source.societyId !== societyId) {
        throw new NotFoundException('Fixed deposit not found');
      }

      const now = this.clock.now();
      const pastMaturityActive = source.status === FixedDepositStatus.ACTIVE && source.maturesAt !== null && source.maturesAt.getTime() <= now.getTime();
      const alreadyMatured = source.status === FixedDepositStatus.MATURED;
      if (!pastMaturityActive && !alreadyMatured) {
        throw new BadRequestException('Only an ACTIVE deposit at or past its maturity date, or an already-MATURED deposit, can be renewed');
      }

      const existingRenewal = await tx.fixedDeposit.findFirst({
        where: { renewedFromId: depositId, status: { in: [FixedDepositStatus.PROPOSED, FixedDepositStatus.ACTIVE] } },
      });
      if (existingRenewal) {
        throw new BadRequestException('This deposit already has a pending or active renewal');
      }

      const principal = alreadyMatured
        ? round2(Number(source.principal) + Number(source.interestEarned ?? 0))
        : (source.maturityAmount ? Number(source.maturityAmount) : maturityAmount(Number(source.principal), Number(source.ratePct), source.tenorDays));

      const tenorDays = dto.tenorDays ?? config.defaultTenorDays;
      if (tenorDays < config.minTenorDays) {
        throw new BadRequestException(`tenorDays must be >= this society's minTenorDays (${config.minTenorDays})`);
      }
      const ratePct = dto.ratePct ?? config.defaultRatePct;

      const deposit = await tx.fixedDeposit.create({
        data: {
          societyId,
          bankName: source.bankName,
          principal: new Decimal(principal),
          ratePct: new Decimal(ratePct),
          tenorDays,
          status: FixedDepositStatus.PROPOSED,
          initiatedById: initiatorId,
          renewedFromId: source.id,
        },
      });
      await tx.fixedDepositAuthorisation.create({
        data: { depositId: deposit.id, action: FixedDepositAction.PLACE, authoriserId: initiatorId },
      });

      return this.toDetail(tx, deposit);
    });
  }

  // -------------------------------------------------------------------
  // Ladder / reads
  // -------------------------------------------------------------------

  /** 12 rolling calendar-month buckets starting this month, aggregated over every ACTIVE deposit's maturesAt (brief step 8's read side). */
  async ladder(societyId: string): Promise<{ buckets: LadderBucket[] }> {
    const now = this.clock.now();
    const deposits = await this.prisma.fixedDeposit.findMany({
      where: { societyId, status: FixedDepositStatus.ACTIVE, maturesAt: { not: null } },
      select: { maturesAt: true, principal: true, maturityAmount: true },
    });

    const buckets: LadderBucket[] = [];
    for (let i = 0; i < 12; i++) {
      const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const key = monthKey(bucketDate);
      const matches = deposits.filter((d) => d.maturesAt && monthKey(d.maturesAt) === key);
      const principalSum = matches.reduce((sum, d) => sum + Number(d.principal), 0);
      const maturitySum = matches.reduce((sum, d) => sum + Number(d.maturityAmount ?? 0), 0);
      buckets.push({
        month: `${bucketDate.getUTCFullYear()}-${String(bucketDate.getUTCMonth() + 1).padStart(2, '0')}`,
        count: matches.length,
        principal: round2(principalSum).toFixed(2),
        maturityAmount: round2(maturitySum).toFixed(2),
      });
    }
    return { buckets };
  }

  async list(societyId: string, params: ListDepositsParams): Promise<FixedDepositPage> {
    const limit = parsePageLimit(params.limit);
    const status = this.parseStatus(params.status);
    const cursor: KeysetCursor | null = params.cursor ? decodeCursor(params.cursor) : null;

    const cursorFilter: Prisma.FixedDepositWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.sortValue!) } },
            { createdAt: new Date(cursor.sortValue!), id: { lt: cursor.id } },
          ],
        }
      : undefined;

    const rows = await this.prisma.fixedDeposit.findMany({
      where: { societyId, ...(status ? { status } : {}), ...cursorFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const { items: pageRows, nextCursor } = buildPage(rows, limit, (row) => ({ sortValue: row.createdAt.toISOString(), id: row.id }));
    const items = await Promise.all(pageRows.map((row) => this.toDetail(this.prisma, row)));

    return { items, nextCursor };
  }

  async get(societyId: string, depositId: string): Promise<FixedDepositDetail> {
    const deposit = await this.prisma.fixedDeposit.findUnique({ where: { id: depositId } });
    if (!deposit || deposit.societyId !== societyId) {
      throw new NotFoundException('Fixed deposit not found');
    }
    return this.toDetail(this.prisma, deposit);
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async readConfig(societyId: string) {
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    return parseTreasuryConfig(society.config);
  }

  private async sumProposedPrincipal(client: Prisma.TransactionClient | PrismaService, societyId: string): Promise<number> {
    const agg = await client.fixedDeposit.aggregate({
      where: { societyId, status: FixedDepositStatus.PROPOSED },
      _sum: { principal: true },
    });
    return Number(agg._sum.principal ?? 0);
  }

  private parseStatus(raw: string | undefined): FixedDepositStatus | null {
    if (raw === undefined) return null;
    if (!Object.values(FixedDepositStatus).includes(raw as FixedDepositStatus)) {
      throw new BadRequestException(`status must be one of ${Object.values(FixedDepositStatus).join(', ')}`);
    }
    return raw as FixedDepositStatus;
  }

  private async toDetail(client: Prisma.TransactionClient | PrismaService, deposit: FixedDepositModel): Promise<FixedDepositDetail> {
    const authorisations = await client.fixedDepositAuthorisation.findMany({ where: { depositId: deposit.id }, orderBy: { createdAt: 'asc' } });
    return {
      ...deposit,
      authorisations,
      placeAuthorisedCount: authorisations.filter((a) => a.action === FixedDepositAction.PLACE).length,
      withdrawAuthorisedCount: authorisations.filter((a) => a.action === FixedDepositAction.WITHDRAW).length,
    };
  }
}

export { DEFAULT_TREASURY_CONFIG };
