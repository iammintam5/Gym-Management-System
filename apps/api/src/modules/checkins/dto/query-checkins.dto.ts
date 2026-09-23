import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CheckinStatus } from '@gym/contracts';

export class QueryCheckinsDto {
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
    description: 'Filter by member ID (UUID)',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'memberId must be a valid UUID' })
  memberId?: string;

  @ApiPropertyOptional({
    enum: CheckinStatus,
    description: 'Filter by checkin status (ACCEPTED or REJECTED)',
  })
  @IsOptional()
  @IsEnum(CheckinStatus)
  status?: CheckinStatus;

  @ApiPropertyOptional({
    description: 'Filter checkins on or after this date (ISO string)',
    example: '2026-09-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter checkins on or before this date (ISO string)',
    example: '2026-09-30T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  to?: string;

  @ApiPropertyOptional({
    enum: ['checkedInAt'],
    default: 'checkedInAt',
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsIn(['checkedInAt'])
  sortBy = 'checkedInAt' as const;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
