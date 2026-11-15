import {
  BadRequestException,
  ConflictException,
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
  requestId?: string | null;
  gateIdentifier?: string | null;
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

    return this.db.client.$transaction(
      async (tx) => {
        let memberId = dto.memberId;
        if (!memberId && dto.memberCode) {
          const code = dto.memberCode.trim().toUpperCase();
          const members = await tx.memberProfile.findMany({
            select: { id: true },
          });
          memberId = members.find(
            (member) =>
              `MEM-${member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}` ===
                code || member.id.toUpperCase() === code,
          )?.id;
        }
        if (!memberId) throw new NotFoundException('Không tìm thấy hội viên.');
        // Serialize retries before locking the member, including calls from different devices.
        if (dto.idempotencyKey) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin:${dto.idempotencyKey}`}, 0))::text`;
        }
        await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${memberId}::uuid FOR UPDATE`;
        const member = await tx.memberProfile.findUnique({
          where: { id: memberId },
          include: { user: true },
        });
        if (!member) throw new NotFoundException('Không tìm thấy hội viên.');
        const include = {
          member: true,
          subscription: { include: { plan: true } },
          recorder: { include: { employeeProfile: true } },
        } as const;
        if (dto.idempotencyKey) {
          const previous = await tx.checkin.findUnique({
            where: { requestId: dto.idempotencyKey },
            include,
          });
          if (previous) {
            if (
              previous.memberId !== member.id ||
              previous.recordedBy !== actorId ||
              previous.gateIdentifier !== (dto.gateIdentifier ?? null)
            )
              throw new ConflictException(
                'Mã yêu cầu đã được dùng cho một lượt khác.',
              );
            return this.mapCheckinDetail(
              previous as unknown as RawCheckinWithRelations,
            );
          }
        }
        if (dto.photoVersion && member.facePhotoVersion !== dto.photoVersion)
          throw new ConflictException(
            'Ảnh hồ sơ đã thay đổi. Vui lòng cập nhật nhận diện.',
          );
        const now = new Date();
        const save = async (
          status: CheckinStatus,
          reason: string | null,
          subscriptionId: string | null = null,
          quotaId: string | null = null,
        ) => {
          const record = await tx.checkin.create({
            data: {
              requestId: dto.idempotencyKey ?? null,
              gateIdentifier: dto.gateIdentifier ?? null,
              memberId: member.id,
              subscriptionId,
              quotaId,
              status,
              rejectionReason: reason,
              checkedInAt: now,
              recordedBy: actorId,
            },
            include,
          });
          return this.mapCheckinDetail(
            record as unknown as RawCheckinWithRelations,
          );
        };
        // 1. Validate the member account inside the transaction.
        if (!member.user.isActive)
          return save(
            CheckinStatus.REJECTED,
            'Tài khoản hội viên đã bị vô hiệu hoá.',
          );
        // 2. Preserve the existing one-minute anti-passback policy; member locking closes the race.
        const recent = await tx.checkin.findFirst({
          where: {
            memberId: member.id,
            status: CheckinStatus.ACCEPTED,
            checkedInAt: { gte: new Date(now.getTime() - 60000) },
          },
          orderBy: { checkedInAt: 'desc' },
        });
        if (recent)
          return save(
            CheckinStatus.REJECTED,
            'Hội viên vừa được ghi nhận trong vòng một phút.',
            recent.subscriptionId,
            recent.quotaId,
          );
        // 3. Find ACTIVE membership or JIT-promote a PAID UPCOMING membership.
        const subInclude = {
          plan: true,
          quotas: { include: { serviceType: true } },
        } as const;
        let sub = await tx.subscription.findFirst({
          where: {
            memberId: member.id,
            status: SubscriptionStatus.ACTIVE,
            startDate: { lte: now },
            endDate: { gte: now },
          },
          orderBy: { startDate: 'desc' },
          include: subInclude,
        });
        if (!sub)
          sub = await tx.subscription.findFirst({
            where: {
              memberId: member.id,
              status: SubscriptionStatus.UPCOMING,
              paymentStatus: PaymentStatus.PAID,
              startDate: { lte: now },
              endDate: { gte: now },
            },
            orderBy: { startDate: 'asc' },
            include: subInclude,
          });
        if (!sub) {
          const suspended = await tx.subscription.findFirst({
            where: {
              memberId: member.id,
              status: SubscriptionStatus.SUSPENDED,
              startDate: { lte: now },
              endDate: { gte: now },
            },
          });
          return save(
            CheckinStatus.REJECTED,
            suspended
              ? 'Gói tập đang bảo lưu.'
              : 'Không có gói tập còn hiệu lực.',
            suspended?.id ?? null,
          );
        }
        // Refunds and changes to this subscription serialize with this access decision.
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`;
        sub = await tx.subscription.findUnique({
          where: { id: sub.id },
          include: subInclude,
        });
        if (
          !sub ||
          sub.paymentStatus !== PaymentStatus.PAID ||
          sub.startDate > now ||
          sub.endDate < now ||
          (sub.status !== SubscriptionStatus.ACTIVE &&
            sub.status !== SubscriptionStatus.UPCOMING)
        )
          return save(
            CheckinStatus.REJECTED,
            'Gói tập chưa thanh toán đầy đủ hoặc không còn hiệu lực.',
            sub?.id ?? null,
          );
        const activeFreeze = await tx.subscriptionFreeze.findFirst({
          where: {
            subscriptionId: sub.id,
            status: 'APPROVED',
            restoredAt: null,
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
        });
        if (activeFreeze)
          return save(CheckinStatus.REJECTED, 'Gói tập đang bảo lưu.', sub.id);
        if (sub.status === SubscriptionStatus.UPCOMING)
          sub = await tx.subscription.update({
            where: { id: sub.id },
            data: { status: SubscriptionStatus.ACTIVE, activatedAt: now },
            include: subInclude,
          });
        // 4. Validate entitlement; atomically consume only available (not reserved) quota.
        const quota = sub.quotas.find(
          (item) => item.serviceType.code === ServiceTypeCode.GYM_ACCESS,
        );
        if (!quota)
          return save(
            CheckinStatus.REJECTED,
            'Gói tập không có quyền vào phòng Gym.',
            sub.id,
          );
        if (quota.allocated !== null) {
          const changed =
            await tx.$executeRaw`UPDATE subscription_quotas SET used = used + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${quota.id}::uuid AND (allocated IS NULL OR used + reserved < allocated)`;
          if (changed !== 1)
            return save(
              CheckinStatus.REJECTED,
              'Gói tập đã hết lượt khả dụng.',
              sub.id,
              quota.id,
            );
        }
        // 5. Record ACCEPTED access and its quota ledger in the same transaction.
        const checkin = await save(
          CheckinStatus.ACCEPTED,
          null,
          sub.id,
          quota.id,
        );
        if (quota.allocated !== null)
          await tx.quotaTransaction.create({
            data: {
              quotaId: quota.id,
              subscriptionId: sub.id,
              type: QuotaTransactionType.USE,
              allocatedDelta: 0,
              reservedDelta: 0,
              usedDelta: 1,
              idempotencyKey: `checkin-${checkin.id}`,
              referenceType: 'CHECKIN',
              referenceId: checkin.id,
              reason: 'Điểm danh vào cổng phòng Gym',
              createdBy: actorId,
            },
          });
        return checkin;
      },
      { maxWait: 10000, timeout: 20000 },
    );
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
          member: {
            select: {
              id: true,
              fullName: true,
              gender: true,
            },
          },
          subscription: {
            select: {
              id: true,
              plan: { select: { name: true } },
            },
          },
          recorder: {
            select: {
              email: true,
              employeeProfile: { select: { fullName: true } },
            },
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
      select: { id: true },
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
        member: {
          select: {
            id: true,
            fullName: true,
            gender: true,
          },
        },
        subscription: {
          select: {
            id: true,
            plan: { select: { name: true } },
          },
        },
        recorder: {
          select: {
            email: true,
            employeeProfile: { select: { fullName: true } },
          },
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

    const grouped = await this.db.client.checkin.groupBy({
      by: ['status'],
      where: { checkedInAt: { gte: startOfDay, lte: endOfDay } },
      _count: { _all: true },
    });

    let accepted = 0;
    let rejected = 0;
    for (const row of grouped) {
      if (row.status === CheckinStatus.ACCEPTED) {
        accepted += row._count._all;
      } else if (row.status === CheckinStatus.REJECTED) {
        rejected += row._count._all;
      }
    }

    return { total: accepted + rejected, accepted, rejected };
  }

  private mapCheckinDetail(checkin: RawCheckinWithRelations): CheckinDetail {
    return {
      id: checkin.id,
      requestId: checkin.requestId ?? null,
      stationId: checkin.gateIdentifier ?? null,
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
