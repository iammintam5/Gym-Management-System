import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PlanEntitlementInputDto } from './plan-entitlement-input.dto';

export class CreateMembershipPlanDto {
  @ApiProperty({
    description: 'Name of the membership plan',
    example: 'Gold Annual Package',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Description of what this plan offers',
    example: 'Full gym access, 12 classes per month, 4 PT sessions',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Validity duration in days (> 0)',
    example: 30,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays!: number;

  @ApiProperty({
    description: 'Price in currency units (>= 0)',
    example: 1500000,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    description: 'Whether the plan is actively available for purchase',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'List of service entitlements for this plan',
    type: [PlanEntitlementInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanEntitlementInputDto)
  entitlements?: PlanEntitlementInputDto[];
}
