import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.module';
import {
  AttendancePeakHoursReport,
  ClassUtilizationReport,
  DashboardSummaryReport,
  PaymentStatus,
  RevenueReportItem,
  RevenueReportResponse,
  SubscriptionStatus,
  TrainerPerformanceReport,
} from '@gym/contracts';
import { Prisma } from '@gym/database';
import { QueryRevenueReportDto } from './dto/query-revenue-report.dto';

interface RawPaymentRecord {
  id: string;
  amount: Prisma.Decimal | number;
  method: string | null;
  confirmedAt: Date | null;
  subscription?: {
    planId: string;
    plan?: {
      name: string;
    } | null;
  } | null;
}

interface RawScheduleWithBookings {
  id: string;
  capacity: number;
  startsAt: Date;
  gymClass: { name: string };
  trainer: { fullName: string };
  bookings: Array<{ id: string; status: string }>;
}

interface RawPtSession {
  id: string;
  trainerId: string;
  startsAt: Date;
  endsAt: Date;
  trainer: {
    fullName: string;
    specialization: string | null;
  };
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly db: DatabaseService) {}

  async getDashboardSummary(): Promise<DashboardSummaryReport> {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 1. Financials: Confirmed payments this month
    const payments = await this.db.client.paymentRecord.findMany({
      where: {
        status: PaymentStatus.PAID,
        confirmedAt: { gte: startOfMonth },
      },
    });

    let totalRevenue = 0;
    let cashAmount = 0;
    let transferAmount = 0;
    let cardAmount = 0;

    for (const p of payments) {
      const amt = Number(p.amount);
      totalRevenue += amt;
      const m = p.method?.toUpperCase();
      if (m === 'CASH') {
        cashAmount += amt;
      } else if (m === 'TRANSFER') {
        transferAmount += amt;
      } else if (m === 'CARD') {
        cardAmount += amt;
      }
    }

    // 2. Members: Active, New this month, Expiring within 7 days
    const [totalActiveMembers, newMembersCount, expiringWithin7DaysCount] =
      await Promise.all([
        // Active members (distinct memberId with status ACTIVE)
        this.db.client.subscription
          .groupBy({
            by: ['memberId'],
            where: {
              status: SubscriptionStatus.ACTIVE,
              startDate: { lte: now },
              endDate: { gte: now },
            },
          })
          .then((res) => res.length),

        // New members registered this month
        this.db.client.memberProfile.count({
          where: { createdAt: { gte: startOfMonth } },
        }),

        // Active subscriptions expiring within 7 days
        this.db.client.subscription.count({
          where: {
            status: SubscriptionStatus.ACTIVE,
            endDate: { gte: now, lte: in7Days },
          },
        }),
      ]);

    // 3. Operations: Checkins today, classes conducted this month, PT sessions completed this month
    const [totalCheckinsToday, classesConductedCount, ptSessionsCompletedCount] =
      await Promise.all([
        this.db.client.checkin.count({
          where: {
            checkedInAt: { gte: startOfToday },
            status: 'ACCEPTED',
          },
        }),
        this.db.client.classSchedule.count({
          where: {
            startsAt: { gte: startOfMonth, lte: now },
            status: { not: 'CANCELLED' },
          },
        }),
        this.db.client.ptBooking.count({
          where: {
            status: 'COMPLETED',
            startsAt: { gte: startOfMonth },
          },
        }),
      ]);

    return {
      period: {
        from: startOfMonth.toISOString(),
        to: now.toISOString(),
      },
      financials: {
        totalRevenue,
        cashAmount,
        transferAmount,
        cardAmount,
      },
      members: {
        totalActiveMembers,
        newMembersCount,
        expiringWithin7DaysCount,
      },
      operations: {
        totalCheckinsToday,
        classesConductedCount,
        ptSessionsCompletedCount,
      },
    };
  }

  async getRevenueReport(
    query: QueryRevenueReportDto,
  ): Promise<RevenueReportResponse> {
    const now = new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : now;
    const groupBy = query.groupBy ?? 'DAY';

    const payments = await this.db.client.paymentRecord.findMany({
      where: {
        status: PaymentStatus.PAID,
        confirmedAt: { gte: from, lte: to },
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
      orderBy: { confirmedAt: 'asc' },
    });

    const itemsMap = new Map<string, RevenueReportItem>();
    const planMap = new Map<
      string,
      { planId: string; planName: string; revenue: number; count: number }
    >();

    let totalRevenue = 0;

    for (const raw of payments as unknown as RawPaymentRecord[]) {
      const amt = Number(raw.amount);
      totalRevenue += amt;
      const date = raw.confirmedAt ?? now;

      // Group key: YYYY-MM-DD or YYYY-MM
      const bucket =
        groupBy === 'MONTH'
          ? date.toISOString().slice(0, 7)
          : date.toISOString().slice(0, 10);

      let item = itemsMap.get(bucket);
      if (!item) {
        item = {
          timeBucket: bucket,
          revenue: 0,
          paymentCount: 0,
          byMethod: { CASH: 0, TRANSFER: 0, CARD: 0 },
        };
        itemsMap.set(bucket, item);
      }

      item.revenue += amt;
      item.paymentCount += 1;

      const m = raw.method?.toUpperCase();
      if (m === 'CASH') {
        item.byMethod.CASH += amt;
      } else if (m === 'TRANSFER') {
        item.byMethod.TRANSFER += amt;
      } else if (m === 'CARD') {
        item.byMethod.CARD += amt;
      }

      // Group by Plan
      if (raw.subscription) {
        const pId = raw.subscription.planId;
        const pName = raw.subscription.plan?.name ?? 'Unknown Plan';
        let planEntry = planMap.get(pId);
        if (!planEntry) {
          planEntry = { planId: pId, planName: pName, revenue: 0, count: 0 };
          planMap.set(pId, planEntry);
        }
        planEntry.revenue += amt;
        planEntry.count += 1;
      }
    }

    const items = Array.from(itemsMap.values()).sort((a, b) =>
      a.timeBucket.localeCompare(b.timeBucket),
    );
    const byPlan = Array.from(planMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      totalRevenue,
      totalPayments: payments.length,
      items,
      byPlan,
    };
  }

  async getAttendancePeakHours(dateStr?: string): Promise<AttendancePeakHoursReport> {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    const checkins = await this.db.client.checkin.findMany({
      where: {
        status: 'ACCEPTED',
        checkedInAt: { gte: startOfDay, lte: endOfDay },
      },
    });

    const totalCheckins = checkins.length;
    const hourCounts: Record<number, number> = {};
    for (let h = 6; h <= 22; h++) {
      hourCounts[h] = 0;
    }

    for (const c of checkins) {
      const rawH = c.checkedInAt.getHours();
      const h = Math.min(22, Math.max(6, rawH));
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    }

    let peakHour: number | null = null;
    let maxCount = -1;

    const hourlyDistribution: AttendancePeakHoursReport['hourlyDistribution'] = [];

    for (let h = 6; h <= 22; h++) {
      const count = hourCounts[h] ?? 0;
      if (count > maxCount && count > 0) {
        maxCount = count;
        peakHour = h;
      }
      const percentage =
        totalCheckins > 0 ? Math.round((count / totalCheckins) * 1000) / 10 : 0;
      hourlyDistribution.push({
        hour: h,
        count,
        percentage,
      });
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      totalCheckins,
      peakHour,
      hourlyDistribution,
    };
  }

  async getClassUtilization(
    fromStr?: string,
    toStr?: string,
  ): Promise<ClassUtilizationReport> {
    const now = new Date();
    const from = fromStr
      ? new Date(fromStr)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = toStr ? new Date(toStr) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const schedules = await this.db.client.classSchedule.findMany({
      where: {
        startsAt: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
      },
      include: {
        gymClass: true,
        trainer: true,
        bookings: {
          where: {
            status: { in: ['BOOKED', 'COMPLETED'] },
          },
        },
      },
      orderBy: { startsAt: 'desc' },
    });

    let totalRates = 0;
    const items = (schedules as unknown as RawScheduleWithBookings[]).map((s) => {
      const bookedCount = s.bookings.length;
      const capacity = s.capacity;
      const utilizationRate =
        capacity > 0
          ? Math.min(100, Math.round((bookedCount / capacity) * 1000) / 10)
          : 0;

      totalRates += utilizationRate;

      return {
        scheduleId: s.id,
        className: s.gymClass.name,
        instructorName: s.trainer.fullName,
        startTime: s.startsAt.toISOString(),
        capacity,
        bookedCount,
        utilizationRate,
      };
    });

    const averageUtilizationRate =
      items.length > 0 ? Math.round((totalRates / items.length) * 10) / 10 : 0;

    return {
      averageUtilizationRate,
      totalSchedules: items.length,
      items,
    };
  }

  async getTrainerPerformance(
    fromStr?: string,
    toStr?: string,
  ): Promise<TrainerPerformanceReport> {
    const now = new Date();
    const from = fromStr
      ? new Date(fromStr)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = toStr ? new Date(toStr) : now;

    const completedSessions = await this.db.client.ptBooking.findMany({
      where: {
        status: 'COMPLETED',
        startsAt: { gte: from, lte: to },
      },
      include: {
        trainer: true,
      },
    });

    const trainerMap = new Map<
      string,
      {
        trainerId: string;
        trainerName: string;
        specialization: string | null;
        completedSessionsCount: number;
        totalTrainingMinutes: number;
      }
    >();

    for (const session of completedSessions as unknown as RawPtSession[]) {
      const tId = session.trainerId;
      let entry = trainerMap.get(tId);
      if (!entry) {
        entry = {
          trainerId: tId,
          trainerName: session.trainer.fullName,
          specialization: session.trainer.specialization,
          completedSessionsCount: 0,
          totalTrainingMinutes: 0,
        };
        trainerMap.set(tId, entry);
      }

      entry.completedSessionsCount += 1;
      const durationMin = Math.max(
        30,
        Math.round(
          (session.endsAt.getTime() - session.startsAt.getTime()) / (1000 * 60),
        ),
      );
      entry.totalTrainingMinutes += durationMin;
    }

    const items = Array.from(trainerMap.values()).map((t) => ({
      trainerId: t.trainerId,
      trainerName: t.trainerName,
      specialization: t.specialization,
      completedSessionsCount: t.completedSessionsCount,
      totalTrainingHours:
        Math.round((t.totalTrainingMinutes / 60) * 10) / 10,
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      items,
    };
  }
}
