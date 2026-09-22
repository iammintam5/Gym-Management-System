import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  UserRole,
  type AuthUser,
  type PaginatedQuotaTransactionsResponse,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QuotasService } from './quotas.service';
import { AdjustQuotaDto } from './dto/adjust-quota.dto';
import { QueryQuotaTransactionsDto } from './dto/query-quota-transactions.dto';

@ApiTags('quotas')
@ApiBearerAuth()
@Controller()
export class QuotasController {
  constructor(private readonly quotasService: QuotasService) {}

  @Get('subscriptions/:id/quotas')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get all quota snapshots for a specific subscription (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Subscription quotas list' })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getSubscriptionQuotas(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionQuotaDetail[]> {
    return this.quotasService.getSubscriptionQuotas(id);
  }

  @Get('subscriptions/me/current/quotas')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Get quota snapshots for the authenticated member current active subscription (Self-service)',
  })
  @ApiOkResponse({ description: 'Current active subscription quotas' })
  @ApiNotFoundResponse({ description: 'No active current subscription or profile found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getSelfCurrentQuotas(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionQuotaDetail[]> {
    return this.quotasService.getSelfCurrentQuotas(currentUser.id);
  }

  @Post('quotas/:id/adjust')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Administratively adjust quota allocation (Admin only)',
    description:
      'Increases or decreases the allocated quota with a mandatory reason. Invariant `allocated >= used + reserved` is enforced.',
  })
  @ApiOkResponse({ description: 'Quota adjusted successfully' })
  @ApiNotFoundResponse({ description: 'Quota not found' })
  @ApiConflictResponse({ description: 'Invalid adjustment breaks invariants or unlimited quota' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustQuotaDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionQuotaDetail> {
    return this.quotasService.adjust(id, dto, currentUser.id);
  }

  @Get('quotas/:id/transactions')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get paginated ledger transactions for a specific quota (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Paginated quota transactions' })
  @ApiNotFoundResponse({ description: 'Quota not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getQuotaTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryQuotaTransactionsDto,
  ): Promise<PaginatedQuotaTransactionsResponse> {
    return this.quotasService.getQuotaTransactions(id, query);
  }
}
