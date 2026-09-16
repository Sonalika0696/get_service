import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DelegationController } from './delegation.controller.js';
import { DelegationService } from './delegation.service.js';

@Module({
  imports: [AuditModule],
  controllers: [DelegationController],
  providers: [DelegationService],
})
export class DelegationModule {}
