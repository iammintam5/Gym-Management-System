import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceStatus,
  ClassBookingDetail,
  PaginatedClassBookingsResponse,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { generateIdempotencyKey } from '@/lib/utils';

export const classBookingsKeys = {
  all: ['class-bookings'] as const,
  my: (query?: string) =>
    [...classBookingsKeys.all, 'my', query ?? 'default'] as const,
  bySchedule: (scheduleId: string) =>
    [...classBookingsKeys.all, 'schedule', scheduleId] as const,
};

export const classBookingsApi = {
  getMine: (query = 'limit=50') =>
    apiClient<PaginatedClassBookingsResponse>(`/class-bookings/my?${query}`),
  getBySchedule: (scheduleId: string) =>
    apiClient<ClassBookingDetail[]>(`/class-bookings/schedule/${scheduleId}`),
  book: (scheduleId: string, idempotencyKey?: string) =>
    apiClient<ClassBookingDetail>('/class-bookings', {
      method: 'POST',
      body: JSON.stringify({
        scheduleId,
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey('cb-book'),
      }),
    }),
  cancel: (bookingId: string, idempotencyKey?: string) =>
    apiClient<ClassBookingDetail>(`/class-bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey('cb-cancel'),
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
    apiClient<ClassBookingDetail>(`/class-bookings/${bookingId}/attendance`, {
      method: 'POST',
      body: JSON.stringify({
        attendance,
        idempotencyKey: idempotencyKey ?? generateIdempotencyKey('cb-att'),
      }),
    }),
};

export function useMyClassBookings(query = 'limit=50') {
  return useQuery({
    queryKey: classBookingsKeys.my(query),
    queryFn: () => classBookingsApi.getMine(query),
  });
}

export function useBookClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId }: { scheduleId: string }) =>
      classBookingsApi.book(scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classBookingsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['classes'] });
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });
}

export function useCancelClassBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      classBookingsApi.cancel(bookingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classBookingsKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['classes'] });
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });
}
