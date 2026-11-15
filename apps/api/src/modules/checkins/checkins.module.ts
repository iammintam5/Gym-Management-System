import { CameraStationsService } from './camera-stations.service';
import { CameraStationsController } from './camera-stations.controller';
import { Module } from '@nestjs/common';
import { CheckinsController } from './checkins.controller';
import { CheckinsService } from './checkins.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CheckinsController, CameraStationsController],
  providers: [CheckinsService, CameraStationsService],
  exports: [CheckinsService],
})
export class CheckinsModule {}
