import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

interface MeResponse {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kycTier: string;
  societyId: string;
  occupancyRole: string;
  roleKinds: string[];
}

@Controller('me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() currentUser: CurrentUserContext): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      societyId: currentUser.societyId,
      occupancyRole: currentUser.occupancyRole,
      roleKinds: currentUser.roleKinds,
    };
  }

  @Patch()
  async updateProfile(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: UpdateProfileDto): Promise<MeResponse> {
    const user = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: { name: dto.name, phone: dto.phone },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      societyId: currentUser.societyId,
      occupancyRole: currentUser.occupancyRole,
      roleKinds: currentUser.roleKinds,
    };
  }
}
