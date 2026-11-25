import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PtCatalogInitializerService } from './pt-catalog-initializer.service';
import { PtCreditService } from './pt-credit.service';
import { PtLegacyConversionService } from './pt-legacy-conversion.service';
import { PtPackagesController } from './pt-packages.controller';
import { PtPackageSalesController } from './pt-package-sales.controller';
import { PtPackagesService } from './pt-packages.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PtPackagesController, PtPackageSalesController],
  providers: [
    PtPackagesService,
    PtCatalogInitializerService,
    PtCreditService,
    PtLegacyConversionService,
  ],
  exports: [
    PtCatalogInitializerService,
    PtCreditService,
    PtLegacyConversionService,
  ],
})
export class PtPackagesModule {}
