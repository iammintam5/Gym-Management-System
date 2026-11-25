import { IsDateString, IsUUID, Matches } from 'class-validator';
import type { QueryStaffPtSlotsRequest } from '@gym/contracts';

export class QueryStaffPtSlotsDto implements QueryStaffPtSlotsRequest {
  @IsUUID()
  memberId!: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}
