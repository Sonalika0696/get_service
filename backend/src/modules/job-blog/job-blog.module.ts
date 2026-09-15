import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { JobBlogController } from './job-blog.controller.js';
import { JobBlogService } from './job-blog.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [JobBlogController],
  providers: [JobBlogService],
})
export class JobBlogModule {}
