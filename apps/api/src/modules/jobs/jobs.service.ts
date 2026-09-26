import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthUser, SubscriptionStatus, UserRole } from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionFreezesService } from '../subscription-freezes/subscription-freezes.service';

const SYSTEM_ACTOR: AuthUser = {
  id: '00000000-0000-0000-0000-000000000000',
  roles: [UserRole.ADMIN],
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notificationsService: NotificationsService,
    private readonly freezesService: SubscriptionFreezesService,
  ) {}

  /**
   * Daily 00:01 AM - Scan subscriptions expiring in the next 7 days and send reminders
   */
  @Cron('1 0 * * *')
  async handleNightlyExpiryScan(): Promise<void> {
    this.logger.log('Starting nightly subscription expiry scan...');
    const result = await this.runExpiryScan();
    this.logger.log(
      `Completed expiry scan: ${result.scanned} subscriptions analyzed, ${result.notified} reminder notifications sent`,
    );
  }

  /**
   * Daily 00:05 AM - Auto-complete freezes that have reached endsAt, extending endDate and reactivating subscription
   */
  @Cron('5 0 * * *')
  async handleNightlyFreezeAutoRestore(): Promise<void> {
    this.logger.log('Starting nightly freeze auto-restoration...');
    const result = await this.runFreezeAutoRestore();
    this.logger.log(
      `Completed freeze auto-restoration: ${result.restored} subscriptions restored to ACTIVE`,
    );
  }

  /**
   * Programmatically invocable expiry scanner (used by cron and integration tests)
   */
  async runExpiryScan(
    targetNow?: Date,
  ): Promise<{ scanned: number; notified: number }> {
    const now = targetNow ? new Date(targetNow) : new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const expiringSubs = await this.db.client.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: {
          gte: now,
          lte: in7Days,
        },
      },
      include: {
        member: { include: { user: true } },
        plan: true,
      },
    });

    let notified = 0;

    for (const sub of expiringSubs) {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(sub.endDate).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

      const title = 'Gói tập sắp hết hạn';
      const body = `Gói tập ${sub.plan.name} của bạn sẽ hết hạn sau ${daysLeft} ngày (ngày ${new Date(sub.endDate).toLocaleDateString('vi-VN')}). Vui lòng gia hạn để không bị gián đoạn tập luyện.`;

      await this.notificationsService.createNotification(
        sub.member.userId,
        title,
        body,
        {
          subscriptionId: sub.id,
          type: 'EXPIRY_REMINDER',
          daysLeft,
        },
      );

      notified += 1;
    }

    return { scanned: expiringSubs.length, notified };
  }

  /**
   * Programmatically invocable freeze auto-restoration (used by cron and integration tests)
   */
  async runFreezeAutoRestore(
    targetNow?: Date,
  ): Promise<{ restored: number }> {
    const now = targetNow ? new Date(targetNow) : new Date();

    const dueFreezes = await this.db.client.subscriptionFreeze.findMany({
      where: {
        status: 'APPROVED',
        endsAt: { lte: now },
        restoredAt: null,
      },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
      },
    });

    let restored = 0;

    for (const freeze of dueFreezes) {
      try {
        await this.freezesService.unfreeze(freeze.id, SYSTEM_ACTOR);

        // Notify member of auto-restoration
        if (freeze.subscription?.member) {
          await this.notificationsService.createNotification(
            freeze.subscription.member.userId,
            'Bảo lưu gói tập đã kết thúc',
            `Thời gian bảo lưu gói tập ${freeze.subscription.plan.name} của bạn đã kết thúc. Gói tập đã được tự động mở lại và thời hạn tập được gia hạn thêm ${freeze.freezeDays} ngày.`,
            {
              subscriptionId: freeze.subscriptionId,
              freezeId: freeze.id,
              type: 'FREEZE_AUTO_RESTORED',
            },
          );
        }

        restored += 1;
      } catch (err: unknown) {
        const error = err as Error;
        this.logger.error(
          `Failed to auto-restore freeze ${freeze.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    return { restored };
  }
}
