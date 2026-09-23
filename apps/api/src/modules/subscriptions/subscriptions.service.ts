import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  PaymentStatus,
  QuotaTransactionType,
  SubscriptionStatus,
  type PaginatedSubscriptionsResponse,
  type SubscriptionDetail,
  type SubscriptionMemberSummary,
  type SubscriptionPaymentSummary,
  type SubscriptionPlanSummary,
  type SubscriptionQuotaSummary,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { resolveEffectiveStatus } from './helpers/subscription-status.helper';
import {
  calculateEndDate,
  normalizeDate,
} from './helpers/subscription-date.helper';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import type { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import type { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';
import type { RenewSubscriptionDto } from './dto/renew-subscription.dto';

interface RawSubscriptionWithRelations {
  id: string;
  memberId: string;
  planId: string;
  previousSubscriptionId: string | null;
  startDate: Date;
  endDate: Date;
  status: SubscriptionStatus | string;
  paymentStatus: PaymentStatus | string;
  agreedPrice: unknown;
  activatedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  member: {
    id: string;
    fullName: string;
    phone: string | null;
    user?: {
      email: string;
      isActive: boolean;
    };
  };
  plan: {
    id: string;
    name: string;
    durationDays: number;
    price: unknown;
  };
  quotas?: Array<{
    id: string;
    allocated: number | null;
    reserved: number;
    used: number;
    serviceType: {
      id: string;
      code: string;
      name: string;
    };
  }>;
  payments?: Array<{
    id: string;
    amount: unknown;
    currency: string;
    status: PaymentStatus | string;
    method: string | null;
    confirmedAt: Date | null;
  }>;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly db: DatabaseService) {}

  private mapSubscriptionDetail(
    sub: RawSubscriptionWithRelations,
    now = new Date(),
  ): SubscriptionDetail {
    const agreedPriceNum =
      typeof sub.agreedPrice === 'number'
        ? sub.agreedPrice
        : Number(sub.agreedPrice?.toString() ?? 0);

    const planPriceNum =
      typeof sub.plan.price === 'number'
        ? sub.plan.price
        : Number(sub.plan.price?.toString() ?? 0);

    const effective = resolveEffectiveStatus(
      {
        status: sub.status as SubscriptionStatus,
        startDate: sub.startDate,
        endDate: sub.endDate,
      },
      now,
    );

    const memberSummary: SubscriptionMemberSummary = {
      id: sub.member.id,
      memberCode: `MEM-${sub.member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      fullName: sub.member.fullName,
      email: sub.member.user?.email,
      phone: sub.member.phone ?? null,
    };

    const planSummary: SubscriptionPlanSummary = {
      id: sub.plan.id,
      name: sub.plan.name,
      durationDays: sub.plan.durationDays,
      price: planPriceNum,
    };

    const quotas: SubscriptionQuotaSummary[] = (sub.quotas || []).map((q) => ({
      id: q.id,
      service: q.serviceType.code,
      serviceName: q.serviceType.name,
      allocated: q.allocated,
      reserved: q.reserved,
      used: q.used,
    }));

    const payments: SubscriptionPaymentSummary[] = (sub.payments || []).map(
      (p) => ({
        id: p.id,
        amount:
          typeof p.amount === 'number'
            ? p.amount
            : Number(p.amount?.toString() ?? 0),
        currency: p.currency,
        status: p.status as PaymentStatus,
        method: p.method ?? null,
        confirmedAt: p.confirmedAt ? p.confirmedAt.toISOString() : null,
      }),
    );

    return {
      id: sub.id,
      memberId: sub.memberId,
      planId: sub.planId,
      previousSubscriptionId: sub.previousSubscriptionId ?? null,
      startDate: sub.startDate.toISOString(),
      endDate: sub.endDate.toISOString(),
      storedStatus: sub.status as SubscriptionStatus,
      effectiveStatus: effective,
      paymentStatus: sub.paymentStatus as PaymentStatus,
      agreedPrice: agreedPriceNum,
      activatedAt: sub.activatedAt ? sub.activatedAt.toISOString() : null,
      cancelledAt: sub.cancelledAt ? sub.cancelledAt.toISOString() : null,
      cancelReason: sub.cancelReason ?? null,
      createdBy: sub.createdBy ?? null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
      member: memberSummary,
      plan: planSummary,
      quotas,
      payments,
    };
  }

  async create(
    dto: CreateSubscriptionDto,
    creatorUserId?: string,
  ): Promise<SubscriptionDetail> {
    // 1. Validate member existence and active account
    const member = await this.db.client.memberProfile.findUnique({
      where: { id: dto.memberId },
      include: { user: true },
    });
    if (!member) {
      throw new NotFoundException(`Member with ID "${dto.memberId}" not found`);
    }
    if (!member.user.isActive) {
      throw new ConflictException(
        'Cannot create subscription for an inactive or disabled member account',
      );
    }

    // 2. Validate membership plan existence and active status
    const plan = await this.db.client.membershipPlan.findUnique({
      where: { id: dto.planId },
      include: {
        entitlements: {
          include: {
            serviceType: true,
          },
        },
      },
    });
    if (!plan) {
      throw new NotFoundException(`Membership plan with ID "${dto.planId}" not found`);
    }
    if (!plan.isActive) {
      throw new ConflictException(
        'Cannot purchase an inactive or discontinued membership plan',
      );
    }

    const now = new Date();
    const paymentStatus = dto.paymentStatus ?? PaymentStatus.PAID;

    // 3. Concurrency-safe atomic transaction
    const createdSub = await this.db.client.$transaction(async (tx) => {
      // Find all active or upcoming non-cancelled subscriptions for this member
      const activeOrUpcomingSubs = await tx.subscription.findMany({
        where: {
          memberId: dto.memberId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.UPCOMING] },
        },
        orderBy: { endDate: 'desc' },
      });

      // Filter out any active records whose end date has already passed
      const currentChainedSubs = activeOrUpcomingSubs.filter(
        (s) => resolveEffectiveStatus(s, now) !== SubscriptionStatus.EXPIRED,
      );

      let startDate: Date;
      let endDate: Date;
      let initialStatus: SubscriptionStatus;
      let activatedAt: Date | null = null;
      let previousSubscriptionId: string | null = null;

      if (currentChainedSubs.length === 0) {
        // Case A: Member currently has no active or queued subscription
        startDate = dto.startDate ? normalizeDate(dto.startDate) : now;
        endDate = calculateEndDate(startDate, plan.durationDays);

        if (paymentStatus === PaymentStatus.PAID && now >= startDate) {
          initialStatus = SubscriptionStatus.ACTIVE;
          activatedAt = now;
        } else {
          initialStatus = SubscriptionStatus.UPCOMING;
          activatedAt = null;
        }
      } else {
        // Case B: Member already has an active/queued subscription -> Queue as UPCOMING
        const latestSub = currentChainedSubs[0]!;
        startDate = new Date(latestSub.endDate);
        endDate = calculateEndDate(startDate, plan.durationDays);
        initialStatus = SubscriptionStatus.UPCOMING;
        activatedAt = null;
        previousSubscriptionId = latestSub.id;
      }

      // Create Subscription
      const sub = await tx.subscription.create({
        data: {
          memberId: dto.memberId,
          planId: dto.planId,
          previousSubscriptionId,
          startDate,
          endDate,
          status: initialStatus,
          paymentStatus,
          agreedPrice: plan.price,
          activatedAt,
          createdBy: creatorUserId ?? null,
        },
      });

      // Create snapshot quotas for entitlements
      if (plan.entitlements && plan.entitlements.length > 0) {
        await tx.subscriptionQuota.createMany({
          data: plan.entitlements.map((e) => ({
            subscriptionId: sub.id,
            serviceTypeId: e.serviceTypeId,
            allocated: e.allocated,
            reserved: 0,
            used: 0,
          })),
        });
      }

      // Create initial payment record
      await tx.paymentRecord.create({
        data: {
          subscriptionId: sub.id,
          amount: plan.price,
          currency: 'VND',
          status: paymentStatus,
          method:
            dto.paymentMethod?.trim() ||
            (paymentStatus === PaymentStatus.PAID ? 'CASH' : null),
          note: dto.note?.trim() || null,
          confirmedBy: creatorUserId ?? null,
          confirmedAt: paymentStatus === PaymentStatus.PAID ? now : null,
        },
      });

      return tx.subscription.findUniqueOrThrow({
        where: { id: sub.id },
        include: {
          member: { include: { user: true } },
          plan: true,
          quotas: { include: { serviceType: true } },
          payments: true,
        },
      });
    });

    this.logger.log(
      `Created subscription ${createdSub.id} for member ${createdSub.memberId} (Status: ${createdSub.status})`,
    );
    return this.mapSubscriptionDetail(
      createdSub as unknown as RawSubscriptionWithRelations,
      now,
    );
  }

  async findAll(
    query: QuerySubscriptionsDto,
  ): Promise<PaginatedSubscriptionsResponse> {
    const {
      page = 1,
      limit = 20,
      search,
      memberId,
      planId,
      status,
      paymentStatus,
      startDateFrom,
      startDateTo,
      endDateFrom,
      endDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    const now = new Date();

    if (memberId) {
      where.memberId = memberId;
    }

    if (planId) {
      where.planId = planId;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    if (status) {
      if (status === SubscriptionStatus.EXPIRED) {
        where.status = SubscriptionStatus.ACTIVE;
        where.endDate = { lt: now };
      } else if (status === SubscriptionStatus.ACTIVE) {
        where.status = SubscriptionStatus.ACTIVE;
        where.endDate = { gte: now };
      } else {
        where.status = status;
      }
    }

    if (startDateFrom || startDateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (startDateFrom) dateFilter.gte = new Date(startDateFrom);
      if (startDateTo) dateFilter.lte = new Date(startDateTo);
      where.startDate = dateFilter;
    }

    if (endDateFrom || endDateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (endDateFrom) dateFilter.gte = new Date(endDateFrom);
      if (endDateTo) dateFilter.lte = new Date(endDateTo);
      where.endDate = dateFilter;
    }

    if (search && search.trim()) {
      const trimmed = search.trim();
      where.OR = [
        {
          member: {
            fullName: { contains: trimmed, mode: 'insensitive' },
          },
        },
        {
          member: {
            user: { email: { contains: trimmed, mode: 'insensitive' } },
          },
        },
        {
          plan: {
            name: { contains: trimmed, mode: 'insensitive' },
          },
        },
      ];
    }

    const [total, subs] = await Promise.all([
      this.db.client.subscription.count({ where }),
      this.db.client.subscription.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          member: { include: { user: true } },
          plan: true,
          quotas: { include: { serviceType: true } },
          payments: true,
        },
      }),
    ]);

    return {
      data: (subs as unknown as RawSubscriptionWithRelations[]).map((s) =>
        this.mapSubscriptionDetail(s, now),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  async findById(id: string): Promise<SubscriptionDetail> {
    const sub = await this.db.client.subscription.findUnique({
      where: { id },
      include: {
        member: { include: { user: true } },
        plan: true,
        quotas: { include: { serviceType: true } },
        payments: true,
      },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    return this.mapSubscriptionDetail(
      sub as unknown as RawSubscriptionWithRelations,
    );
  }

  async findMemberHistory(memberId: string): Promise<SubscriptionDetail[]> {
    const member = await this.db.client.memberProfile.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      throw new NotFoundException(`Member with ID "${memberId}" not found`);
    }

    const subs = await this.db.client.subscription.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      include: {
        member: { include: { user: true } },
        plan: true,
        quotas: { include: { serviceType: true } },
        payments: true,
      },
    });

    const now = new Date();
    return (subs as unknown as RawSubscriptionWithRelations[]).map((s) =>
      this.mapSubscriptionDetail(s, now),
    );
  }

  async findCurrentForMember(memberId: string): Promise<SubscriptionDetail> {
    const member = await this.db.client.memberProfile.findUnique({
      where: { id: memberId },
    });
    if (!member) {
      throw new NotFoundException(`Member with ID "${memberId}" not found`);
    }

    const now = new Date();
    let currentSub = await this.db.client.subscription.findFirst({
      where: {
        memberId,
        status: SubscriptionStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { startDate: 'desc' },
      include: {
        member: { include: { user: true } },
        plan: true,
        quotas: { include: { serviceType: true } },
        payments: true,
      },
    });

    if (!currentSub) {
      // JIT Promotion: Find eligible UPCOMING subscription that has reached its startDate and is PAID
      const eligibleUpcoming = await this.db.client.subscription.findFirst({
        where: {
          memberId,
          status: SubscriptionStatus.UPCOMING,
          paymentStatus: PaymentStatus.PAID,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        orderBy: { startDate: 'asc' },
      });

      if (eligibleUpcoming) {
        currentSub = await this.db.client.subscription.update({
          where: { id: eligibleUpcoming.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            activatedAt: now,
          },
          include: {
            member: { include: { user: true } },
            plan: true,
            quotas: { include: { serviceType: true } },
            payments: true,
          },
        });

        this.logger.log(
          `JIT Activation: Promoted UPCOMING subscription ${currentSub.id} to ACTIVE for member ${memberId}`,
        );
      }
    }

    if (!currentSub) {
      throw new NotFoundException(
        `No active current subscription found for member "${memberId}"`,
      );
    }

    return this.mapSubscriptionDetail(
      currentSub as unknown as RawSubscriptionWithRelations,
      now,
    );
  }

  async findSelfHistory(userId: string): Promise<SubscriptionDetail[]> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Member profile not found for the current authenticated user',
      );
    }

    return this.findMemberHistory(profile.id);
  }

  async findSelfCurrent(userId: string): Promise<SubscriptionDetail> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Member profile not found for the current authenticated user',
      );
    }

    return this.findCurrentForMember(profile.id);
  }

  async activateNow(
    id: string,
    actorId?: string,
  ): Promise<SubscriptionDetail> {
    const sub = await this.db.client.subscription.findUnique({
      where: { id },
      include: {
        member: { include: { user: true } },
        plan: true,
        quotas: { include: { serviceType: true } },
        payments: true,
      },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    if (sub.status !== SubscriptionStatus.UPCOMING) {
      if (sub.status === SubscriptionStatus.ACTIVE) {
        throw new ConflictException('Subscription is already active');
      }
      if (sub.status === SubscriptionStatus.CANCELLED) {
        throw new ConflictException('Cannot activate a cancelled subscription');
      }
      if (sub.status === SubscriptionStatus.SUSPENDED) {
        throw new ConflictException('Cannot activate a suspended subscription');
      }
      throw new ConflictException(
        `Cannot activate subscription in status "${sub.status}"`,
      );
    }

    if (sub.paymentStatus !== PaymentStatus.PAID) {
      throw new ConflictException(
        'Cannot activate subscription before payment is completed (paymentStatus must be PAID)',
      );
    }

    const now = new Date();

    const updated = await this.db.client.$transaction(async (tx) => {
      // Check if member already has an active subscription covering now
      const currentActive = await tx.subscription.findFirst({
        where: {
          memberId: sub.memberId,
          id: { not: id },
          status: SubscriptionStatus.ACTIVE,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      });

      if (currentActive) {
        throw new ConflictException(
          `Member already has an active subscription (${currentActive.id}) ending on ${currentActive.endDate.toISOString().split('T')[0]}. Cannot activate another subscription simultaneously.`,
        );
      }

      const newStartDate = now;
      const newEndDate = calculateEndDate(newStartDate, sub.plan.durationDays);

      const activatedSub = await tx.subscription.update({
        where: { id },
        data: {
          startDate: newStartDate,
          endDate: newEndDate,
          status: SubscriptionStatus.ACTIVE,
          activatedAt: now,
        },
        include: {
          member: { include: { user: true } },
          plan: true,
          quotas: { include: { serviceType: true } },
          payments: true,
        },
      });

      // Shift forward any queued renewal subscriptions directly chained to this subscription
      let currentParentEndDate = newEndDate;
      let chainedChild = await tx.subscription.findFirst({
        where: {
          previousSubscriptionId: id,
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

      return activatedSub;
    });

    this.logger.log(
      `Early Activation: Activated subscription ${id} immediately for member ${sub.memberId} by actor ${actorId ?? 'system'}`,
    );

    return this.mapSubscriptionDetail(
      updated as unknown as RawSubscriptionWithRelations,
      now,
    );
  }

  async cancel(
    id: string,
    dto: CancelSubscriptionDto,
  ): Promise<SubscriptionDetail> {
    const sub = await this.db.client.subscription.findUnique({
      where: { id },
      include: {
        member: { include: { user: true } },
        plan: true,
        quotas: { include: { serviceType: true } },
        payments: true,
      },
    });

    if (!sub) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    if (sub.status === SubscriptionStatus.CANCELLED) {
      throw new ConflictException('Subscription is already cancelled');
    }

    const now = new Date();
    const effective = resolveEffectiveStatus(
      {
        status: sub.status as SubscriptionStatus,
        startDate: sub.startDate,
        endDate: sub.endDate,
      },
      now,
    );

    if (effective === SubscriptionStatus.EXPIRED) {
      throw new ConflictException(
        'Cannot cancel an expired subscription period',
      );
    }

    const updated = await this.db.client.$transaction(async (tx) => {
      // 1. Cancel future Class Bookings and refund quota reserved
      const futureClassBookings = await tx.classBooking.findMany({
        where: {
          subscriptionId: id,
          status: BookingStatus.BOOKED,
          schedule: {
            startsAt: { gte: now },
          },
        },
      });

      for (const booking of futureClassBookings) {
        await tx.classBooking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
          },
        });

        await tx.subscriptionQuota.update({
          where: { id: booking.quotaId },
          data: {
            reserved: { decrement: 1 },
          },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: booking.quotaId,
            subscriptionId: id,
            type: QuotaTransactionType.REFUND,
            reservedDelta: -1,
            idempotencyKey: `cancel-sub-${id}-class-${booking.id}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: booking.id,
            reason: 'Subscription cancelled: Auto-refund future class booking',
          },
        });
      }

      // 2. Cancel future PT Bookings and refund quota reserved
      const futurePtBookings = await tx.ptBooking.findMany({
        where: {
          subscriptionId: id,
          status: BookingStatus.BOOKED,
          startsAt: { gte: now },
        },
      });

      for (const booking of futurePtBookings) {
        await tx.ptBooking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
          },
        });

        await tx.subscriptionQuota.update({
          where: { id: booking.quotaId },
          data: {
            reserved: { decrement: 1 },
          },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: booking.quotaId,
            subscriptionId: id,
            type: QuotaTransactionType.REFUND,
            reservedDelta: -1,
            idempotencyKey: `cancel-sub-${id}-pt-${booking.id}`,
            referenceType: 'PT_BOOKING',
            referenceId: booking.id,
            reason: 'Subscription cancelled: Auto-refund future PT booking',
          },
        });
      }

      // 3. Update subscription status
      return tx.subscription.update({
        where: { id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.reason,
        },
        include: {
          member: { include: { user: true } },
          plan: true,
          quotas: { include: { serviceType: true } },
          payments: true,
        },
      });
    });

    this.logger.log(`Subscription ${id} cancelled. Reason: ${dto.reason}`);
    return this.mapSubscriptionDetail(
      updated as unknown as RawSubscriptionWithRelations,
      now,
    );
  }

  async renew(
    sourceSubscriptionId: string,
    dto: RenewSubscriptionDto,
    creatorUserId?: string,
  ): Promise<SubscriptionDetail> {
    // 1. Validate source subscription existence and active user account
    const sourceSub = await this.db.client.subscription.findUnique({
      where: { id: sourceSubscriptionId },
      include: {
        member: { include: { user: true } },
        plan: true,
        nextSubscription: true,
      },
    });

    if (!sourceSub) {
      throw new NotFoundException(
        `Subscription with ID "${sourceSubscriptionId}" not found`,
      );
    }

    if (!sourceSub.member.user?.isActive) {
      throw new ConflictException(
        'Cannot renew subscription for an inactive or disabled member account',
      );
    }

    if (sourceSub.status === SubscriptionStatus.CANCELLED) {
      throw new ConflictException('Cannot renew a cancelled subscription');
    }

    if (sourceSub.status === SubscriptionStatus.SUSPENDED) {
      throw new ConflictException('Cannot renew a suspended subscription');
    }

    if (sourceSub.status === SubscriptionStatus.UPCOMING) {
      throw new ConflictException('Cannot renew an upcoming subscription');
    }

    if (
      sourceSub.nextSubscription &&
      sourceSub.nextSubscription.status !== SubscriptionStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Subscription has already been renewed or superseded in the chain',
      );
    }

    // 2. Resolve target plan (if planId omitted, reuse sourceSub.planId)
    const targetPlanId = dto.planId ?? sourceSub.planId;
    const targetPlan = await this.db.client.membershipPlan.findUnique({
      where: { id: targetPlanId },
      include: {
        entitlements: {
          include: {
            serviceType: true,
          },
        },
      },
    });

    if (!targetPlan) {
      throw new NotFoundException(
        `Membership plan with ID "${targetPlanId}" not found`,
      );
    }

    if (!targetPlan.isActive) {
      throw new ConflictException(
        'Cannot renew into an inactive or discontinued membership plan',
      );
    }

    const now = new Date();
    const paymentStatus = dto.paymentStatus ?? PaymentStatus.PAID;

    // 3. Concurrency-safe atomic transaction
    try {
      const renewedSub = await this.db.client.$transaction(async (tx) => {
        // If previous renewal was cancelled, unlink its previousSubscriptionId so unique constraint passes
        if (
          sourceSub.nextSubscription &&
          sourceSub.nextSubscription.status === SubscriptionStatus.CANCELLED
        ) {
          await tx.subscription.update({
            where: { id: sourceSub.nextSubscription.id },
            data: { previousSubscriptionId: null },
          });
        }

        // Find all active or upcoming non-cancelled subscriptions for this member
        const activeOrUpcomingSubs = await tx.subscription.findMany({
          where: {
            memberId: sourceSub.memberId,
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.UPCOMING],
            },
          },
          orderBy: { endDate: 'desc' },
        });

        // Check if there is already an UPCOMING subscription queued for this member
        const hasUpcoming = activeOrUpcomingSubs.some(
          (s) => s.status === SubscriptionStatus.UPCOMING,
        );
        if (hasUpcoming) {
          throw new ConflictException(
            'Member already has an upcoming subscription renewal queued',
          );
        }

        // Check if the source subscription is indeed the latest non-cancelled subscription for this member
        if (
          activeOrUpcomingSubs.length > 0 &&
          activeOrUpcomingSubs[0]!.id !== sourceSub.id
        ) {
          throw new ConflictException(
            'Can only renew from the latest subscription in the member chain',
          );
        }

        // Determine startDate, endDate, and initial status
        const effective = resolveEffectiveStatus(
          {
            status: sourceSub.status as SubscriptionStatus,
            startDate: sourceSub.startDate,
            endDate: sourceSub.endDate,
          },
          now,
        );

        let startDate: Date;
        let endDate: Date;
        let initialStatus: SubscriptionStatus;
        let activatedAt: Date | null = null;

        if (effective === SubscriptionStatus.EXPIRED) {
          // Source is expired: renewal starts today
          startDate = now;
          endDate = calculateEndDate(startDate, targetPlan.durationDays);
          if (paymentStatus === PaymentStatus.PAID) {
            initialStatus = SubscriptionStatus.ACTIVE;
            activatedAt = now;
          } else {
            initialStatus = SubscriptionStatus.UPCOMING;
            activatedAt = null;
          }
        } else {
          // Source is still ACTIVE: renewal starts immediately after current period ends
          startDate = new Date(sourceSub.endDate);
          endDate = calculateEndDate(startDate, targetPlan.durationDays);
          initialStatus = SubscriptionStatus.UPCOMING;
          activatedAt = null;
        }

        // Create new renewal subscription row
        const newSub = await tx.subscription.create({
          data: {
            memberId: sourceSub.memberId,
            planId: targetPlan.id,
            previousSubscriptionId: sourceSub.id,
            startDate,
            endDate,
            status: initialStatus,
            paymentStatus,
            agreedPrice: targetPlan.price,
            activatedAt,
            createdBy: creatorUserId ?? null,
          },
        });

        // Create fresh quota snapshot from targetPlan entitlements (no usage carryover!)
        if (targetPlan.entitlements && targetPlan.entitlements.length > 0) {
          await tx.subscriptionQuota.createMany({
            data: targetPlan.entitlements.map((e) => ({
              subscriptionId: newSub.id,
              serviceTypeId: e.serviceTypeId,
              allocated: e.allocated,
              reserved: 0,
              used: 0,
            })),
          });
        }

        // Create new payment record
        await tx.paymentRecord.create({
          data: {
            subscriptionId: newSub.id,
            amount: targetPlan.price,
            currency: 'VND',
            status: paymentStatus,
            method:
              dto.paymentMethod?.trim() ||
              (paymentStatus === PaymentStatus.PAID ? 'CASH' : null),
            note: dto.note?.trim() || 'Subscription renewal',
            confirmedBy: creatorUserId ?? null,
            confirmedAt: paymentStatus === PaymentStatus.PAID ? now : null,
          },
        });

        return tx.subscription.findUniqueOrThrow({
          where: { id: newSub.id },
          include: {
            member: { include: { user: true } },
            plan: true,
            quotas: { include: { serviceType: true } },
            payments: true,
          },
        });
      });

      this.logger.log(
        `Renewed subscription ${sourceSubscriptionId} -> New subscription ${renewedSub.id} for member ${renewedSub.memberId} (Status: ${renewedSub.status})`,
      );
      return this.mapSubscriptionDetail(
        renewedSub as unknown as RawSubscriptionWithRelations,
        now,
      );
    } catch (error: unknown) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      const prismaErr = error as { code?: string };
      if (prismaErr?.code === 'P2002' || prismaErr?.code === 'P2034') {
        throw new ConflictException(
          'Member already has a pending subscription renewal queued or concurrent renewal conflict occurred',
        );
      }
      throw error;
    }
  }
}
