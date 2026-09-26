import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ReconciliationQueryDto {
  @ApiPropertyOptional({
    description: 'Specific date for reconciliation (YYYY-MM-DD or ISO string, defaults to today)',
    example: '2026-09-23',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific Cashier User ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  cashierId?: string;

  @ApiPropertyOptional({
    description: 'Start of shift / period (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of shift / period (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
