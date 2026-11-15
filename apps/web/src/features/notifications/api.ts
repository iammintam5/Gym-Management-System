import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationDetail,
  UserNotificationsResponse,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export const notificationsKeys = {
  all: ['notifications'] as const,
  my: (query?: string) =>
    [...notificationsKeys.all, 'my', query ?? 'default'] as const,
};

export const notificationsApi = {
  getMine: (query = 'limit=20') =>
    apiClient<UserNotificationsResponse>(`/notifications/my?${query}`),
  markRead: (notificationId: string) =>
    apiClient<NotificationDetail>(`/notifications/${notificationId}/read`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    }),
  markAllRead: () =>
    apiClient<{ updatedCount: number }>('/notifications/read-all', {
      method: 'PATCH',
      body: JSON.stringify({}),
    }),
};

export function useMyNotifications(query = 'limit=20') {
  return useQuery({
    queryKey: notificationsKeys.my(query),
    queryFn: () => notificationsApi.getMine(query),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
    },
  });
}
