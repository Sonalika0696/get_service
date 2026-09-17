import { Controller, Get, HttpStatus, Headers, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { computeEtag, etagMatches } from '../../common/pagination/etag.util.js';
import { BillsService, type BillsPage } from './bills.service.js';

/**
 * Phase 9.3: `GET /me/bills` — a resident-facing unified bills list. See
 * BillsService's doc comment for the UNION this derives from. Mirrors
 * UsersController's `@Controller('me')` shape (class-level guards +
 * `@ResidentOnly()`, honored via PrincipalGuard — unlike `@Roles`).
 *
 * ETag: computed over the exact page body (`{ items, nextCursor }`) and set
 * on every response; a matching `If-None-Match` short-circuits to a bodyless
 * 304 before the JSON is (re-)serialized.
 */
@Controller('me')
@UseGuards(AuthGuard, PrincipalGuard)
@ResidentOnly()
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get('bills')
  async listBills(
    @CurrentResident() currentUser: ResidentPrincipal,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('kind') kind: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BillsPage | undefined> {
    const page = await this.billsService.list(currentUser, { cursor, limit, kind });
    const etag = computeEtag(page);
    res.set('ETag', etag);

    if (etagMatches(etag, ifNoneMatch)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return page;
  }
}
