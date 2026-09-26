import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.module';
import {
  NotificationDetail,
  UserNotificationsResponse,
} from '@gym/contracts';
import { Prisma } from '@gym/database';

interface RawNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<NotificationDetail> {
    const record = await this.db.client.notification.create({
      data: {
        userId,
        title,
        body,
        data: data ? (data as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    this.logger.log(`Created notification ${record.id} for user ${userId}`);
    return this.mapNotification(record);
  }

  async getMyNotifications(
    userId: string,
    unreadOnly = false,
  ): Promise<UserNotificationsResponse> {
    const where: Prisma.NotificationWhereInput = { userId };
    if (unreadOnly) {
      where.readAt = null;
    }

    const [unreadCount, totalCount, records] = await Promise.all([
      this.db.client.notification.count({
        where: { userId, readAt: null },
      }),
      this.db.client.notification.count({
        where: { userId },
      }),
      this.db.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      unreadCount,
      totalCount,
      data: (records as RawNotification[]).map((r) => this.mapNotification(r)),
    };
  }

  async markAsRead(id: string, userId: string): Promise<NotificationDetail> {
    const notification = await this.db.client.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền thao tác trên thông báo này',
      );
    }

    if (notification.readAt) {
      return this.mapNotification(notification);
    }

    const updated = await this.db.client.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return this.mapNotification(updated);
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const result = await this.db.client.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return { updatedCount: result.count };
  }

  private mapNotification(raw: RawNotification): NotificationDetail {
    return {
      id: raw.id,
      userId: raw.userId,
      title: raw.title,
      body: raw.body,
      data: raw.data as Record<string, unknown> | null,
      readAt: raw.readAt ? raw.readAt.toISOString() : null,
      isRead: raw.readAt !== null,
      createdAt: raw.createdAt.toISOString(),
    };
  }
}
