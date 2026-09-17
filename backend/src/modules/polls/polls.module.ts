import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { PollsController } from './polls.controller.js';
import { PollsService } from './polls.service.js';

@Module({
  imports: [NotificationsModule, RealtimeModule],
  controllers: [PollsController],
  providers: [PollsService],
})
export class PollsModule {}
