import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePtAvailabilityDto {
  @ApiProperty({
    description: 'Start time of availability slot (ISO 8601 string)',
    example: '2026-10-02T14:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  startsAt!: string;

  @ApiProperty({
    description: 'End time of availability slot (ISO 8601 string)',
    example: '2026-10-02T18:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;

  @ApiPropertyOptional({
    description: 'Note for members/staff',
    example: 'Chuyên bài tập cải thiện vóc dáng',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
