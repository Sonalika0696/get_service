import { Module } from '@nestjs/common';
import { MetersController } from './meters.controller.js';
import { MetersService } from './meters.service.js';

@Module({
  controllers: [MetersController],
  providers: [MetersService],
  exports: [MetersService],
})
export class MetersModule {}
