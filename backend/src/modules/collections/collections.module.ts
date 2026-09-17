import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';

/** Phase 11/12 (lane b1read) — strictly read-only; PrismaService/Clock are global providers, nothing else to import. */
@Module({
  controllers: [CollectionsController],
  providers: [CollectionsService],
})
export class CollectionsModule {}
