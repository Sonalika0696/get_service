import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { VirtualAccountStatus } from '../../generated/prisma/enums.js';
import type { VirtualAccountModel } from '../../generated/prisma/models.js';
import { buildVirtualAccountCode, randomCodeSalt } from './virtual-account-code.util.js';

const MAX_CODE_COLLISION_RETRIES = 5;

export interface VirtualAccountDetail {
  id: string;
  societyId: string;
  flatId: string;
  code: string;
  status: VirtualAccountStatus;
  createdAt: Date;
}

export interface VirtualAccountBackfillResult {
  created: number;
  alreadyProvisioned: number;
  total: number;
}

function toDetail(va: VirtualAccountModel): VirtualAccountDetail {
  return { id: va.id, societyId: va.societyId, flatId: va.flatId, code: va.code, status: va.status, createdAt: va.createdAt };
}

function isUniqueConstraintOn(error: unknown, field: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && Array.isArray((error.meta as { target?: unknown })?.target) && ((error.meta as { target: unknown[] }).target as string[]).includes(field);
}

/**
 * Phase 9.1 — provisions and reads VirtualAccount rows (per-flat attribution
 * keys; see the model's doc comment in schema.prisma for the full "not an
 * auth concept" decision). Kept as its OWN module rather than folded into
 * operator/flats.service.ts: FlatsService.importCsv calls into this service
 * (composition, not inheritance) so the provisioning/code-allocation logic
 * has exactly one home and is independently unit-testable, but the read
 * route this phase adds is COMMITTEE-scoped (not operator-only), which
 * doesn't belong in the operator module's `@OperatorOnly()`-only surface.
 */
@Injectable()
export class VirtualAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Idempotent per flat: if a VirtualAccount already exists for `flat.id`,
   * returns it unchanged (no code regeneration, no second row). Otherwise
   * allocates a deterministic code (see virtual-account-code.util.ts) and
   * creates the row, retrying with a random salt on the rare `code` unique-
   * constraint collision, and tolerating a concurrent-create race on
   * `flatId` by returning the row the other caller just won.
   *
   * Pass `tx` to enlist this in a caller's own transaction (e.g.
   * FlatsService.importCsv's per-row upsert transaction) — same
   * unit-of-work contract as LedgerService.post/getOrCreateAccount.
   */
  async provisionForFlat(flat: { id: string; societyId: string; unitNo: string }, tx?: Prisma.TransactionClient): Promise<VirtualAccountModel> {
    const client = tx ?? this.prisma;

    const existing = await client.virtualAccount.findUnique({ where: { flatId: flat.id } });
    if (existing) return existing;

    let salt: string | undefined;
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt++) {
      const code = buildVirtualAccountCode(flat.societyId, flat.unitNo, salt);
      try {
        return await client.virtualAccount.create({ data: { societyId: flat.societyId, flatId: flat.id, code } });
      } catch (error) {
        if (isUniqueConstraintOn(error, 'flatId')) {
          // Concurrent provisioning of the same flat — the other caller won; use their row.
          const race = await client.virtualAccount.findUnique({ where: { flatId: flat.id } });
          if (race) return race;
        }
        if (isUniqueConstraintOn(error, 'code')) {
          salt = randomCodeSalt();
          continue;
        }
        throw error;
      }
    }
    throw new Error(`VirtualAccount provisioning for flat ${flat.id} failed after ${MAX_CODE_COLLISION_RETRIES} code-collision retries`);
  }

  /**
   * Operator backfill — POST /operator/societies/:sid/virtual-accounts/backfill.
   * Idempotent: only flats with no VirtualAccount yet are touched; calling
   * this twice in a row the second time creates zero rows. Audited via
   * appendBestEffort, same pattern as FlatsService.importCsv.
   */
  async backfillSociety(societyId: string, actorId: string): Promise<VirtualAccountBackfillResult> {
    const society = await this.prisma.society.findUnique({ where: { id: societyId } });
    if (!society) throw new NotFoundException('Society not found');

    const flats = await this.prisma.flat.findMany({ where: { societyId }, include: { virtualAccount: true } });
    const missing = flats.filter((f) => !f.virtualAccount);

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: VirtualAccountModel[] = [];
      for (const flat of missing) {
        rows.push(await this.provisionForFlat(flat, tx));
      }
      return rows;
    });

    const result: VirtualAccountBackfillResult = {
      created: created.length,
      alreadyProvisioned: flats.length - missing.length,
      total: flats.length,
    };

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'VIRTUAL_ACCOUNT_BACKFILL',
      subjectType: 'Society',
      subjectId: societyId,
      payload: result,
    });

    return result;
  }

  /**
   * Committee-scoped read — GET /flats/:id/virtual-account. `callerSocietyId`
   * is the committee member's own society (from their ResidentPrincipal);
   * a flat outside it 404s rather than 403s, matching how other
   * committee-scoped lookups in this codebase (e.g.
   * ServiceRequestsService.get) avoid confirming a foreign flat's existence.
   */
  async getForFlat(callerSocietyId: string, flatId: string): Promise<VirtualAccountDetail> {
    const flat = await this.prisma.flat.findUnique({ where: { id: flatId }, include: { virtualAccount: true } });
    if (!flat || flat.societyId !== callerSocietyId) {
      throw new NotFoundException('Flat not found');
    }
    if (!flat.virtualAccount) {
      throw new NotFoundException('This flat has no VirtualAccount provisioned yet');
    }
    return toDetail(flat.virtualAccount);
  }

  /** Operator read — GET /operator/societies/:sid/virtual-accounts/:flatId. Society mismatch is a 403 (operator already knows the flat exists; unlike the committee route, an operator legitimately enumerates other societies). */
  async getForFlatAsOperator(societyId: string, flatId: string): Promise<VirtualAccountDetail> {
    const flat = await this.prisma.flat.findUnique({ where: { id: flatId }, include: { virtualAccount: true } });
    if (!flat) throw new NotFoundException('Flat not found');
    if (flat.societyId !== societyId) throw new ForbiddenException('Flat does not belong to this society');
    if (!flat.virtualAccount) throw new NotFoundException('This flat has no VirtualAccount provisioned yet');
    return toDetail(flat.virtualAccount);
  }
}
