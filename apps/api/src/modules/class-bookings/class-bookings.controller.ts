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
  ClassBookingDetail,
  PaginatedClassBookingsResponse,
  UserRole,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClassBookingsService } from './class-bookings.service';
import { CreateClassBookingDto } from './dto/create-class-booking.dto';
import { MarkClassAttendanceDto } from './dto/mark-attendance.dto';
import { QueryClassBookingsDto } from './dto/query-class-bookings.dto';

@ApiTags('Class Bookings')
@ApiBearerAuth()
@Controller('class-bookings')
export class ClassBookingsController {
  constructor(private readonly bookingsService: ClassBookingsService) {}

  @Post()
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book a class schedule slot (Member self or Staff on behalf)' })
  @ApiResponse({ status: 201, description: 'Class slot booked successfully' })
  @ApiResponse({ status: 400, description: 'Validation or invalid subscription error' })
  @ApiResponse({ status: 404, description: 'Schedule or Member not found' })
  @ApiResponse({ status: 409, description: 'Class fully booked, quota exhausted, or already booked' })
  async createBooking(
    @Body() dto: CreateClassBookingDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassBookingDetail> {
    return this.bookingsService.createBooking(dto, user);
  }

  @Get('my')
  @Roles(UserRole.MEMBER)
  @ApiOperation({ summary: 'Get booking history for the current member' })
  @ApiResponse({ status: 200, description: 'Paginated list of member bookings' })
  async findMyBookings(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryClassBookingsDto,
  ): Promise<PaginatedClassBookingsResponse> {
    return this.bookingsService.findMyBookings(user, query);
  }

  @Get('schedule/:scheduleId')
  @Roles(UserRole.ADMIN, UserRole.STAFF, UserRole.PT)
  @ApiOperation({ summary: 'Get attendee roster for a class schedule session' })
  @ApiResponse({ status: 200, description: 'List of attendees booked for this schedule' })
  @ApiResponse({ status: 403, description: 'Forbidden if PT is not assigned trainer' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async findBySchedule(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassBookingDetail[]> {
    return this.bookingsService.findBySchedule(scheduleId, user);
  }

  @Post(':id/cancel')
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a class booking and refund quota (if > 2 hours before class)' })
  @ApiResponse({ status: 200, description: 'Booking cancelled and quota refunded' })
  @ApiResponse({ status: 400, description: 'Cannot cancel within 2 hours of class start' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 409, description: 'Booking already cancelled or attended' })
  async cancelBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassBookingDetail> {
    return this.bookingsService.cancelBooking(id, user);
  }

  @Post(':id/attendance')
  @Roles(UserRole.ADMIN, UserRole.STAFF, UserRole.PT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark attendance for an enrolled member (PRESENT or ABSENT)' })
  @ApiResponse({ status: 200, description: 'Attendance recorded successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden if caller is not staff, admin, or assigned PT' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 409, description: 'Booking cancelled or attendance already recorded' })
  async markAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkClassAttendanceDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ClassBookingDetail> {
    return this.bookingsService.markAttendance(id, dto, user);
  }
}
