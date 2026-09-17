import { Module } from '@nestjs/common';
import { TariffScheduleController } from './tariff-schedule.controller.js';
import { TariffScheduleService } from './tariff-schedule.service.js';

@Module({
  controllers: [TariffScheduleController],
  providers: [TariffScheduleService],
  exports: [TariffScheduleService],
})
export class TariffModule {}
