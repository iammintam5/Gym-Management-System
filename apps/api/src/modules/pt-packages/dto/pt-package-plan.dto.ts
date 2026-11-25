import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { CreatePtPackagePlanInput } from '@gym/contracts';

export class CreatePtPackagePlanDto implements CreatePtPackagePlanInput {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,19}$/)
  @ApiProperty({ example: 'PT5', maxLength: 20 })
  code!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @ApiProperty({ example: 'Gói PT 5 buổi', maxLength: 100 })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({ maxLength: 500 })
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @ApiProperty({ example: 5, minimum: 1 })
  sessionCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999999999999)
  @ApiProperty({ example: 2250000, minimum: 0 })
  price!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @ApiPropertyOptional({ default: true })
  isActive?: boolean;
}

export class UpdatePtPackagePlanDto extends PartialType(
  CreatePtPackagePlanDto,
  { skipNullProperties: false },
) {}
