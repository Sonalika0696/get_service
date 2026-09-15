import { Global, Module } from '@nestjs/common';
import { GstinApiService } from './gstinapi.service.js';

@Global()
@Module({
  providers: [GstinApiService],
  exports: [GstinApiService],
})
export class GstinApiModule {}
