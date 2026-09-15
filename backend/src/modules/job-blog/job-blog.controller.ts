import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { CreateJobPostDto } from './dto/create-job-post.dto.js';
import { JobBlogService, type PublicJobBlogPost } from './job-blog.service.js';

@Controller('jobs')
export class JobBlogController {
  constructor(private readonly jobBlogService: JobBlogService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentUser() currentUser: CurrentUserContext): Promise<PublicJobBlogPost[]> {
    return this.jobBlogService.listVisible(currentUser.societyId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.get(currentUser.societyId, id);
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: CreateJobPostDto): Promise<PublicJobBlogPost> {
    return this.jobBlogService.create(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/flag')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('JOB_BLOG_FLAG', 'JobBlogPost')
  async flag(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.flag(currentUser.societyId, id);
  }

  @Post(':id/remove')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('JOB_BLOG_REMOVE', 'JobBlogPost')
  async remove(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.remove(currentUser.societyId, id);
  }

  /** Public — the token itself is the credential, no session required. Clicked from an email. */
  @Get(':id/verify-company-email')
  async verifyCompanyEmail(@Param('id') id: string, @Query('token') token: string): Promise<{ verified: true }> {
    await this.jobBlogService.verifyCompanyEmail(id, token);
    return { verified: true };
  }
}
