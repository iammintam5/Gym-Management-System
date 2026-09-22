import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [DatabaseModule],
  controllers: [QuotasController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}

