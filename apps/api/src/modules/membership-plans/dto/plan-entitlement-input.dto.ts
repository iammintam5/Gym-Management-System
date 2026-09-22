import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import type { LimitType } from '@gym/contracts';

export class PlanEntitlementInputDto {
  @ApiProperty({
    description: 'Service type code (e.g. GYM_ACCESS, CLASS, PT)',
    example: 'GYM_ACCESS',
  })
  @IsString()
  @IsNotEmpty()
  service!: string;

  @ApiProperty({
    enum: ['UNLIMITED', 'COUNT', 'NONE'],
    description: 'Limit type for the service entitlement',
    example: 'UNLIMITED',
  })
  @IsIn(['UNLIMITED', 'COUNT', 'NONE'])
  limitType!: LimitType;

  @ApiPropertyOptional({
    description: 'Allowed quota count (required if limitType is COUNT, must be > 0)',
    example: 12,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limitValue?: number | null;
}
