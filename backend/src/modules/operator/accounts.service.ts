import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrincipalKind } from '../../generated/prisma/enums.js';
import type { UserModel } from '../../generated/prisma/models.js';
import type { ProvisionAccountDto } from './dto/provision-account.dto.js';

/**
 * The admin surface Phase 6.2 explicitly deferred to 6.3 (see
 * OfficerAuthService's class doc comment): provisions the bare VENDOR/
 * OPERATOR User row (email + principalKind set, no credentials) that
 * OfficerAuthService's enroll/login flow then turns into a real
 * password+mandatory-TOTP login. This service never touches
 * passwordHash/totpSecret/totpEnabledAt — that stays entirely
 * OfficerAuthService's job, unchanged.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async provision(operatorId: string, dto: ProvisionAccountDto): Promise<UserModel> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    if (dto.principalKind === PrincipalKind.VENDOR) {
      return this.provisionVendor(operatorId, dto);
    }

    // OPERATOR: platform-level, no society to scope an AuditLog entry to
    // (AuditLog.societyId is NOT NULL — the chain is per-society by design,
    // see AuditService's class doc comment). A platform-level audit surface
    // is Phase 6.5/12 territory, not invented here — this write is simply
    // not chained, which is a real (flagged) gap, not an oversight.
    if (dto.vendorId) {
      throw new BadRequestException('vendorId must not be set when principalKind is OPERATOR');
    }
    return this.prisma.user.create({
      data: { name: dto.name, email: dto.email, principalKind: PrincipalKind.OPERATOR },
    });
  }

  private async provisionVendor(operatorId: string, dto: ProvisionAccountDto): Promise<UserModel> {
    if (!dto.vendorId) {
      throw new BadRequestException('vendorId is required when principalKind is VENDOR');
    }

    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const alreadyLinked = await this.prisma.user.findUnique({ where: { vendorId: dto.vendorId } });
    if (alreadyLinked) {
      throw new ConflictException('This vendor already has a linked login');
    }

    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, principalKind: PrincipalKind.VENDOR, vendorId: dto.vendorId },
    });

    await this.auditService.appendBestEffort({
      societyId: vendor.societyId,
      actorId: operatorId,
      action: 'VENDOR_ACCOUNT_PROVISION',
      subjectType: 'User',
      subjectId: user.id,
      payload: { email: dto.email, vendorId: dto.vendorId },
    });

    return user;
  }
}
