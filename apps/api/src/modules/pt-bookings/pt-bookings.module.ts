import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PtBookingsController } from './pt-bookings.controller';
import { PtBookingsService } from './pt-bookings.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PtBookingsController],
  providers: [PtBookingsService],
  exports: [PtBookingsService],
})
export class PtBookingsModule {}
