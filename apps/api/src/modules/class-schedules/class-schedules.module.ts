import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ClassSchedulesController } from './class-schedules.controller';
import { ClassSchedulesService } from './class-schedules.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ClassSchedulesController],
  providers: [ClassSchedulesService],
  exports: [ClassSchedulesService],
})
export class ClassSchedulesModule {}
