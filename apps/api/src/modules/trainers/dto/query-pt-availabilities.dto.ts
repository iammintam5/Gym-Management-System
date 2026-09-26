import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class QueryPtAvailabilitiesDto {
  @ApiPropertyOptional({
    description: 'Filter slots starting from this date-time (ISO string)',
    example: '2026-10-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter slots ending before this date-time (ISO string)',
    example: '2026-10-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
