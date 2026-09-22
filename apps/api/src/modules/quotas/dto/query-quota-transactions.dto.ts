import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { QuotaTransactionType } from '@gym/contracts';

export class QueryQuotaTransactionsDto {
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
    enum: QuotaTransactionType,
    description: 'Filter by transaction type (RESERVE, USE, REFUND, ADJUST)',
  })
  @IsOptional()
  @IsEnum(QuotaTransactionType)
  type?: QuotaTransactionType;

  @ApiPropertyOptional({
    description: 'Filter transactions on or after this ISO date',
  })
  @IsOptional()
  @IsDateString()
  startDateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter transactions on or before this ISO date',
  })
  @IsOptional()
  @IsDateString()
  startDateTo?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'type'],
    default: 'createdAt',
    description: 'Field to sort by',
  })
  @IsOptional()
  @IsIn(['createdAt', 'type'])
  sortBy: 'createdAt' | 'type' = 'createdAt';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
