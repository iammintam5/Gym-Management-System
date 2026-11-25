import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.module';
import {
  AuthUser,
  FreezeStatus,
  PaymentStatus,
  PaginatedFreezesResponse,
  SubscriptionFreezeDetail,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';
import { memberCodeRange } from '../common/member-code';
import { Prisma } from '@gym/database';
import { CreateFreezeDto } from './dto/create-freeze.dto';
import { ReviewFreezeDto } from './dto/review-freeze.dto';
import { QueryFreezesDto } from './dto/query-freezes.dto';
import { calculateEndDate } from '../subscriptions/helpers/subscription-date.helper';
import { PtCreditService } from '../pt-packages/pt-credit.service';

interface RawFreezeWithRelations {
  id: string;
  subscriptionId: string;
  startsAt: Date;
  endsAt: Date;
  freezeDays: number;
  status: FreezeStatus;
  reason: string | null;
  approvedBy: string | null;
  restoredAt: Date | null;
  createdAt: Date;
  subscription?: {
    id: string;
    memberId: string;
    startDate: Date;
    endDate: Date;
    status: SubscriptionStatus;
    member?: {
      id: string;
      userId: string;
      fullName: string;
    } | null;
    plan?: {
      name: string;
    } | null;
  } | null;
  approver?: {
    email?: string;
    employeeProfile?: {
      fullName: string;
    } | null;
    memberProfile?: {
      fullName: string;
    } | null;
  } | null;
}

@Injectable()
export class SubscriptionFreezesService {
  private readonly logger = new Logger(SubscriptionFreezesService.name);
  private readonly ptCredits: PtCreditService;

  constructor(
    private readonly db: DatabaseService,
    @Optional() ptCreditService?: PtCreditService,
  ) {
    this.ptCredits = ptCreditService ?? new PtCreditService(this.db);
  }

  private resolveActorId(userId?: string | null): string | null {
    if (!userId || userId === '00000000-0000-0000-0000-000000000000') {
      return null;
    }
    return userId;
  }

  private readonly freezeInclude = {
    subscription: { include: { member: true, plan: true } },
    approver: { include: { employeeProfile: true, memberProfile: true } },
  } as const;

  private async lockSubscription(tx: Prisma.TransactionClient, id: string) {
    const reference = await tx.subscription.findUnique({
      where: { id },
      select: { memberId: true },
    });
    if (!reference) throw new NotFoundException('Gói tập không tồn tại.');
    await this.ptCredits.lockMemberPtDomain(tx, reference.memberId);
    return tx.subscription.findUniqueOrThrow({
      where: { id },
      include: { member: { include: { user: true } }, plan: true },
    });
  }

  private assertFreezable(
    sub: {
      status: string;
      paymentStatus: string;
      startDate: Date;
      endDate: Date;
    },
    startsAt: Date,
    endsAt: Date,
    now: Date,
  ): void {
    if (
      sub.status !== SubscriptionStatus.ACTIVE ||
      sub.paymentStatus !== PaymentStatus.PAID ||
      sub.startDate > now ||
      sub.endDate <= now
    ) {
      throw new BadRequestException(
        'Chỉ bảo lưu gói đang hoạt động và đã thanh toán đủ.',
      );
    }
    const localDay = new Date(now.getTime() + 7 * 3600000)
      .toISOString()
      .slice(0, 10);
    const dayStart = new Date(`${localDay}T00:00:00+07:00`);
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt < dayStart ||
      startsAt >= sub.endDate ||
      endsAt <= startsAt
    ) {
      throw new BadRequestException(
        'Thời gian bảo lưu không hợp lệ hoặc đã qua.',
      );
    }
    const days = (endsAt.getTime() - startsAt.getTime()) / 86400000;
    if (days < 7 || days > 60)
      throw new BadRequestException('Thời gian bảo lưu từ 7 đến 60 ngày.');
  }

  async createFreeze(
    subscriptionId: string,
    dto: CreateFreezeDto,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const now = new Date();
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const staff = user.roles.some(
      (role) => role === UserRole.STAFF || role === UserRole.ADMIN,
    );
    const freeze = await this.db.client.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, subscriptionId);
      if (!staff && sub.member.userId !== user.id)
        throw new ForbiddenException(
          'Bạn không có quyền yêu cầu bảo lưu cho gói tập này.',
        );
      if (!sub.member.user.isActive)
        throw new ConflictException('Tài khoản hội viên đã ngừng hoạt động.');
      this.assertFreezable(sub, startsAt, endsAt, now);
      const pending = await tx.subscriptionFreeze.findFirst({
        where: {
          subscriptionId,
          status: { in: [FreezeStatus.REQUESTED, FreezeStatus.APPROVED] },
          restoredAt: null,
        },
      });
      if (pending)
        throw new ConflictException(
          'Gói tập đã có yêu cầu bảo lưu đang chờ hoặc đã được duyệt.',
        );
      const count = await tx.subscriptionFreeze.count({
        where: {
          subscriptionId,
          status: {
            in: [
              FreezeStatus.REQUESTED,
              FreezeStatus.APPROVED,
              FreezeStatus.COMPLETED,
            ],
          },
        },
      });
      if (count >= 2)
        throw new BadRequestException(
          'Gói tập đã đạt giới hạn tối đa 2 lần bảo lưu.',
        );
      const approved = staff && dto.autoApprove !== false;
      const actorId = this.resolveActorId(user.id);
      const created = await tx.subscriptionFreeze.create({
        data: {
          subscriptionId,
          startsAt,
          endsAt,
          freezeDays: Math.ceil(
            (endsAt.getTime() - startsAt.getTime()) / 86400000,
          ),
          status: approved ? FreezeStatus.APPROVED : FreezeStatus.REQUESTED,
          approvedBy: approved ? actorId : null,
          reason: dto.reason,
        },
      });
      if (approved) {
        if (startsAt <= now) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: { status: SubscriptionStatus.SUSPENDED },
          });
        }
        await this.ptCredits.handleFreezeApprovedInTx(tx, {
          freezeId: created.id,
          subscriptionId,
          memberId: sub.memberId,
          freezeStartsAt: startsAt,
          freezeEndsAt: endsAt,
          freezeReason: dto.reason ?? null,
          actorId,
          now,
        });
      }
      return tx.subscriptionFreeze.findUniqueOrThrow({
        where: { id: created.id },
        include: this.freezeInclude,
      });
    });
    return this.mapFreezeDetail(freeze as unknown as RawFreezeWithRelations);
  }

  async approveFreeze(
    id: string,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const reference = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      select: { subscriptionId: true },
    });
    if (!reference)
      throw new NotFoundException('Yêu cầu bảo lưu không tồn tại.');
    const now = new Date();
    const actorId = this.resolveActorId(user.id);
    const result = await this.db.client.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, reference.subscriptionId);
      const freeze = await tx.subscriptionFreeze.findUniqueOrThrow({
        where: { id },
      });
      if (freeze.status !== FreezeStatus.REQUESTED)
        throw new ConflictException('Chỉ có thể duyệt yêu cầu đang chờ.');
      this.assertFreezable(sub, freeze.startsAt, freeze.endsAt, now);
      if (!sub.member.user.isActive)
        throw new ConflictException('Tài khoản hội viên đã ngừng hoạt động.');
      await tx.subscriptionFreeze.update({
        where: { id },
        data: { status: FreezeStatus.APPROVED, approvedBy: actorId },
      });
      if (freeze.startsAt <= now)
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.SUSPENDED },
        });
      await this.ptCredits.handleFreezeApprovedInTx(tx, {
        freezeId: freeze.id,
        subscriptionId: sub.id,
        memberId: sub.memberId,
        freezeStartsAt: freeze.startsAt,
        freezeEndsAt: freeze.endsAt,
        freezeReason: freeze.reason,
        actorId,
        now,
      });
      return tx.subscriptionFreeze.findUniqueOrThrow({
        where: { id },
        include: this.freezeInclude,
      });
    });
    return this.mapFreezeDetail(result as unknown as RawFreezeWithRelations);
  }

  async rejectFreeze(
    id: string,
    dto: ReviewFreezeDto,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const reference = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      select: { subscriptionId: true },
    });
    if (!reference)
      throw new NotFoundException('Yêu cầu bảo lưu không tồn tại.');
    const result = await this.db.client.$transaction(async (tx) => {
      await this.lockSubscription(tx, reference.subscriptionId);
      const freeze = await tx.subscriptionFreeze.findUniqueOrThrow({
        where: { id },
      });
      if (freeze.status !== FreezeStatus.REQUESTED)
        throw new ConflictException('Chỉ có thể từ chối yêu cầu đang chờ.');
      return tx.subscriptionFreeze.update({
        where: { id },
        data: {
          status: FreezeStatus.REJECTED,
          approvedBy: user.id,
          reason: dto.reason ?? freeze.reason,
        },
        include: this.freezeInclude,
      });
    });
    return this.mapFreezeDetail(result as unknown as RawFreezeWithRelations);
  }

  async unfreeze(
    id: string,
    user: AuthUser,
    targetNow?: Date,
  ): Promise<SubscriptionFreezeDetail> {
    const reference = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      select: { subscriptionId: true },
    });
    if (!reference)
      throw new NotFoundException('Yêu cầu bảo lưu không tồn tại.');
    const now = targetNow ? new Date(targetNow) : new Date();
    const result = await this.db.client.$transaction(
      async (tx) => {
        const sub = await this.lockSubscription(tx, reference.subscriptionId);
        const freeze = await tx.subscriptionFreeze.findUniqueOrThrow({
          where: { id },
        });
        if (freeze.restoredAt || freeze.status === FreezeStatus.COMPLETED)
          throw new ConflictException('Yêu cầu bảo lưu đã được khôi phục.');
        if (
          freeze.status !== FreezeStatus.APPROVED ||
          sub.status === SubscriptionStatus.CANCELLED
        )
          throw new BadRequestException(
            'Yêu cầu bảo lưu hoặc gói tập không còn hợp lệ.',
          );
        const elapsed = Math.max(
          0,
          Math.min(now.getTime(), freeze.endsAt.getTime()) -
            freeze.startsAt.getTime(),
        );
        const newEndDate = new Date(sub.endDate.getTime() + elapsed);
        await tx.subscriptionFreeze.update({
          where: { id },
          data: { status: FreezeStatus.COMPLETED, restoredAt: now },
        });
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.ACTIVE, endDate: newEndDate },
        });
        let parentId = sub.id;
        let parentEnd = newEndDate;
        const visited = new Set<string>([parentId]);
        let child = await tx.subscription.findFirst({
          where: {
            previousSubscriptionId: parentId,
            status: SubscriptionStatus.UPCOMING,
          },
          include: { plan: true },
        });
        while (child) {
          if (visited.has(child.id))
            throw new ConflictException('Chuỗi gia hạn không hợp lệ.');
          visited.add(child.id);
          const endDate = calculateEndDate(parentEnd, child.plan.durationDays);
          await tx.subscription.update({
            where: { id: child.id },
            data: { startDate: parentEnd, endDate },
          });
          parentId = child.id;
          parentEnd = endDate;
          child = await tx.subscription.findFirst({
            where: {
              previousSubscriptionId: parentId,
              status: SubscriptionStatus.UPCOMING,
            },
            include: { plan: true },
          });
        }
        await this.ptCredits.handleFreezeRestoredInTx(tx, {
          freezeId: freeze.id,
          subscriptionId: sub.id,
          memberId: sub.memberId,
          actorId: this.resolveActorId(user.id),
          now,
        });
        return tx.subscriptionFreeze.findUniqueOrThrow({
          where: { id },
          include: this.freezeInclude,
        });
        // Remote database round trips and renewal-chain updates need a bounded budget above Prisma's 5s default.
      },
      { timeout: 15000 },
    );
    this.logger.log(`Restored freeze ${id} by ${user.id}`);
    return this.mapFreezeDetail(result as unknown as RawFreezeWithRelations);
  }

  async activateDueFreezes(targetNow?: Date): Promise<number> {
    const now = targetNow ? new Date(targetNow) : new Date();
    const due = await this.db.client.subscriptionFreeze.findMany({
      where: {
        status: FreezeStatus.APPROVED,
        restoredAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          paymentStatus: PaymentStatus.PAID,
        },
      },
      select: { id: true, subscriptionId: true },
    });
    let activated = 0;
    for (const item of due) {
      await this.db.client.$transaction(async (tx) => {
        const sub = await this.lockSubscription(tx, item.subscriptionId);
        const freeze = await tx.subscriptionFreeze.findUniqueOrThrow({
          where: { id: item.id },
        });
        if (
          sub.status === SubscriptionStatus.ACTIVE &&
          sub.paymentStatus === PaymentStatus.PAID &&
          freeze.status === FreezeStatus.APPROVED &&
          !freeze.restoredAt &&
          freeze.startsAt <= now &&
          freeze.endsAt > now
        ) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: SubscriptionStatus.SUSPENDED },
          });
          await this.ptCredits.handleFreezeApprovedInTx(tx, {
            freezeId: freeze.id,
            subscriptionId: sub.id,
            memberId: sub.memberId,
            freezeStartsAt: freeze.startsAt,
            freezeEndsAt: freeze.endsAt,
            freezeReason: freeze.reason,
            actorId: null,
            now,
          });
          activated++;
        }
      });
    }
    return activated;
  }

  async findBySubscription(
    subscriptionId: string,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail[]> {
    const subscription = await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
      include: { member: true },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    const isStaffOrAdmin = user.roles.some(
      (r) => r === UserRole.STAFF || r === UserRole.ADMIN,
    );

    if (!isStaffOrAdmin && subscription.member.userId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền xem thông tin bảo lưu của gói tập này',
      );
    }

    const freezes = await this.db.client.subscriptionFreeze.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
        approver: {
          include: {
            employeeProfile: true,
            memberProfile: true,
          },
        },
      },
    });

    return (freezes as unknown as RawFreezeWithRelations[]).map((f) =>
      this.mapFreezeDetail(f),
    );
  }

  async findAll(
    query: QueryFreezesDto,
    _user: AuthUser,
  ): Promise<PaginatedFreezesResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.SubscriptionFreezeWhereInput = {};

    const now = new Date();
    if (query.phase === 'Pending Review') where.status = FreezeStatus.REQUESTED;
    if (query.phase === 'Rejected') where.status = FreezeStatus.REJECTED;
    if (query.phase === 'Restored Early') where.status = FreezeStatus.COMPLETED;
    if (query.phase === 'Scheduled' || query.phase === 'Currently Frozen') {
      where.status = FreezeStatus.APPROVED;
      where.restoredAt = null;
      where.startsAt = query.phase === 'Scheduled' ? { gt: now } : { lte: now };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        {
          subscription: {
            member: { fullName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          subscription: {
            plan: { name: { contains: search, mode: 'insensitive' } },
          },
        },
        { reason: { contains: search, mode: 'insensitive' } },
        ...(memberCodeRange(search)
          ? [{ subscription: { memberId: memberCodeRange(search) } }]
          : []),
      ];
    }
    if (query.status) {
      where.status = query.status;
    }

    if (query.subscriptionId) {
      where.subscriptionId = query.subscriptionId;
    }

    if (query.memberId) {
      where.subscription = { memberId: query.memberId };
    }

    const [total, records] = await Promise.all([
      this.db.client.subscriptionFreeze.count({ where }),
      this.db.client.subscriptionFreeze.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            include: {
              member: {
                select: {
                  id: true,
                  userId: true,
                  fullName: true,
                },
              },
              plan: {
                select: {
                  name: true,
                },
              },
            },
          },
          approver: {
            select: {
              email: true,
              employeeProfile: { select: { fullName: true } },
              memberProfile: { select: { fullName: true } },
            },
          },
        },
      }),
    ]);

    return {
      data: (records as unknown as RawFreezeWithRelations[]).map((r) =>
        this.mapFreezeDetail(r),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async statistics() {
    const now = new Date();
    const [pending, frozen, restored] = await Promise.all([
      this.db.client.subscriptionFreeze.count({
        where: { status: FreezeStatus.REQUESTED },
      }),
      this.db.client.subscriptionFreeze.count({
        where: {
          status: FreezeStatus.APPROVED,
          restoredAt: null,
          startsAt: { lte: now },
        },
      }),
      this.db.client.subscriptionFreeze.count({
        where: { status: FreezeStatus.COMPLETED },
      }),
    ]);
    return { pending, frozen, restored };
  }

  async findById(
    id: string,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const freeze = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
        approver: {
          include: {
            employeeProfile: true,
            memberProfile: true,
          },
        },
      },
    });

    if (!freeze) {
      throw new NotFoundException(`Freeze request ${id} not found`);
    }

    const isStaffOrAdmin = user.roles.some(
      (r) => r === UserRole.STAFF || r === UserRole.ADMIN,
    );

    if (!isStaffOrAdmin && freeze.subscription?.member?.userId !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền xem yêu cầu bảo lưu này',
      );
    }

    return this.mapFreezeDetail(freeze as unknown as RawFreezeWithRelations);
  }

  private mapFreezeDetail(
    raw: RawFreezeWithRelations,
  ): SubscriptionFreezeDetail {
    const approverName =
      raw.approver?.employeeProfile?.fullName ??
      raw.approver?.memberProfile?.fullName ??
      raw.approver?.email ??
      null;

    let subSummary: SubscriptionFreezeDetail['subscription'] = undefined;
    if (raw.subscription) {
      const memberCode = raw.subscription.memberId
        ? `MEM-${raw.subscription.memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
        : '';

      subSummary = {
        id: raw.subscription.id,
        memberId: raw.subscription.memberId,
        memberName: raw.subscription.member?.fullName ?? '',
        memberCode,
        planName: raw.subscription.plan?.name ?? '',
        startDate: raw.subscription.startDate.toISOString(),
        endDate: raw.subscription.endDate.toISOString(),
        status: raw.subscription.status,
      };
    }

    return {
      id: raw.id,
      subscriptionId: raw.subscriptionId,
      startsAt: raw.startsAt.toISOString(),
      endsAt: raw.endsAt.toISOString(),
      freezeDays: raw.freezeDays,
      status: raw.status,
      reason: raw.reason,
      approvedBy: raw.approvedBy,
      approverName,
      restoredAt: raw.restoredAt ? raw.restoredAt.toISOString() : null,
      createdAt: raw.createdAt.toISOString(),
      subscription: subSummary,
    };
  }
}
