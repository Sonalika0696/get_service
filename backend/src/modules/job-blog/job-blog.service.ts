import { randomBytes, createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AppConfigService } from '../../config/config.service.js';
import { JobBlogKind, JobBlogStatus } from '../../generated/prisma/enums.js';
import type { JobBlogPostModel } from '../../generated/prisma/models.js';
import type { CreateJobPostDto } from './dto/create-job-post.dto.js';

const ARCHIVE_AFTER_DAYS = 60;
const COMPANY_EMAIL_TOKEN_TTL_HOURS = 24;
const DEFAULT_RATE_LIMIT_PER_MONTH = 1;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** API-facing shape — strips the verification-token hash/expiry, which must never leave the server. */
export type PublicJobBlogPost = Omit<JobBlogPostModel, 'companyEmailTokenHash' | 'companyEmailTokenExpiresAt'>;

function toPublic(post: JobBlogPostModel): PublicJobBlogPost {
  const { companyEmailTokenHash: _companyEmailTokenHash, companyEmailTokenExpiresAt: _companyEmailTokenExpiresAt, ...rest } = post;
  return rest;
}

@Injectable()
export class JobBlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
  ) {}

  async create(societyId: string, posterId: string, dto: CreateJobPostDto): Promise<PublicJobBlogPost> {
    await this.assertUnderRateLimit(societyId, posterId);

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    let companyEmailTokenHash: string | null = null;
    let companyEmailTokenExpiresAt: Date | null = null;
    let rawToken: string | null = null;

    if (dto.kind === JobBlogKind.HIRING) {
      rawToken = randomBytes(24).toString('base64url');
      companyEmailTokenHash = hashToken(rawToken);
      companyEmailTokenExpiresAt = new Date(now.getTime() + COMPANY_EMAIL_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    }

    const post = await this.prisma.jobBlogPost.create({
      data: {
        societyId,
        posterId,
        kind: dto.kind,
        title: dto.title,
        body: dto.body,
        expiresAt,
        companyEmail: dto.kind === JobBlogKind.HIRING ? dto.companyEmail : null,
        companyEmailTokenHash,
        companyEmailTokenExpiresAt,
      },
    });

    if (dto.kind === JobBlogKind.HIRING && dto.companyEmail && rawToken) {
      const verifyUrl = `${this.config.env.API_BASE_URL}/api/v1/jobs/${post.id}/verify-company-email?token=${rawToken}`;
      await this.notifications.sendCompanyEmailVerification(dto.companyEmail, verifyUrl);
    }

    return toPublic(post);
  }

  /** Publicly visible posts only: ACTIVE, not expired, and (SEEKING or company-email verified). */
  async listVisible(societyId: string): Promise<PublicJobBlogPost[]> {
    const now = this.clock.now();
    const posts = await this.prisma.jobBlogPost.findMany({
      where: {
        societyId,
        status: JobBlogStatus.ACTIVE,
        expiresAt: { gt: now },
        OR: [{ kind: JobBlogKind.SEEKING }, { companyEmailVerifiedAt: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return posts.map(toPublic);
  }

  async get(societyId: string, id: string): Promise<PublicJobBlogPost> {
    return toPublic(await this.getInternal(societyId, id));
  }

  async flag(societyId: string, id: string): Promise<PublicJobBlogPost> {
    await this.getInternal(societyId, id);
    const post = await this.prisma.jobBlogPost.update({ where: { id }, data: { status: JobBlogStatus.FLAGGED } });
    return toPublic(post);
  }

  async remove(societyId: string, id: string): Promise<PublicJobBlogPost> {
    await this.getInternal(societyId, id);
    const post = await this.prisma.jobBlogPost.update({ where: { id }, data: { status: JobBlogStatus.REMOVED } });
    return toPublic(post);
  }

  private async getInternal(societyId: string, id: string): Promise<JobBlogPostModel> {
    const post = await this.prisma.jobBlogPost.findUnique({ where: { id } });
    if (!post || post.societyId !== societyId) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  async verifyCompanyEmail(id: string, rawToken: string): Promise<JobBlogPostModel> {
    const post = await this.prisma.jobBlogPost.findUnique({ where: { id } });
    if (!post || post.kind !== JobBlogKind.HIRING) {
      throw new NotFoundException('Post not found');
    }
    if (post.companyEmailVerifiedAt) {
      return post; // already verified — idempotent on repeat clicks
    }
    if (!post.companyEmailTokenHash || !post.companyEmailTokenExpiresAt) {
      throw new BadRequestException('No pending verification for this post');
    }
    if (post.companyEmailTokenExpiresAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('Verification link expired');
    }
    if (post.companyEmailTokenHash !== hashToken(rawToken)) {
      throw new ForbiddenException('Invalid verification token');
    }

    return this.prisma.jobBlogPost.update({
      where: { id },
      data: { companyEmailVerifiedAt: this.clock.now() },
    });
  }

  private async assertUnderRateLimit(societyId: string, posterId: string): Promise<void> {
    const society = await this.prisma.society.findUniqueOrThrow({ where: { id: societyId }, select: { config: true } });
    const config = society.config as Record<string, unknown>;
    const limit = typeof config.jobBlogRateLimitPerMonth === 'number' ? config.jobBlogRateLimitPerMonth : DEFAULT_RATE_LIMIT_PER_MONTH;

    const oneMonthAgo = this.clock.now();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const countThisMonth = await this.prisma.jobBlogPost.count({
      where: { posterId, societyId, createdAt: { gte: oneMonthAgo } },
    });

    if (countThisMonth >= limit) {
      throw new HttpException(`Rate limit: ${limit} post(s) per resident per month`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
