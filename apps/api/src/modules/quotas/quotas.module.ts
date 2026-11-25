import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PtPackagesModule } from '../pt-packages/pt-packages.module';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [DatabaseModule, PtPackagesModule],
  controllers: [QuotasController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}
