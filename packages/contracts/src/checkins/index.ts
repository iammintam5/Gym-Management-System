import type { PaginationMeta } from '../users';

export enum CheckinStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export interface CheckinDetail {
  id: string;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  subscriptionId: string | null;
  planName: string | null;
  quotaId: string | null;
  status: CheckinStatus;
  rejectionReason: string | null;
  checkedInAt: string;
  recordedBy: string | null;
  recordedByName: string | null;
}

export interface PaginatedCheckinsResponse {
  data: CheckinDetail[];
  meta: PaginationMeta;
}

export interface TodayCheckinStats {
  total: number;
  accepted: number;
  rejected: number;
}
