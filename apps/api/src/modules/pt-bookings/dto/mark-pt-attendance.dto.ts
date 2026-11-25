import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AttendanceStatus } from '@gym/contracts';

export class MarkPtAttendanceDto {
  @ApiPropertyOptional({
    description: 'Idempotency key for safe client retries',
    example: 'pt-att-550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiProperty({
    description: 'Attendance outcome',
    enum: [
      AttendanceStatus.PRESENT,
      AttendanceStatus.ABSENT,
      AttendanceStatus.NO_SHOW,
    ],
    example: AttendanceStatus.PRESENT,
  })
  @IsEnum(AttendanceStatus, {
    message: 'attendance must be PRESENT, ABSENT, or NO_SHOW',
  })
  @IsNotEmpty()
  attendance!:
    | AttendanceStatus.PRESENT
    | AttendanceStatus.ABSENT
    | AttendanceStatus.NO_SHOW;
}
