import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateFreezeDto {
  @ApiProperty({
    description: 'Freeze start date (ISO 8601 string)',
    example: '2026-10-10T00:00:00.000Z',
  })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({
    description: 'Freeze end date (ISO 8601 string)',
    example: '2026-10-24T00:00:00.000Z',
  })
  @IsDateString()
  endsAt!: string;

  @ApiProperty({
    description: 'Mandatory reason for freezing',
    example: 'Đi công tác nước ngoài 2 tuần',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: 'For Staff/Admin: whether to automatically approve immediately (default: true)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;
}
