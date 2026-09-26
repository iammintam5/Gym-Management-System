export enum FreezeStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface SubscriptionFreezeDetail {
  id: string;
  subscriptionId: string;
  startsAt: string;
  endsAt: string;
  freezeDays: number;
  status: FreezeStatus;
  reason: string | null;
  approvedBy: string | null;
  approverName?: string | null;
  restoredAt: string | null;
  createdAt: string;
  subscription?: {
    id: string;
    memberId: string;
    memberName: string;
    memberCode: string;
    planName: string;
    startDate: string;
    endDate: string;
    status: string;
  };
}

export interface PaginatedFreezesResponse {
  data: SubscriptionFreezeDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateSubscriptionFreezeRequest {
  startsAt: string;
  endsAt: string;
  reason: string;
  autoApprove?: boolean;
}

export interface RejectFreezeRequest {
  reason?: string;
}
