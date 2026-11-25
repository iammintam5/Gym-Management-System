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
import { TrainerServiceFilter, UserRole } from '@gym/contracts';

export class QueryEmployeesDto {
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
    description:
      'Search by full name, email, phone, specialization, or employee code (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: [UserRole.STAFF, UserRole.TRAINER],
    description: 'Filter by employee role (STAFF or TRAINER)',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: [TrainerServiceFilter.CLASS, TrainerServiceFilter.PT],
    description: 'Filter trainers by assigned service capability (CLASS or PT)',
  })
  @IsOptional()
  @IsIn([TrainerServiceFilter.CLASS, TrainerServiceFilter.PT])
  service?: TrainerServiceFilter;

  @ApiPropertyOptional({
    description: 'Filter by active account status (true/false)',
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
    enum: [
      'createdAt',
      'updatedAt',
      'fullName',
      'phone',
      'specialization',
      'hiredAt',
    ],
    default: 'createdAt',
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsIn([
    'createdAt',
    'updatedAt',
    'fullName',
    'phone',
    'specialization',
    'hiredAt',
  ])
  sortBy:
    | 'createdAt'
    | 'updatedAt'
    | 'fullName'
    | 'phone'
    | 'specialization'
    | 'hiredAt' = 'createdAt';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
