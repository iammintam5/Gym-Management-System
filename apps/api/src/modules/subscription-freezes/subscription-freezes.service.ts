import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.module';
import {
  AuthUser,
  FreezeStatus,
  PaginatedFreezesResponse,
  SubscriptionFreezeDetail,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';
import { Prisma } from '@gym/database';
import { CreateFreezeDto } from './dto/create-freeze.dto';
import { ReviewFreezeDto } from './dto/review-freeze.dto';
import { QueryFreezesDto } from './dto/query-freezes.dto';
import { calculateEndDate } from '../subscriptions/helpers/subscription-date.helper';

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

  constructor(private readonly db: DatabaseService) {}

  async createFreeze(
    subscriptionId: string,
    dto: CreateFreezeDto,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const subscription = await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        member: { include: { user: true } },
        plan: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    const isStaffOrAdmin = user.roles.some(
      (r) => r === UserRole.STAFF || r === UserRole.ADMIN,
    );

    // If Member, verify ownership
    if (!isStaffOrAdmin) {
      if (subscription.member.userId !== user.id) {
        throw new ForbiddenException(
          'Bạn không có quyền yêu cầu bảo lưu cho gói tập này',
        );
      }
    }

    const now = new Date();

    // Invariant: Cannot freeze cancelled or expired subscriptions
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Không thể bảo lưu gói tập đã bị huỷ');
    }

    if (new Date(subscription.endDate).getTime() < now.getTime()) {
      throw new BadRequestException('Không thể bảo lưu gói tập đã hết hạn');
    }

    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      throw new ConflictException('Gói tập hiện đang trong trạng thái bảo lưu');
    }

    // Parse and validate date ranges
    const startDate = new Date(dto.startsAt);
    const endDate = new Date(dto.endsAt);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Ngày bắt đầu hoặc ngày kết thúc không hợp lệ');
    }

    const diffTime = endDate.getTime() - startDate.getTime();
    if (diffTime <= 0) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }

    const freezeDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    // Gym policy: Minimum 7 days, maximum 60 days
    if (freezeDays < 7) {
      throw new BadRequestException('Thời gian bảo lưu tối thiểu là 7 ngày');
    }

    if (freezeDays > 60) {
      throw new BadRequestException('Thời gian bảo lưu tối đa là 60 ngày');
    }

    // Invariant: Check if there is already an active or pending freeze
    const activeOrPendingFreeze =
      await this.db.client.subscriptionFreeze.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: { in: [FreezeStatus.REQUESTED, FreezeStatus.APPROVED] },
          restoredAt: null,
        },
      });

    if (activeOrPendingFreeze) {
      throw new ConflictException(
        'Gói tập đã có yêu cầu bảo lưu đang chờ duyệt hoặc đang có hiệu lực',
      );
    }

    // Gym policy: Maximum 2 freezes per subscription
    const freezeCount = await this.db.client.subscriptionFreeze.count({
      where: {
        subscriptionId: subscription.id,
        status: {
          in: [
            FreezeStatus.REQUESTED,
            FreezeStatus.APPROVED,
            FreezeStatus.COMPLETED,
          ],
        },
      },
    });

    if (freezeCount >= 2) {
      throw new BadRequestException('Gói tập đã đạt giới hạn tối đa 2 lần bảo lưu');
    }

    // Determine initial status & approver
    let initialStatus: FreezeStatus = FreezeStatus.REQUESTED;
    let approvedBy: string | null = null;

    if (isStaffOrAdmin) {
      const autoApprove = dto.autoApprove !== false;
      if (autoApprove) {
        initialStatus = FreezeStatus.APPROVED;
        approvedBy = user.id;
      }
    }

    const freeze = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const created = await tx.subscriptionFreeze.create({
        data: {
          subscriptionId: subscription.id,
          startsAt: startDate,
          endsAt: endDate,
          freezeDays,
          status: initialStatus,
          reason: dto.reason,
          approvedBy,
        },
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

      // If approved immediately and startsAt has arrived, mark subscription SUSPENDED
      if (
        initialStatus === FreezeStatus.APPROVED &&
        startDate.getTime() <= now.getTime()
      ) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.SUSPENDED },
        });
      }

      return created;
    });

    this.logger.log(
      `Created freeze request ${freeze.id} for sub ${subscriptionId} with status ${initialStatus} by ${user.id}`,
    );

    return this.mapFreezeDetail(freeze as unknown as RawFreezeWithRelations);
  }

  async approveFreeze(
    id: string,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const freeze = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      include: { subscription: true },
    });

    if (!freeze) {
      throw new NotFoundException(`Freeze request ${id} not found`);
    }

    if (freeze.status !== FreezeStatus.REQUESTED) {
      throw new ConflictException(
        'Chỉ có thể phê duyệt yêu cầu bảo lưu ở trạng thái REQUESTED',
      );
    }

    const now = new Date();

    const result = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updated = await tx.subscriptionFreeze.update({
        where: { id },
        data: {
          status: FreezeStatus.APPROVED,
          approvedBy: user.id,
        },
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

      // If startsAt has arrived, mark subscription as SUSPENDED
      if (freeze.startsAt.getTime() <= now.getTime()) {
        await tx.subscription.update({
          where: { id: freeze.subscriptionId },
          data: { status: SubscriptionStatus.SUSPENDED },
        });
      }

      return updated;
    });

    this.logger.log(`Approved freeze request ${id} by ${user.id}`);
    return this.mapFreezeDetail(result as unknown as RawFreezeWithRelations);
  }

  async rejectFreeze(
    id: string,
    dto: ReviewFreezeDto,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const freeze = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
    });

    if (!freeze) {
      throw new NotFoundException(`Freeze request ${id} not found`);
    }

    if (freeze.status !== FreezeStatus.REQUESTED) {
      throw new ConflictException(
        'Chỉ có thể từ chối yêu cầu bảo lưu ở trạng thái REQUESTED',
      );
    }

    const updated = await this.db.client.subscriptionFreeze.update({
      where: { id },
      data: {
        status: FreezeStatus.REJECTED,
        approvedBy: user.id,
        reason: dto.reason ?? freeze.reason,
      },
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

    this.logger.log(`Rejected freeze request ${id} by ${user.id}`);
    return this.mapFreezeDetail(updated as unknown as RawFreezeWithRelations);
  }

  async unfreeze(
    id: string,
    user: AuthUser,
  ): Promise<SubscriptionFreezeDetail> {
    const freeze = await this.db.client.subscriptionFreeze.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            plan: true,
            member: true,
          },
        },
      },
    });

    if (!freeze) {
      throw new NotFoundException(`Freeze request ${id} not found`);
    }

    // Idempotency guard: prevent double extension
    if (
      freeze.restoredAt !== null ||
      freeze.status === FreezeStatus.COMPLETED
    ) {
      throw new ConflictException('Yêu cầu bảo lưu đã được khôi phục trước đó');
    }

    if (freeze.status !== FreezeStatus.APPROVED) {
      throw new BadRequestException(
        'Chỉ có thể mở lại gói tập từ trạng thái bảo lưu đã được phê duyệt',
      );
    }

    const now = new Date();
    const daysToExtend = freeze.freezeDays;
    const oldEndDate = new Date(freeze.subscription.endDate);
    const newEndDate = new Date(
      oldEndDate.getTime() + daysToExtend * 24 * 60 * 60 * 1000,
    );

    const result = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Mark freeze COMPLETED & set restoredAt
      const updatedFreeze = await tx.subscriptionFreeze.update({
        where: { id },
        data: {
          status: FreezeStatus.COMPLETED,
          restoredAt: now,
        },
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

      // 2. Restore subscription status to ACTIVE and extend endDate
      await tx.subscription.update({
        where: { id: freeze.subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          endDate: newEndDate,
        },
      });

      // 3. Cascade forward any queued UPCOMING renewal subscriptions chained to this sub
      let currentParentEndDate = newEndDate;
      let chainedChild = await tx.subscription.findFirst({
        where: {
          previousSubscriptionId: freeze.subscriptionId,
          status: SubscriptionStatus.UPCOMING,
        },
        include: { plan: true },
      });

      while (chainedChild) {
        const childStart = new Date(currentParentEndDate);
        const childEnd = calculateEndDate(
          childStart,
          chainedChild.plan.durationDays,
        );
        await tx.subscription.update({
          where: { id: chainedChild.id },
          data: { startDate: childStart, endDate: childEnd },
        });
        currentParentEndDate = childEnd;
        chainedChild = await tx.subscription.findFirst({
          where: {
            previousSubscriptionId: chainedChild.id,
            status: SubscriptionStatus.UPCOMING,
          },
          include: { plan: true },
        });
      }

      return updatedFreeze;
    });

    this.logger.log(
      `Unfroze sub ${freeze.subscriptionId}, extended by ${daysToExtend} days (new endDate: ${newEndDate.toISOString()}) by ${user.id}`,
    );

    return this.mapFreezeDetail(result as unknown as RawFreezeWithRelations);
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

    if (
      !isStaffOrAdmin &&
      freeze.subscription?.member?.userId !== user.id
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem yêu cầu bảo lưu này',
      );
    }

    return this.mapFreezeDetail(freeze as unknown as RawFreezeWithRelations);
  }

  private mapFreezeDetail(raw: RawFreezeWithRelations): SubscriptionFreezeDetail {
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
