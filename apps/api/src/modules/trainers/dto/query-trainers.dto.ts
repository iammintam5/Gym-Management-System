import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { TrainerServiceFilter } from '@gym/contracts';

export class QueryTrainersDto {
  @ApiPropertyOptional({
    enum: [TrainerServiceFilter.CLASS, TrainerServiceFilter.PT],
    description: 'Filter eligible trainers by service capability (CLASS or PT)',
    example: TrainerServiceFilter.CLASS,
  })
  @IsOptional()
  @IsIn([TrainerServiceFilter.CLASS, TrainerServiceFilter.PT])
  service?: TrainerServiceFilter;
}
