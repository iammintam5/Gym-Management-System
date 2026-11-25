import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PtPackagesModule } from '../pt-packages/pt-packages.module';
import { SubscriptionFreezesController } from './subscription-freezes.controller';
import { SubscriptionFreezesService } from './subscription-freezes.service';

@Module({
  imports: [DatabaseModule, PtPackagesModule],
  controllers: [SubscriptionFreezesController],
  providers: [SubscriptionFreezesService],
  exports: [SubscriptionFreezesService],
})
export class SubscriptionFreezesModule {}
