import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { AuditService } from './audit.service.js';

export interface VerifyChainResponse {
  ok: boolean;
  verifiedThrough: number;
  /** Hex-encoded tail hash — the recomputed chain tail (see AuditService.verifyChain). */
  tailHash: string;
  firstDivergence: { id: string; sequence: number } | null;
}

/**
 * Surfaces AuditService.verifyChain() (BACKEND_PLAN.md Phase 6.5) to every
 * resident: the hash-chained audit log is one of the dissertation's four
 * novelty claims (DESIGN.md §1a.4), and re-verifying it end to end is cheap
 * enough to expose on demand rather than keep as an internal-only check.
 *
 * Scoped to the caller's own society — a resident can only verify the chain
 * they're themselves a member of, same scoping rule as every other
 * resident-facing route (see VendorsController for the pattern).
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('verify')
  @UseGuards(AuthGuard)
  async verify(@CurrentResident() currentUser: ResidentPrincipal): Promise<VerifyChainResponse> {
    const result = await this.auditService.verifyChain(currentUser.societyId);
    return {
      ok: result.ok,
      verifiedThrough: result.verifiedThrough,
      tailHash: result.tailHash.toString('hex'),
      firstDivergence: result.firstDivergence,
    };
  }
}
