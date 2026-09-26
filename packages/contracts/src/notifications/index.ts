export interface NotificationDetail {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface UserNotificationsResponse {
  unreadCount: number;
  totalCount: number;
  data: NotificationDetail[];
}
