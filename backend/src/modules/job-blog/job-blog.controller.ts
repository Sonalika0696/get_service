import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { CreateJobPostDto } from './dto/create-job-post.dto.js';
import { JobBlogService, type PublicJobBlogPost } from './job-blog.service.js';

@Controller('jobs')
export class JobBlogController {
  constructor(private readonly jobBlogService: JobBlogService) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@CurrentResident() currentUser: ResidentPrincipal): Promise<PublicJobBlogPost[]> {
    return this.jobBlogService.listVisible(currentUser.societyId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.get(currentUser.societyId, id);
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateJobPostDto): Promise<PublicJobBlogPost> {
    return this.jobBlogService.create(currentUser.societyId, currentUser.id, dto);
  }

  @Post(':id/flag')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('JOB_BLOG_FLAG', 'JobBlogPost')
  async flag(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.flag(currentUser.societyId, id);
  }

  @Post(':id/remove')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(RoleKind.COMMITTEE)
  @AuditLog('JOB_BLOG_REMOVE', 'JobBlogPost')
  async remove(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PublicJobBlogPost> {
    return this.jobBlogService.remove(currentUser.societyId, id);
  }

  /** Public — the token itself is the credential, no session required. Clicked from an email. */
  @Get(':id/verify-company-email')
  async verifyCompanyEmail(@Param('id') id: string, @Query('token') token: string): Promise<{ verified: true }> {
    await this.jobBlogService.verifyCompanyEmail(id, token);
    return { verified: true };
  }
}
