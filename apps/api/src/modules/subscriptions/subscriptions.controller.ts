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
  type PaginatedSubscriptionsResponse,
  type SubscriptionDetail,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Create a new subscription for a member (Admin & Staff only)',
    description:
      'Creates a subscription, initializes entitlement quotas, links payment records, and queues if the member already has an active subscription.',
  })
  @ApiOkResponse({ description: 'Subscription created successfully' })
  @ApiNotFoundResponse({ description: 'Member or Plan not found' })
  @ApiConflictResponse({ description: 'Member or Plan is inactive' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.create(dto, currentUser.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'List all subscriptions with pagination, search, filter and sorting (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Paginated list of subscriptions' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findAll(
    @Query() query: QuerySubscriptionsDto,
  ): Promise<PaginatedSubscriptionsResponse> {
    return this.subscriptionsService.findAll(query);
  }

  @Get('me')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Get subscription history for the current authenticated member (Self-service)',
  })
  @ApiOkResponse({ description: 'Member subscription history' })
  @ApiNotFoundResponse({ description: 'Member profile not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMeHistory(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionDetail[]> {
    return this.subscriptionsService.findSelfHistory(currentUser.id);
  }

  @Get('me/current')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Get current active subscription for the authenticated member (Self-service)',
  })
  @ApiOkResponse({ description: 'Current active subscription' })
  @ApiNotFoundResponse({ description: 'No active current subscription found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMeCurrent(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.findSelfCurrent(currentUser.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get subscription details by ID (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Subscription details' })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.findById(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Cancel a subscription with a mandatory reason (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Subscription cancelled successfully' })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiConflictResponse({ description: 'Subscription is already cancelled or expired' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.cancel(id, dto);
  }

  @Post(':id/renew')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Renew an active or expired subscription period (Admin & Staff)',
    description:
      'Creates a new subscription period linked via previousSubscriptionId. Does not modify the previous subscription. Initializes fresh quota snapshots and payment record.',
  })
  @ApiOkResponse({ description: 'Subscription renewed successfully' })
  @ApiNotFoundResponse({ description: 'Source subscription or target plan not found' })
  @ApiConflictResponse({
    description:
      'Cannot renew: source cancelled/suspended/pending, member has pending renewal queued, source not latest, or target plan inactive',
  })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewSubscriptionDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.renew(id, dto, currentUser.id);
  }
}

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('members/:memberId/subscriptions')
export class MemberSubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get all subscriptions for a specific member (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Member subscription history' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMemberHistory(
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<SubscriptionDetail[]> {
    return this.subscriptionsService.findMemberHistory(memberId);
  }

  @Get('current')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get current active subscription for a specific member (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Current active subscription' })
  @ApiNotFoundResponse({ description: 'No active subscription found for member' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findCurrentForMember(
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<SubscriptionDetail> {
    return this.subscriptionsService.findCurrentForMember(memberId);
  }
}
