import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '@gym/contracts';

export class QueryUsersDto {
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
    description: 'Search by email, full name, or phone (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by user role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Filter by active status (true/false)',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'email'],
    default: 'createdAt',
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'email'])
  sortBy: 'createdAt' | 'updatedAt' | 'email' = 'createdAt';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
