import { Module } from '@nestjs/common';
import { HomeController } from './home.controller.js';
import { HomeService } from './home.service.js';

/**
 * Phase 9.4 — read-only mobile home-tab aggregate. PrismaService/Clock are
 * both global (see PrismaModule/ClockModule), so nothing else needs
 * importing here — see HomeService's doc comment for why it reads Prisma
 * directly instead of importing sibling modules.
 */
@Module({
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
