import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QuotasModule } from '../quotas/quotas.module';
import { ClassBookingsController } from './class-bookings.controller';
import { ClassBookingsService } from './class-bookings.service';

@Module({
  imports: [DatabaseModule, QuotasModule],
  controllers: [ClassBookingsController],
  providers: [ClassBookingsService],
  exports: [ClassBookingsService],
})
export class ClassBookingsModule {}
