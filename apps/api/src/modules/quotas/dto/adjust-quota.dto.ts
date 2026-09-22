import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdjustQuotaDto {
  @ApiPropertyOptional({
    description:
      'Delta to add to or subtract from allocated limit (e.g. +2 or -1). Null/0 not allowed if modifying allocation.',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'allocatedDelta must be an integer' })
  allocatedDelta?: number;

  @ApiProperty({
    description: 'Mandatory reason for admin quota adjustment',
    example: 'Manual customer service compensation for studio downtime',
  })
  @IsString()
  @IsNotEmpty({ message: 'reason is required for quota adjustments' })
  @MaxLength(500)
  reason!: string;
}
