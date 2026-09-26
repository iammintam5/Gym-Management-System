import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AttendanceStatus, BookingStatus } from '@gym/contracts';

export class QueryPtBookingsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Items per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by Trainer Employee Profile ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by Member Profile ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Filter by booking status (BOOKED, CANCELLED, COMPLETED, NO_SHOW)',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    enum: AttendanceStatus,
    description: 'Filter by attendance status (PENDING, PRESENT, ABSENT, NO_SHOW)',
  })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  attendance?: AttendanceStatus;

  @ApiPropertyOptional({
    description: 'Filter bookings starting after or on this date-time (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter bookings ending before or on this date-time (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
