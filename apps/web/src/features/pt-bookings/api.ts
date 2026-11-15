import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceStatus,
  PaginatedPtBookingsResponse,
  PtBookingDetail,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { generateIdempotencyKey } from '@/lib/utils';

export interface CreatePtBookingInput {
  trainerId: string;
  availabilityId?: string;
  startsAt: string;
  endsAt: string;
  idempotencyKey?: string;
}

export const ptBookingsKeys = {
  all: ['pt-bookings'] as const,
  my: (query?: string) =>
    [...ptBookingsKeys.all, 'my', query ?? 'default'] as const,
  trainer: (query?: string) =>
    [...ptBookingsKeys.all, 'trainer', query ?? 'default'] as const,
};

export const ptBookingsApi = {
  getMine: (query = 'limit=50') =>
    apiClient<PaginatedPtBookingsResponse>(`/pt-bookings/my?${query}`),
  getTrainerBookings: (query = 'limit=50') =>
    apiClient<PaginatedPtBookingsResponse>(`/pt-bookings/trainer?${query}`),
  book: (input: CreatePtBookingInput) =>
    apiClient<PtBookingDetail>('/pt-bookings', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        idempotencyKey:
          input.idempotencyKey ?? generateIdempotencyKey('pt-book'),
      }),
    }),
  cancel: (bookingId: string, idempotencyKey?: string) =>
    apiClient<PtBookingDetail>(`/pt-bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey('pt-cancel'),
      }),
    }),
  markAttendance: (
    bookingId: string,
    attendance:
      | AttendanceStatus.PRESENT
      | AttendanceStatus.NO_SHOW
      | AttendanceStatus.ABSENT,
    idempotencyKey?: string,
  ) =>
    apiClient<PtBookingDetail>(`/pt-bookings/${bookingId}/attendance`, {
      method: 'POST',
      body: JSON.stringify({
        attendance,
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey('pt-att'),
      }),
    }),
};

export function useMyPtBookings(query = 'limit=50') {
  return useQuery({
    queryKey: ptBookingsKeys.my(query),
    queryFn: () => ptBookingsApi.getMine(query),
  });
}

export function useTrainerPtBookings(query = 'limit=50') {
  return useQuery({
    queryKey: ptBookingsKeys.trainer(query),
    queryFn: () => ptBookingsApi.getTrainerBookings(query),
  });
}

export function useBookPtSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ptBookingsApi.book,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ptBookingsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['trainers'] });
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });
}
