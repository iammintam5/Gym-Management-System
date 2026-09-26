import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AttendanceStatus, BookingStatus } from '@gym/contracts';

export class QueryClassBookingsDto {
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
}
