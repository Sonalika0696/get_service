import { Global, Module } from '@nestjs/common';
import { BbpsService } from './bbps.service.js';

@Global()
@Module({
  providers: [BbpsService],
  exports: [BbpsService],
})
export class BbpsModule {}
