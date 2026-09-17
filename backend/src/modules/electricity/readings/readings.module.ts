import { Module } from '@nestjs/common';
import { MetersModule } from '../meters/meters.module.js';
import { ReadingsController } from './readings.controller.js';
import { ReadingsService } from './readings.service.js';

@Module({
  imports: [MetersModule],
  controllers: [ReadingsController],
  providers: [ReadingsService],
  exports: [ReadingsService],
})
export class ReadingsModule {}
