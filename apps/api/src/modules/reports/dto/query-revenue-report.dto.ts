import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class QueryRevenueReportDto {
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['DAY', 'MONTH'], default: 'DAY', description: 'Group time series by DAY or MONTH' })
  @IsOptional()
  @IsIn(['DAY', 'MONTH'])
  groupBy?: 'DAY' | 'MONTH' = 'DAY';
}
