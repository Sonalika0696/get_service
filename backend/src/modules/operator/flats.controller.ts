import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { ImportFlatsDto } from './dto/import-flats.dto.js';
import { FlatsService, type FlatImportResult } from './flats.service.js';

@Controller('operator/societies/:sid/flats')
@UseGuards(AuthGuard, PrincipalGuard)
@OperatorOnly()
export class FlatsController {
  constructor(private readonly flatsService: FlatsService) {}

  /** No `@AuditLog(...)` here — FlatsService.importCsv writes a compact summary itself; see its doc comment. */
  @Post('import')
  async import(@CurrentUser() operator: CurrentUserContext, @Param('sid') sid: string, @Body() dto: ImportFlatsDto): Promise<FlatImportResult> {
    return this.flatsService.importCsv(sid, operator.id, dto);
  }
}
