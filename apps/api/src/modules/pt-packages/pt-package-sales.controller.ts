import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, type AuthUser } from '@gym/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreatePtPackagePlanDto,
  UpdatePtPackagePlanDto,
} from './dto/pt-package-plan.dto';
import { PurchasePtPackageDto } from './dto/purchase-pt-package.dto';
import { QueryPtPurchasesDto } from './dto/query-pt-purchases.dto';
import { PtCatalogInitializerService } from './pt-catalog-initializer.service';
import { PtPackagesService } from './pt-packages.service';

@ApiTags('PT Packages')
@ApiBearerAuth()
@Controller()
export class PtPackageSalesController {
  constructor(
    private readonly packages: PtPackagesService,
    private readonly initializer: PtCatalogInitializerService,
  ) {}

  @Get('pt-package-plans')
  @Roles(UserRole.ADMIN, UserRole.STAFF, UserRole.MEMBER)
  listPlans(@CurrentUser() user: AuthUser) {
    return this.packages.listPlans(user);
  }

  @Post('pt-package-plans')
  @Roles(UserRole.ADMIN)
  createPlan(
    @Body() dto: CreatePtPackagePlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.packages.savePlan(dto, user.id);
  }

  @Patch('pt-package-plans/:id')
  @Roles(UserRole.ADMIN)
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePtPackagePlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.packages.savePlan(dto, user.id, id);
  }

  @Post('pt-package-plans/initialize-defaults')
  @Roles(UserRole.ADMIN)
  initialize(@CurrentUser() user: AuthUser) {
    return this.initializer.initializeDefaultPlans({ actorId: user.id });
  }

  @Post('pt-packages/purchases')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  purchase(@Body() dto: PurchasePtPackageDto, @CurrentUser() user: AuthUser) {
    return this.packages.purchase(dto, user);
  }

  @Get('pt-packages/me/purchases')
  @Roles(UserRole.MEMBER)
  selfHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPtPurchasesDto,
  ) {
    return this.packages.selfHistory(user.id, query);
  }

  @Get('members/:memberId/pt-purchases')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  history(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Query() query: QueryPtPurchasesDto,
  ) {
    return this.packages.history(memberId, query);
  }
}
