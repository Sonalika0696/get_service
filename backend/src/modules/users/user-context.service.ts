import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';

/**
 * Resolves the full auth/authorization context for a user id: their society
 * (via their active occupancy — one user, one society in v1), occupancy
 * role, and society-level role kinds (committee/treasurer/...). Used by
 * AuthGuard on every authenticated request and by GET /me.
 */
@Injectable()
export class UserContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<CurrentUserContext | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId, tenureEndedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { flat: true },
    });
    if (!occupancy) return null;

    const roles = await this.prisma.role.findMany({ where: { userId, societyId: occupancy.flat.societyId } });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      societyId: occupancy.flat.societyId,
      occupancyRole: occupancy.role,
      roleKinds: roles.map((r) => r.kind),
    };
  }
}
