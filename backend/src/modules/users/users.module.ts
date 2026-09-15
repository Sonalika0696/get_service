import { Module } from '@nestjs/common';
import { UserContextService } from './user-context.service.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [UsersController],
  providers: [UserContextService],
  exports: [UserContextService],
})
export class UsersModule {}
