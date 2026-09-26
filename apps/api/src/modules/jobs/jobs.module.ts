import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionFreezesModule } from '../subscription-freezes/subscription-freezes.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    NotificationsModule,
    SubscriptionFreezesModule,
  ],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
