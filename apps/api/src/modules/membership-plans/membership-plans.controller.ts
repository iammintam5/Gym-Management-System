import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  UserRole,
  type MembershipPlanDetail,
  type PaginatedMembershipPlansResponse,
  type ServiceTypeItem,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MembershipPlansService } from './membership-plans.service';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import { UpdateMembershipPlanStatusDto } from './dto/update-membership-plan-status.dto';
import { UpsertPlanEntitlementsDto } from './dto/upsert-plan-entitlements.dto';
import { QueryMembershipPlansDto } from './dto/query-membership-plans.dto';

@ApiTags('membership-plans')
@ApiBearerAuth()
@Controller('membership-plans')
export class MembershipPlansController {
  constructor(
    private readonly membershipPlansService: MembershipPlansService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new membership plan (Admin only)',
    description:
      'Creates a new membership plan along with its initial entitlements atomically in a single transaction.',
  })
  @ApiOkResponse({ description: 'Membership plan successfully created' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async create(
    @Body() dto: CreateMembershipPlanDto,
  ): Promise<MembershipPlanDetail> {
    return this.membershipPlansService.create(dto);
  }

  @Get('public')
  @Public()
  @ApiOperation({
    summary: 'Get all active membership plans for public display (No auth required)',
  })
  @ApiOkResponse({ description: 'List of active membership plans' })
  async findPublicPlans(): Promise<MembershipPlanDetail[]> {
    return this.membershipPlansService.findPublic();
  }

  @Get('service-types')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get list of available service types (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'List of service types' })
  async getServiceTypes(): Promise<ServiceTypeItem[]> {
    return this.membershipPlansService.getServiceTypes();
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'List membership plans with pagination, search, filter and sorting (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Paginated list of membership plans' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findAll(
    @Query() query: QueryMembershipPlansDto,
  ): Promise<PaginatedMembershipPlansResponse> {
    return this.membershipPlansService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get membership plan details by ID (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Membership plan detail' })
  @ApiNotFoundResponse({ description: 'Membership plan not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MembershipPlanDetail> {
    return this.membershipPlansService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update membership plan metadata (Admin only)',
  })
  @ApiOkResponse({ description: 'Membership plan successfully updated' })
  @ApiNotFoundResponse({ description: 'Membership plan not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipPlanDto,
  ): Promise<MembershipPlanDetail> {
    return this.membershipPlansService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Activate or deactivate a membership plan (Admin only)',
  })
  @ApiOkResponse({ description: 'Membership plan status updated' })
  @ApiNotFoundResponse({ description: 'Membership plan not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipPlanStatusDto,
  ): Promise<MembershipPlanDetail> {
    return this.membershipPlansService.updateStatus(id, dto);
  }

  @Put(':id/entitlements')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Replace entitlements for a membership plan atomically (Admin only)',
  })
  @ApiOkResponse({ description: 'Plan entitlements successfully updated' })
  @ApiNotFoundResponse({ description: 'Membership plan not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateEntitlements(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPlanEntitlementsDto,
  ): Promise<MembershipPlanDetail> {
    return this.membershipPlansService.updateEntitlements(id, dto);
  }
}

@ApiTags('membership-plans')
@Controller('public/membership-plans')
export class PublicMembershipPlansController {
  constructor(
    private readonly membershipPlansService: MembershipPlansService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Get all active membership plans at /api/public/membership-plans',
  })
  @ApiOkResponse({ description: 'List of active membership plans' })
  async findPublicPlans(): Promise<MembershipPlanDetail[]> {
    return this.membershipPlansService.findPublic();
  }
}
