import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
import { CheckinsService } from './checkins.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
  exports: [CheckinsService],
})
export class CheckinsModule {}
