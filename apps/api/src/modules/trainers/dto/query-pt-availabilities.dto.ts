import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { TrainerServiceFilter } from '@gym/contracts';

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

  @ApiPropertyOptional({
    enum: [TrainerServiceFilter.PT],
    description: 'Service filter (only PT supported for 1-on-1 availability)',
    example: TrainerServiceFilter.PT,
  })
  @IsOptional()
  @IsIn([TrainerServiceFilter.PT])
  service?: typeof TrainerServiceFilter.PT;
}
