import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  MemberSubscriptionsController,
  SubscriptionsController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SubscriptionsController, MemberSubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
