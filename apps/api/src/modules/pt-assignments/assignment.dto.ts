import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  IsDateString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AssignPtTrainerInput } from '@gym/contracts';

export class AssignPtTrainerDto implements AssignPtTrainerInput {
  @IsUUID()
  trainerId!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignedPtSlotsQueryDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

export class AssignedMembersQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
