import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TrainersModule } from '../trainers/trainers.module';
import { PtAssignmentsController } from './pt-assignments.controller';
import { PtAssignmentsService } from './pt-assignments.service';

@Module({
  imports: [DatabaseModule, TrainersModule],
  controllers: [PtAssignmentsController],
  providers: [PtAssignmentsService],
})
export class PtAssignmentsModule {}
