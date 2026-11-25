import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEmployeeRequest,
  EmployeeDetail,
  PaginatedEmployeesResponse,
  PtAvailabilityDetail,
  TrainerServiceFilter,
  TrainerSummary,
  UpdateEmployeeRequest,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export const trainersKeys = {
  all: ['trainers'] as const,
  list: (service?: TrainerServiceFilter) =>
    [...trainersKeys.all, 'list', service ?? 'ALL'] as const,
  employees: (query?: string) =>
    [...trainersKeys.all, 'employees', query ?? 'default'] as const,
  availabilities: (trainerId: string) =>
    [...trainersKeys.all, 'availabilities', trainerId] as const,
};

export const trainersApi = {
  getTrainers: (service?: TrainerServiceFilter) =>
    apiClient<TrainerSummary[]>(
      service ? `/trainers?service=${service}` : '/trainers',
    ),
  getEmployees: (query = 'limit=100') =>
    apiClient<PaginatedEmployeesResponse>(`/employees?${query}`),
  getMyProfile: () => apiClient<EmployeeDetail>('/employees/me'),
  createEmployee: (input: CreateEmployeeRequest) =>
    apiClient<EmployeeDetail>('/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateEmployee: (id: string, input: UpdateEmployeeRequest) =>
    apiClient<EmployeeDetail>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  getAvailabilities: (trainerId: string) =>
    apiClient<PtAvailabilityDetail[]>(`/trainers/${trainerId}/availabilities`),
  createMyAvailability: (input: {
    startsAt: string;
    endsAt: string;
    note?: string;
  }) =>
    apiClient<PtAvailabilityDetail>('/trainers/me/availabilities', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteMyAvailability: (availabilityId: string) =>
    apiClient<void>(`/trainers/me/availabilities/${availabilityId}`, {
      method: 'DELETE',
    }),
};

export function useEmployees(query = 'limit=100') {
  return useQuery({
    queryKey: trainersKeys.employees(query),
    queryFn: () => trainersApi.getEmployees(query),
  });
}

export function useTrainerAvailabilities(trainerId: string) {
  return useQuery({
    queryKey: trainersKeys.availabilities(trainerId),
    queryFn: () => trainersApi.getAvailabilities(trainerId),
    enabled: Boolean(trainerId),
  });
}

export function useCreateMyAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trainersApi.createMyAvailability,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trainersKeys.all });
    },
  });
}
