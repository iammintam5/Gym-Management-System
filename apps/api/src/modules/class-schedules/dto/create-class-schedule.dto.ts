import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateClassScheduleDto {
  @ApiProperty({
    description: 'Class ID (UUID)',
    example: '33333333-3333-3333-3333-333333333333',
  })
  @IsUUID()
  @IsNotEmpty()
  classId!: string;

  @ApiProperty({
    description: 'Trainer Employee ID (UUID)',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsUUID()
  @IsNotEmpty()
  trainerId!: string;

  @ApiProperty({
    description: 'Start time ISO string',
    example: '2026-10-01T08:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  startsAt!: string;

  @ApiProperty({
    description: 'End time ISO string',
    example: '2026-10-01T09:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;

  @ApiProperty({
    description: 'Maximum capacity (5 to 100 participants)',
    example: 25,
    minimum: 5,
    maximum: 100,
  })
  @IsInt()
  @Min(5)
  @Max(100)
  capacity!: number;
}
