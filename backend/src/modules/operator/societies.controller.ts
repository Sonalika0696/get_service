import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { SocietyStatus } from '../../generated/prisma/enums.js';
import type { SocietyModel } from '../../generated/prisma/models.js';
import { CreateSocietyDto } from './dto/create-society.dto.js';
import { UpdateSocietyDto } from './dto/update-society.dto.js';
import { SocietiesService } from './societies.service.js';

/**
 * Platform-operator society CRUD (BACKEND_PLAN.md Phase 6.3 item 1;
 * DECISIONS_V2_SCOPE.md §1.4). OPERATOR-only at the class level — a
 * resident/vendor session is 403'd by PrincipalGuard before it reaches any
 * handler here, never a per-route concern. No `@AuditLog(...)` anywhere —
 * SocietiesService writes its own (best-effort, awaited) entries; see its
 * class doc comment.
 */
@Controller('operator/societies')
@UseGuards(AuthGuard, PrincipalGuard)
@OperatorOnly()
export class SocietiesController {
  constructor(private readonly societiesService: SocietiesService) {}

  @Post()
  async create(@CurrentUser() operator: CurrentUserContext, @Body() dto: CreateSocietyDto): Promise<SocietyModel> {
    return this.societiesService.create(operator.id, dto);
  }

  @Get()
  async list(@Query('status') status?: SocietyStatus): Promise<SocietyModel[]> {
    return this.societiesService.list(status);
  }

  @Get(':sid')
  async get(@Param('sid') sid: string): Promise<SocietyModel> {
    return this.societiesService.get(sid);
  }

  @Patch(':sid')
  async update(@CurrentUser() operator: CurrentUserContext, @Param('sid') sid: string, @Body() dto: UpdateSocietyDto): Promise<SocietyModel> {
    return this.societiesService.update(sid, operator.id, dto);
  }

  @Post(':sid/archive')
  async archive(@CurrentUser() operator: CurrentUserContext, @Param('sid') sid: string): Promise<SocietyModel> {
    return this.societiesService.archive(sid, operator.id);
  }

  @Post(':sid/reactivate')
  async reactivate(@CurrentUser() operator: CurrentUserContext, @Param('sid') sid: string): Promise<SocietyModel> {
    return this.societiesService.reactivate(sid, operator.id);
  }
}
