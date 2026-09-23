import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
  type AuthUser,
  type CheckinDetail,
  type PaginatedCheckinsResponse,
  type TodayCheckinStats,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckinsService } from './checkins.service';
import { CreateCheckinDto } from './dto/create-checkin.dto';
import { QueryCheckinsDto } from './dto/query-checkins.dto';

@ApiTags('checkins')
@ApiBearerAuth()
@Controller('checkins')
export class CheckinsController {
  constructor(private readonly checkinsService: CheckinsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Process a gym access check-in attempt (Admin & Staff / Turnstile Gate)',
    description:
      'Validates active membership, executes Anti-passback checks (1 min), verifies GYM_ACCESS entitlement, and atomically consumes quota if finite.',
  })
  @ApiOkResponse({ description: 'Check-in processed (status ACCEPTED or REJECTED)' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async recordCheckin(
    @Body() dto: CreateCheckinDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<CheckinDetail> {
    return this.checkinsService.recordCheckin(dto, currentUser.id);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'List all check-in records with filters and pagination (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Paginated check-in records' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findAll(
    @Query() query: QueryCheckinsDto,
  ): Promise<PaginatedCheckinsResponse> {
    return this.checkinsService.findAll(query);
  }

  @Get('today-stats')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get check-in statistics for today (total, accepted, rejected) (Admin & Staff)',
  })
  @ApiOkResponse({ description: 'Today check-in statistics' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin & Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getTodayStats(): Promise<TodayCheckinStats> {
    return this.checkinsService.getTodayStats();
  }

  @Get('me')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Get personal check-in history for authenticated member (Self-service)',
  })
  @ApiOkResponse({ description: 'Personal check-in history' })
  @ApiNotFoundResponse({ description: 'Member profile not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMe(
    @CurrentUser() currentUser: AuthUser,
  ): Promise<CheckinDetail[]> {
    return this.checkinsService.findSelfHistory(currentUser.id);
  }
}
