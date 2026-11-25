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
  PaginatedPtBookingsResponse,
  PtBookingDetail,
  UserRole,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PtBookingsService } from './pt-bookings.service';
import { CreatePtBookingDto } from './dto/create-pt-booking.dto';
import { MarkPtAttendanceDto } from './dto/mark-pt-attendance.dto';
import { PtBookingActionDto } from './dto/pt-booking-action.dto';
import { QueryPtBookingsDto } from './dto/query-pt-bookings.dto';

@ApiTags('PT Bookings')
@Controller('pt-bookings')
@ApiBearerAuth()
export class PtBookingsController {
  constructor(private readonly ptBookingsService: PtBookingsService) {}

  @Post()
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Book a 1-on-1 session with a Personal Trainer (Member or Staff)',
  })
  @ApiResponse({
    status: 201,
    description: 'PT session booked successfully and quota reserved',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (invalid timing, no quota or inactive subscription)',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict (Trainer or Member has overlapping booking/class)',
  })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePtBookingDto,
  ): Promise<PtBookingDetail> {
    return this.ptBookingsService.createBooking(dto, user);
  }

  @Post(':id/cancel')
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN, UserRole.TRAINER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a PT session booking (> 6h for members, anytime for staff/PT)',
  })
  @ApiResponse({
    status: 200,
    description: 'PT session cancelled successfully and quota refunded',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (late cancellation < 6 hours)',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict (already cancelled or attended)',
  })
  async cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto?: PtBookingActionDto,
  ): Promise<PtBookingDetail> {
    return this.ptBookingsService.cancelBooking(id, user, dto);
  }

  @Post(':id/complete')
  @Roles(UserRole.TRAINER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm PT session completion (consume reserved quota slot)',
  })
  @ApiResponse({
    status: 200,
    description: 'Session completed and quota consumed',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden for members',
  })
  async completeBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto?: PtBookingActionDto,
  ): Promise<PtBookingDetail> {
    return this.ptBookingsService.completeBooking(id, user, dto);
  }

  @Post(':id/attendance')
  @Roles(UserRole.TRAINER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark attendance for PT session (PRESENT or ABSENT)',
  })
  @ApiResponse({
    status: 200,
    description: 'Attendance recorded successfully',
  })
  async markAttendance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPtAttendanceDto,
  ): Promise<PtBookingDetail> {
    return this.ptBookingsService.markAttendance(id, dto, user);
  }

  @Get('my')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Member views own PT booking history',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of member PT bookings',
  })
  async getMyBookings(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
    return this.ptBookingsService.findMyBookings(user, query);
  }

  @Get('trainer')
  @Roles(UserRole.TRAINER)
  @ApiOperation({
    summary: 'Trainer views booked sessions roster',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of trainer scheduled sessions',
  })
  async getTrainerBookings(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
    return this.ptBookingsService.findTrainerBookings(user, query);
  }

  @Get()
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Staff/Admin list all PT bookings with filters',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of all PT bookings',
  })
  async getAllBookings(
    @Query() query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
    return this.ptBookingsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get details of a specific PT booking',
  })
  @ApiResponse({
    status: 200,
    description: 'PT booking details',
  })
  async getBookingDetail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PtBookingDetail> {
    return this.ptBookingsService.findById(id, user);
  }
}
