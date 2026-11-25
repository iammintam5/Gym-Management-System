import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthUser,
  ClassScheduleDetail,
  PaginatedClassSchedulesResponse,
  UserRole,
} from '@gym/contracts';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClassSchedulesService } from './class-schedules.service';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';
import { CancelClassScheduleDto } from './dto/cancel-class-schedule.dto';
import { QueryClassSchedulesDto } from './dto/query-class-schedules.dto';

@ApiTags('Class Schedules')
@Controller('class-schedules')
export class ClassSchedulesController {
  constructor(private readonly schedulesService: ClassSchedulesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Schedule a new class session (ADMIN and STAFF only)',
  })
  @ApiResponse({ status: 201, description: 'Schedule created successfully' })
  @ApiResponse({ status: 400, description: 'Timing or trainer validation error' })
  @ApiResponse({ status: 404, description: 'Class or Trainer not found' })
  @ApiResponse({ status: 409, description: 'Trainer schedule conflict or inactive class' })
  async createSchedule(
    @Body() dto: CreateClassScheduleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassScheduleDetail> {
    return this.schedulesService.createSchedule(dto, user.id);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Query class schedule timetable with filters and pagination',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of class schedules' })
  async findAll(
    @Query() query: QueryClassSchedulesDto,
  ): Promise<PaginatedClassSchedulesResponse> {
    return this.schedulesService.findAll(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get details of a class schedule session',
  })
  @ApiResponse({ status: 200, description: 'Class schedule details' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user?: AuthUser },
  ): Promise<ClassScheduleDetail> {
    return this.schedulesService.findById(id, req.user);
  }

  @Get(':id/bookings')
  @Roles(UserRole.ADMIN, UserRole.STAFF, UserRole.TRAINER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get attendee roster for a class schedule session',
  })
  @ApiResponse({ status: 200, description: 'List of enrolled attendees' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async findScheduleBookings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const detail = await this.schedulesService.findById(id, user);
    return detail.bookings ?? [];
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update schedule timing, trainer or capacity (ADMIN & STAFF only)',
  })
  @ApiResponse({ status: 200, description: 'Schedule updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Schedule or Trainer not found' })
  @ApiResponse({ status: 409, description: 'Conflict error or capacity reduction below bookings' })
  async updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassScheduleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassScheduleDetail> {
    return this.schedulesService.updateSchedule(id, dto, user.id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel class schedule and cascade refund member quotas (ADMIN & STAFF only)',
  })
  @ApiResponse({ status: 200, description: 'Schedule cancelled and quotas refunded' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  @ApiResponse({ status: 409, description: 'Schedule already cancelled or completed' })
  async cancelSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelClassScheduleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassScheduleDetail> {
    return this.schedulesService.cancelSchedule(id, dto, user.id);
  }
}
