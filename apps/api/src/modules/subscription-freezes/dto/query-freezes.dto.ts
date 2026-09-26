import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FreezeStatus } from '@gym/contracts';

export class QueryFreezesDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ enum: FreezeStatus, description: 'Filter by freeze status' })
  @IsOptional()
  @IsEnum(FreezeStatus)
  status?: FreezeStatus;

  @ApiPropertyOptional({ description: 'Filter by subscription UUID' })
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiPropertyOptional({ description: 'Filter by member UUID' })
  @IsOptional()
  @IsUUID()
  memberId?: string;
}
