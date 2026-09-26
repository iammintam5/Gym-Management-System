import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionFreezesController } from './subscription-freezes.controller';
import { SubscriptionFreezesService } from './subscription-freezes.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SubscriptionFreezesController],
  providers: [SubscriptionFreezesService],
  exports: [SubscriptionFreezesService],
})
export class SubscriptionFreezesModule {}
