import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckinDetail,
  CheckinStatus,
  PaginatedCheckinsResponse,
  PaymentStatus,
  QuotaTransactionType,
  ServiceTypeCode,
  SubscriptionStatus,
  TodayCheckinStats,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { CreateCheckinDto } from './dto/create-checkin.dto';
import { QueryCheckinsDto } from './dto/query-checkins.dto';

interface RawCheckinWithRelations {
  id: string;
  memberId: string;
  subscriptionId: string | null;
  quotaId: string | null;
  status: string;
  rejectionReason: string | null;
  checkedInAt: Date;
  recordedBy: string | null;
  member?: {
    id: string;
    fullName: string;
    gender?: string | null;
    idPhotoUrl?: string | null;
  } | null;
  subscription?: {
    id: string;
    plan?: {
      name: string;
    } | null;
  } | null;
  recorder?: {
    email: string;
    employeeProfile?: {
      fullName: string;
    } | null;
  } | null;
}

@Injectable()
export class CheckinsService {
  private readonly logger = new Logger(CheckinsService.name);

  constructor(private readonly db: DatabaseService) {}

  async recordCheckin(
    dto: CreateCheckinDto,
    actorId: string,
  ): Promise<CheckinDetail> {
    if (!dto.memberId && !dto.memberCode) {
      throw new BadRequestException(
        'Either memberId or memberCode must be provided',
      );
    }

    let member = null;
    if (dto.memberId) {
      member = await this.db.client.memberProfile.findUnique({
        where: { id: dto.memberId },
        include: { user: true },
      });
    } else if (dto.memberCode) {
      const cleanCode = dto.memberCode.trim().toUpperCase();
      const rawIdPart = cleanCode.startsWith('MEM-')
        ? cleanCode.substring(4).toLowerCase()
        : cleanCode.toLowerCase();

      const profiles = await this.db.client.memberProfile.findMany({
        include: { user: true },
      });
      member =
        profiles.find((p) => {
          const formatted = `MEM-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
          return (
            formatted === cleanCode ||
            p.id.replace(/-/g, '').toLowerCase().startsWith(rawIdPart) ||
            p.id.toLowerCase().startsWith(rawIdPart)
          );
        }) ?? null;
    }

    if (!member) {
      throw new NotFoundException(
        dto.memberId
          ? `Member with ID "${dto.memberId}" not found`
          : `Member with code "${dto.memberCode}" not found`,
      );
    }

    const now = new Date();

    // 1. Validate active user account
    if (!member.user.isActive) {
      return this.createCheckinRecord({
        memberId: member.id,
        subscriptionId: null,
        quotaId: null,
        status: CheckinStatus.REJECTED,
        rejectionReason: 'Tài khoản hội viên đã bị vô hiệu hoá (Inactive account)',
        recordedBy: actorId,
      });
    }

    // 2. Anti-Passback check: Reject if member checked in successfully within last 1 minute
    const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);
    const recentCheckin = await this.db.client.checkin.findFirst({
      where: {
        memberId: member.id,
        status: CheckinStatus.ACCEPTED,
        checkedInAt: { gte: oneMinuteAgo },
      },
      orderBy: { checkedInAt: 'desc' },
    });

    if (recentCheckin) {
      return this.createCheckinRecord({
        memberId: member.id,
        subscriptionId: recentCheckin.subscriptionId,
        quotaId: recentCheckin.quotaId,
        status: CheckinStatus.REJECTED,
        rejectionReason:
          'Anti-passback: Hội viên vừa quẹt thẻ vào cổng trong vòng 1 phút trước',
        recordedBy: actorId,
      });
    }

    // 3. Find currently active subscription or JIT promote eligible UPCOMING subscription
    let currentSub = await this.db.client.subscription.findFirst({
      where: {
        memberId: member.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { startDate: 'desc' },
      include: {
        plan: true,
        quotas: { include: { serviceType: true } },
      },
    });

    if (!currentSub) {
      const eligibleUpcoming = await this.db.client.subscription.findFirst({
        where: {
          memberId: member.id,
          status: SubscriptionStatus.UPCOMING,
          paymentStatus: PaymentStatus.PAID,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        orderBy: { startDate: 'asc' },
        include: {
          plan: true,
          quotas: { include: { serviceType: true } },
        },
      });

      if (eligibleUpcoming) {
        currentSub = await this.db.client.subscription.update({
          where: { id: eligibleUpcoming.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            activatedAt: now,
          },
          include: {
            plan: true,
            quotas: { include: { serviceType: true } },
          },
        });
        this.logger.log(
          `JIT Activation on Checkin: Promoted subscription ${currentSub.id} to ACTIVE for member ${member.id}`,
        );
      }
    }

    if (!currentSub) {
      // Check if member has a SUSPENDED subscription (freeze)
      const suspendedSub = await this.db.client.subscription.findFirst({
        where: {
          memberId: member.id,
          status: SubscriptionStatus.SUSPENDED,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      });

      if (suspendedSub) {
        return this.createCheckinRecord({
          memberId: member.id,
          subscriptionId: suspendedSub.id,
          quotaId: null,
          status: CheckinStatus.REJECTED,
          rejectionReason: 'Gói tập đang trong thời gian bảo lưu (SUSPENDED)',
          recordedBy: actorId,
        });
      }

      return this.createCheckinRecord({
        memberId: member.id,
        subscriptionId: null,
        quotaId: null,
        status: CheckinStatus.REJECTED,
        rejectionReason:
          'Hội viên không có gói tập đang hoạt động hoặc gói tập đã hết hạn',
        recordedBy: actorId,
      });
    }

    // 4. Validate GYM_ACCESS entitlement and quota availability
    const gymQuota = currentSub.quotas.find(
      (q) => q.serviceType.code === ServiceTypeCode.GYM_ACCESS,
    );

    if (!gymQuota) {
      return this.createCheckinRecord({
        memberId: member.id,
        subscriptionId: currentSub.id,
        quotaId: null,
        status: CheckinStatus.REJECTED,
        rejectionReason:
          'Gói tập hiện tại không bao gồm quyền vào phòng Gym (GYM_ACCESS)',
        recordedBy: actorId,
      });
    }

    if (gymQuota.allocated !== null && gymQuota.used >= gymQuota.allocated) {
      return this.createCheckinRecord({
        memberId: member.id,
        subscriptionId: currentSub.id,
        quotaId: gymQuota.id,
        status: CheckinStatus.REJECTED,
        rejectionReason:
          'Gói tập đã hết số lượt vào phòng Gym (GYM_ACCESS quota exhausted)',
        recordedBy: actorId,
      });
    }

    // 5. Atomic Transaction: record ACCEPTED checkin and consume quota if finite
    const checkin = await this.db.client.$transaction(async (tx) => {
      const createdCheckin = await tx.checkin.create({
        data: {
          memberId: member.id,
          subscriptionId: currentSub.id,
          quotaId: gymQuota.id,
          status: CheckinStatus.ACCEPTED,
          rejectionReason: null,
          checkedInAt: now,
          recordedBy: actorId,
        },
        include: {
          member: true,
          subscription: { include: { plan: true } },
          recorder: {
            include: {
              employeeProfile: true,
            },
          },
        },
      });

      if (gymQuota.allocated !== null) {
        await tx.subscriptionQuota.update({
          where: { id: gymQuota.id },
          data: { used: { increment: 1 } },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: gymQuota.id,
            subscriptionId: currentSub.id,
            type: QuotaTransactionType.USE,
            allocatedDelta: 0,
            reservedDelta: 0,
            usedDelta: 1,
            idempotencyKey: `checkin-${createdCheckin.id}`,
            referenceType: 'CHECKIN',
            referenceId: createdCheckin.id,
            reason: 'Điểm danh vào cổng phòng Gym (Turnstile Gate Check-in)',
            createdBy: actorId,
          },
        });
      }

      return createdCheckin;
    });

    const memberCode = `MEM-${member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    this.logger.log(
      `Checkin ACCEPTED: Member ${memberCode} (${member.id}) checked in via subscription ${currentSub.id}`,
    );

    return this.mapCheckinDetail(checkin as unknown as RawCheckinWithRelations);
  }

  async findAll(query: QueryCheckinsDto): Promise<PaginatedCheckinsResponse> {
    const where: {
      memberId?: string;
      status?: CheckinStatus;
      checkedInAt?: { gte?: Date; lte?: Date };
    } = {};

    if (query.memberId) {
      where.memberId = query.memberId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.from || query.to) {
      where.checkedInAt = {};
      if (query.from) {
        where.checkedInAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.checkedInAt.lte = new Date(query.to);
      }
    }

    const skip = (query.page - 1) * query.limit;
    const [total, items] = await Promise.all([
      this.db.client.checkin.count({ where }),
      this.db.client.checkin.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { checkedInAt: query.sortOrder },
        include: {
          member: true,
          subscription: { include: { plan: true } },
          recorder: {
            include: { employeeProfile: true },
          },
        },
      }),
    ]);

    return {
      data: items.map((item) =>
        this.mapCheckinDetail(item as unknown as RawCheckinWithRelations),
      ),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async findSelfHistory(userId: string): Promise<CheckinDetail[]> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Member profile not found for the current user',
      );
    }

    const items = await this.db.client.checkin.findMany({
      where: { memberId: profile.id },
      orderBy: { checkedInAt: 'desc' },
      take: 50,
      include: {
        member: true,
        subscription: { include: { plan: true } },
        recorder: {
          include: { employeeProfile: true },
        },
      },
    });

    return items.map((item) =>
      this.mapCheckinDetail(item as unknown as RawCheckinWithRelations),
    );
  }

  async getTodayStats(): Promise<TodayCheckinStats> {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const [total, accepted, rejected] = await Promise.all([
      this.db.client.checkin.count({
        where: { checkedInAt: { gte: startOfDay, lte: endOfDay } },
      }),
      this.db.client.checkin.count({
        where: {
          status: CheckinStatus.ACCEPTED,
          checkedInAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
      this.db.client.checkin.count({
        where: {
          status: CheckinStatus.REJECTED,
          checkedInAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
    ]);

    return { total, accepted, rejected };
  }

  private async createCheckinRecord(data: {
    memberId: string;
    subscriptionId: string | null;
    quotaId: string | null;
    status: CheckinStatus;
    rejectionReason: string;
    recordedBy: string;
  }): Promise<CheckinDetail> {
    const record = await this.db.client.checkin.create({
      data: {
        memberId: data.memberId,
        subscriptionId: data.subscriptionId,
        quotaId: data.quotaId,
        status: data.status,
        rejectionReason: data.rejectionReason,
        checkedInAt: new Date(),
        recordedBy: data.recordedBy,
      },
      include: {
        member: true,
        subscription: { include: { plan: true } },
        recorder: {
          include: {
            employeeProfile: true,
          },
        },
      },
    });

    this.logger.warn(
      `Checkin REJECTED: Member ${data.memberId} - Reason: ${data.rejectionReason}`,
    );

    return this.mapCheckinDetail(record as unknown as RawCheckinWithRelations);
  }

  private mapCheckinDetail(checkin: RawCheckinWithRelations): CheckinDetail {
    return {
      id: checkin.id,
      memberId: checkin.memberId,
      memberCode: checkin.member
        ? `MEM-${checkin.member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
        : '',
      memberFullName: checkin.member?.fullName ?? '',
      memberIdPhotoUrl: checkin.member?.idPhotoUrl ?? null,
      memberGender: checkin.member?.gender ?? null,
      subscriptionId: checkin.subscriptionId,
      planName: checkin.subscription?.plan?.name ?? null,
      quotaId: checkin.quotaId,
      status: checkin.status as CheckinStatus,
      rejectionReason: checkin.rejectionReason,
      checkedInAt: checkin.checkedInAt.toISOString(),
      recordedBy: checkin.recordedBy,
      recordedByName:
        checkin.recorder?.employeeProfile?.fullName ??
        checkin.recorder?.email ??
        null,
    };
  }
}
