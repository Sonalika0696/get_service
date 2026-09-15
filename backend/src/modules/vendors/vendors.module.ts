import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './vendors.service.js';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
