import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClassScheduleDetail,
  GymClassDetail,
  PaginatedClassesResponse,
  PaginatedClassSchedulesResponse,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export interface CreateClassScheduleInput {
  classId: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export const classesKeys = {
  all: ['classes'] as const,
  catalog: (query?: string) =>
    [...classesKeys.all, 'catalog', query ?? 'default'] as const,
  schedules: (query?: string) =>
    [...classesKeys.all, 'schedules', query ?? 'default'] as const,
};

export const classesApi = {
  getClasses: (query = 'limit=50') =>
    apiClient<PaginatedClassesResponse>(`/classes?${query}`),
  createClass: (input: { name: string; description?: string }) =>
    apiClient<GymClassDetail>('/classes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getSchedules: (query = 'limit=100') =>
    apiClient<PaginatedClassSchedulesResponse>(`/class-schedules?${query}`),
  createSchedule: (input: CreateClassScheduleInput) =>
    apiClient<ClassScheduleDetail>('/class-schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancelSchedule: (scheduleId: string, reason?: string) =>
    apiClient<ClassScheduleDetail>(`/class-schedules/${scheduleId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        reason: reason ?? 'Huỷ ca học theo điều phối lịch',
      }),
    }),
};

export function useGymClasses(query = 'limit=50') {
  return useQuery({
    queryKey: classesKeys.catalog(query),
    queryFn: () => classesApi.getClasses(query),
  });
}

export function useClassSchedules(query = 'limit=100') {
  return useQuery({
    queryKey: classesKeys.schedules(query),
    queryFn: () => classesApi.getSchedules(query),
  });
}

export function useCreateClassSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: classesApi.createSchedule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classesKeys.all });
    },
  });
}
