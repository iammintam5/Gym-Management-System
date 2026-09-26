import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class UpdateClassScheduleDto {
  @ApiPropertyOptional({
    description: 'Updated trainer employee ID (UUID)',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @ApiPropertyOptional({
    description: 'Updated start time ISO string',
    example: '2026-10-01T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'Updated end time ISO string',
    example: '2026-10-01T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({
    description: 'Updated capacity (5 to 100 participants)',
    example: 30,
    minimum: 5,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  capacity?: number;
}
