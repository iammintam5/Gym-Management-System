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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthUser,
  PaginatedFreezesResponse,
  SubscriptionFreezeDetail,
  UserRole,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionFreezesService } from './subscription-freezes.service';
import { CreateFreezeDto } from './dto/create-freeze.dto';
import { ReviewFreezeDto } from './dto/review-freeze.dto';
import { QueryFreezesDto } from './dto/query-freezes.dto';

@ApiTags('Subscription Freezes')
@Controller()
@ApiBearerAuth()
export class SubscriptionFreezesController {
  constructor(
    private readonly freezesService: SubscriptionFreezesService,
  ) {}

  @Post('subscriptions/:id/freezes')
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request or create a freeze for a subscription',
  })
  @ApiResponse({
    status: 201,
    description: 'Freeze request submitted or approved',
  })
  async createFreeze(
    @Param('id', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CreateFreezeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    return this.freezesService.createFreeze(subscriptionId, dto, user);
  }

  @Get('subscriptions/:id/freezes')
  @ApiOperation({
    summary: 'Get freeze history for a subscription',
  })
  @ApiResponse({
    status: 200,
    description: 'List of freezes for the subscription',
  })
  async getSubscriptionFreezes(
    @Param('id', ParseUUIDPipe) subscriptionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail[]> {
    return this.freezesService.findBySubscription(subscriptionId, user);
  }

  @Post('freezes/:id/approve')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a requested freeze (Staff/Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Freeze approved successfully',
  })
  async approveFreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    return this.freezesService.approveFreeze(id, user);
  }

  @Post('freezes/:id/reject')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a requested freeze (Staff/Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Freeze rejected successfully',
  })
  async rejectFreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewFreezeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    return this.freezesService.rejectFreeze(id, dto, user);
  }

  @Post('freezes/:id/unfreeze')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unfreeze a subscription early or restore upon completion (Staff/Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription unfrozen and endDate extended',
  })
  async unfreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    return this.freezesService.unfreeze(id, user);
  }

  @Get('freezes')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Query all freeze requests across the gym (Staff/Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of freezes',
  })
  async findAllFreezes(
    @Query() query: QueryFreezesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedFreezesResponse> {
    return this.freezesService.findAll(query, user);
  }

  @Get('freezes/:id')
  @ApiOperation({
    summary: 'Get details of a specific freeze request',
  })
  @ApiResponse({
    status: 200,
    description: 'Freeze request details',
  })
  async findFreezeById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    return this.freezesService.findById(id, user);
  }
}
