import { Module } from '@nestjs/common';
import { WaterController } from './water.controller.js';
import { WaterService } from './water.service.js';

@Module({
  controllers: [WaterController],
  providers: [WaterService],
  exports: [WaterService],
})
export class WaterModule {}
