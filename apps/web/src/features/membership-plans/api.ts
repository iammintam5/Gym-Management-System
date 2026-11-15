import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateMembershipPlanRequest,
  MembershipPlanDetail,
  PaginatedMembershipPlansResponse,
  ServiceTypeItem,
  UpdateMembershipPlanRequest,
  UpsertPlanEntitlementsRequest,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export const membershipPlansKeys = {
  all: ['membership-plans'] as const,
  public: () => [...membershipPlansKeys.all, 'public'] as const,
  list: (query?: string) =>
    [...membershipPlansKeys.all, 'list', query ?? 'default'] as const,
  serviceTypes: () => [...membershipPlansKeys.all, 'service-types'] as const,
};

export const membershipPlansApi = {
  getPublic: () =>
    apiClient<MembershipPlanDetail[]>('/membership-plans/public'),
  getAll: (query = 'limit=50') =>
    apiClient<PaginatedMembershipPlansResponse>(`/membership-plans?${query}`),
  getServiceTypes: () =>
    apiClient<ServiceTypeItem[]>('/membership-plans/service-types'),
  create: (input: CreateMembershipPlanRequest) =>
    apiClient<MembershipPlanDetail>('/membership-plans', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateMembershipPlanRequest) =>
    apiClient<MembershipPlanDetail>(`/membership-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updateStatus: (id: string, isActive: boolean) =>
    apiClient<MembershipPlanDetail>(`/membership-plans/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  upsertEntitlements: (id: string, input: UpsertPlanEntitlementsRequest) =>
    apiClient<MembershipPlanDetail>(`/membership-plans/${id}/entitlements`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};

export function usePublicMembershipPlans() {
  return useQuery({
    queryKey: membershipPlansKeys.public(),
    queryFn: () => membershipPlansApi.getPublic(),
  });
}

export function useMembershipPlans(query = 'limit=50') {
  return useQuery({
    queryKey: membershipPlansKeys.list(query),
    queryFn: () => membershipPlansApi.getAll(query),
  });
}

export function useUpsertMembershipPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id?: string;
      data: CreateMembershipPlanRequest;
    }) => {
      if (params.id) {
        await membershipPlansApi.update(params.id, {
          name: params.data.name,
          description: params.data.description,
          durationDays: params.data.durationDays,
          price: params.data.price,
        });
        if (params.data.entitlements) {
          return membershipPlansApi.upsertEntitlements(params.id, {
            entitlements: params.data.entitlements,
          });
        }
      }
      return membershipPlansApi.create(params.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membershipPlansKeys.all });
    },
  });
}
