import { Controller, Get, Headers, HttpStatus, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SocietyScopeGuard } from '../../common/guards/society-scope.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { SocietyScope } from '../../common/decorators/society-scope.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { CollectionsService } from './collections.service.js';
import type { ArrearsPage, CollectionsStatusResponse } from './collections.types.js';

/**
 * `GET /collections/arrears` and `GET /collections/status` — see
 * CollectionsService's doc comment. No `:sid` route param (society is
 * always the caller's own) — `@SocietyScope()` is kept per the brief for
 * consistency with the committee-surface convention, but is a documented
 * no-op here exactly like PocketTransfersController's identical note,
 * since `SocietyScopeGuard` only checks routes that actually carry `:sid`.
 *
 * `@Roles(...)`/`@SocietyScope()` are repeated per-handler, not hoisted to
 * the class — both guards read handler-level metadata only
 * (`Reflector.get(key, context.getHandler())`), unlike `PrincipalGuard`'s
 * `getAllAndOverride([handler, class])` for `@ResidentOnly()` — see
 * PocketTransfersController's identical note. `@ResidentOnly()` is safe to
 * keep at class level for that reason.
 */
@Controller('collections')
@UseGuards(AuthGuard, PrincipalGuard, RolesGuard, SocietyScopeGuard)
@ResidentOnly()
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('arrears')
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async arrears(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('bucket') bucket: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ArrearsPage | undefined> {
    const page = await this.collections.arrears(currentUser.societyId, { bucket, cursor, limit });
    const etag = computeEtag(page);
    res.set('ETag', etag);
    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return page;
  }

  @Get('status')
  @SocietyScope()
  @Roles(RoleKind.TREASURER, RoleKind.DEPUTY_TREASURER, RoleKind.COMMITTEE)
  async status(@CurrentResident() currentUser: ResidentPrincipal, @Query('period') period: string | undefined): Promise<CollectionsStatusResponse> {
    return this.collections.status(currentUser.societyId, period);
  }
}
