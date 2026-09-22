export type LimitType = 'UNLIMITED' | 'COUNT' | 'NONE';

export interface PlanEntitlementItem {
  id?: string;
  service: string;
  serviceName?: string;
  limitType: LimitType;
  limitValue: number | null;
}

export interface MembershipPlanSummary {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  price: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipPlanDetail extends MembershipPlanSummary {
  entitlements: PlanEntitlementItem[];
}

export interface PaginatedMembershipPlansResponse {
  data: MembershipPlanDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreatePlanEntitlementInput {
  service: string;
  limitType: LimitType;
  limitValue?: number | null;
}

export interface CreateMembershipPlanRequest {
  name: string;
  description?: string | null;
  durationDays: number;
  price: number;
  isActive?: boolean;
  entitlements?: CreatePlanEntitlementInput[];
}

export interface UpdateMembershipPlanRequest {
  name?: string;
  description?: string | null;
  durationDays?: number;
  price?: number;
}

export interface UpdateMembershipPlanStatusRequest {
  isActive: boolean;
}

export interface UpsertPlanEntitlementsRequest {
  entitlements: CreatePlanEntitlementInput[];
}

export interface ServiceTypeItem {
  id: string;
  code: string;
  name: string;
}
