import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';

/**
 * Minimal platform-operator surface for Phase 6.2 — proves the OPERATOR
 * principal, `@OperatorOnly()`, and the SocietyScopeGuard bypass actually
 * work end to end. The real operator console (society creation, flat-CSV
 * import, vendor/officer account provisioning, ...) is Phase 6.3+; these
 * two routes are deliberately tiny, no-op "is this wired up" checks rather
 * than product surface.
 */
@Controller('operator')
export class OperatorController {
  /** Only an OPERATOR principal may reach this — any other principalKind (or no session) gets 403/401. */
  @Get('ping')
  @UseGuards(AuthGuard, PrincipalGuard)
  @OperatorOnly()
  ping(@CurrentUser() user: CurrentUserContext): { ok: true; operatorId: string } {
    return { ok: true, operatorId: user.id };
  }

  /**
   * No `@OperatorOnly()` here on purpose: this route exists to prove
   * SocietyScopeGuard's operator bypass in isolation from PrincipalGuard.
   * A RESIDENT/VENDOR whose own societyId doesn't match `:sid` gets 403 from
   * SocietyScopeGuard; an OPERATOR always passes regardless of `:sid`,
   * including a `:sid` that doesn't even exist as a Society row — the
   * bypass is unconditional, matching "operator is platform-level, has no
   * societyId to compare" (see SocietyScopeGuard's doc comment).
   */
  @Get('societies/:sid/ping')
  @UseGuards(AuthGuard, SocietyScopeGuard)
  @SocietyScope()
  scopedPing(@Param('sid') sid: string): { ok: true; sid: string } {
    return { ok: true, sid };
  }
}
