import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckinDetail,
  PaginatedCheckinsResponse,
  TodayCheckinStats,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { generateIdempotencyKey } from '@/lib/utils';

export interface CreateCheckinInput {
  memberCode?: string;
  memberId?: string;
  idempotencyKey?: string;
}

export const checkinsKeys = {
  all: ['checkins'] as const,
  list: (params?: string) =>
    [...checkinsKeys.all, 'list', params ?? 'default'] as const,
  todayStats: () => [...checkinsKeys.all, 'today-stats'] as const,
  me: () => [...checkinsKeys.all, 'me'] as const,
};

export const checkinsApi = {
  getAll: (query = 'limit=50') =>
    apiClient<PaginatedCheckinsResponse>(`/checkins?${query}`),
  getTodayStats: () => apiClient<TodayCheckinStats>('/checkins/today-stats'),
  getMine: (query = 'limit=20') =>
    apiClient<PaginatedCheckinsResponse>(`/checkins/me?${query}`),
  create: (input: CreateCheckinInput) =>
    apiClient<CheckinDetail>('/checkins', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey('chk'),
      }),
    }),
};

export function useCheckinsList(query = 'limit=50') {
  return useQuery({
    queryKey: checkinsKeys.list(query),
    queryFn: () => checkinsApi.getAll(query),
  });
}

export function useTodayCheckinStats() {
  return useQuery({
    queryKey: checkinsKeys.todayStats(),
    queryFn: () => checkinsApi.getTodayStats(),
  });
}

export function useMyCheckins(query = 'limit=20') {
  return useQuery({
    queryKey: checkinsKeys.me(),
    queryFn: () => checkinsApi.getMine(query),
  });
}

export function useCreateCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkinsApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: checkinsKeys.all });
    },
  });
}
