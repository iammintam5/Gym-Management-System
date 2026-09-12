import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
// Add idempotent lifecycle jobs here after the subscription services exist.
@Module({ imports: [ScheduleModule.forRoot()] })
export class JobsModule {}
