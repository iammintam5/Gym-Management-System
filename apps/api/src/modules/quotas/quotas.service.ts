import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  QuotaTransactionType,
  SubscriptionStatus,
  type PaginatedQuotaTransactionsResponse,
  type QuotaTransactionDetail,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { resolveEffectiveStatus } from '../subscriptions/helpers/subscription-status.helper';
import type { AdjustQuotaDto } from './dto/adjust-quota.dto';
import type { QueryQuotaTransactionsDto } from './dto/query-quota-transactions.dto';
import type {
  CanUseResult,
  QuotaOperationContext,
} from './types/quota-operation.types';

type RawQuotaWithRelations = {
  id: string;
  subscriptionId: string;
  serviceTypeId: string;
  allocated: number | null;
  reserved: number;
  used: number;
  updatedAt: Date;
  serviceType: {
    id: string;
    code: string;
    name: string;
  };
};

type RawTransactionWithRelations = {
  id: string;
  quotaId: string;
  subscriptionId: string;
  type: string;
  allocatedDelta: number;
  reservedDelta: number;
  usedDelta: number;
  idempotencyKey: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: Date;
};

@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);

  constructor(private readonly db: DatabaseService) {}

  private mapQuotaDetail(quota: RawQuotaWithRelations): SubscriptionQuotaDetail {
    const isUnlimited = quota.allocated === null;
    const remaining = isUnlimited
      ? null
      : Math.max(0, quota.allocated! - quota.used - quota.reserved);

    return {
      id: quota.id,
      subscriptionId: quota.subscriptionId,
      service: quota.serviceType.code,
      serviceName: quota.serviceType.name,
      unlimited: isUnlimited,
      allocated: quota.allocated,
      reserved: quota.reserved,
      used: quota.used,
      remaining,
      updatedAt: quota.updatedAt.toISOString(),
    };
  }

  private mapTransactionDetail(
    tx: RawTransactionWithRelations,
  ): QuotaTransactionDetail {
    return {
      id: tx.id,
      quotaId: tx.quotaId,
      subscriptionId: tx.subscriptionId,
      type: tx.type as QuotaTransactionType,
      allocatedDelta: tx.allocatedDelta,
      reservedDelta: tx.reservedDelta,
      usedDelta: tx.usedDelta,
      idempotencyKey: tx.idempotencyKey,
      referenceType: tx.referenceType,
      referenceId: tx.referenceId,
      reason: tx.reason,
      createdBy: tx.createdBy,
      createdAt: tx.createdAt.toISOString(),
    };
  }

  async getQuota(
    subscriptionId: string,
    serviceTypeCode: string,
  ): Promise<SubscriptionQuotaDetail> {
    const quota = await this.db.client.subscriptionQuota.findFirst({
      where: {
        subscriptionId,
        serviceType: { code: serviceTypeCode },
      },
      include: { serviceType: true },
    });

    if (!quota) {
      throw new NotFoundException(
        `Quota for service "${serviceTypeCode}" not found on subscription "${subscriptionId}"`,
      );
    }

    return this.mapQuotaDetail(quota as unknown as RawQuotaWithRelations);
  }

  async getSubscriptionQuotas(
    subscriptionId: string,
  ): Promise<SubscriptionQuotaDetail[]> {
    const sub = await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!sub) {
      throw new NotFoundException(
        `Subscription with ID "${subscriptionId}" not found`,
      );
    }

    const quotas = await this.db.client.subscriptionQuota.findMany({
      where: { subscriptionId },
      include: { serviceType: true },
      orderBy: { serviceType: { code: 'asc' } },
    });

    return quotas.map((q) =>
      this.mapQuotaDetail(q as unknown as RawQuotaWithRelations),
    );
  }

  async getSelfCurrentQuotas(
    userId: string,
  ): Promise<SubscriptionQuotaDetail[]> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException(
        'Member profile not found for the current authenticated user',
      );
    }

    const now = new Date();
    const currentSub = await this.db.client.subscription.findFirst({
      where: {
        memberId: profile.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { startDate: 'desc' },
      include: {
        quotas: {
          include: { serviceType: true },
          orderBy: { serviceType: { code: 'asc' } },
        },
      },
    });

    if (!currentSub) {
      throw new NotFoundException(
        'No active current subscription found for the member',
      );
    }

    return currentSub.quotas.map((q) =>
      this.mapQuotaDetail(q as unknown as RawQuotaWithRelations),
    );
  }

  async canUse(
    subscriptionId: string,
    serviceTypeCode: string,
    amount: number = 1,
  ): Promise<CanUseResult> {
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return {
        allowed: false,
        reason: 'INVALID_QUOTA_AMOUNT',
        remaining: 0,
        unlimited: false,
      };
    }

    const sub = await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        quotas: {
          include: { serviceType: true },
        },
      },
    });

    if (!sub) {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_NOT_FOUND',
        remaining: 0,
        unlimited: false,
      };
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

    if (effective !== SubscriptionStatus.ACTIVE || now < new Date(sub.startDate)) {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_NOT_ACTIVE',
        remaining: 0,
        unlimited: false,
      };
    }

    const quota = sub.quotas.find((q) => q.serviceType.code === serviceTypeCode);
    if (!quota) {
      return {
        allowed: false,
        reason: 'SERVICE_NOT_ENTITLED',
        remaining: 0,
        unlimited: false,
      };
    }

    if (quota.allocated === null) {
      return {
        allowed: true,
        remaining: null,
        unlimited: true,
      };
    }

    const remaining = Math.max(0, quota.allocated - quota.used - quota.reserved);
    if (remaining >= amount) {
      return {
        allowed: true,
        remaining,
        unlimited: false,
      };
    }

    return {
      allowed: false,
      reason: 'INSUFFICIENT_QUOTA',
      remaining,
      unlimited: false,
    };
  }

  async reserve(
    subscriptionId: string,
    serviceTypeCode: string,
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Reservation amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();
    const now = new Date();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        // 1. Check idempotency
        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            quota: { include: { serviceType: true } },
          },
        });
        if (existingTx) {
          return existingTx.quota;
        }

        // 2. Validate subscription
        const sub = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          include: {
            quotas: {
              include: { serviceType: true },
            },
          },
        });

        if (!sub) {
          throw new NotFoundException(
            `Subscription with ID "${subscriptionId}" not found`,
          );
        }

        const effective = resolveEffectiveStatus(
          {
            status: sub.status as SubscriptionStatus,
            startDate: sub.startDate,
            endDate: sub.endDate,
          },
          now,
        );

        if (effective !== SubscriptionStatus.ACTIVE || now < new Date(sub.startDate)) {
          throw new ConflictException(
            `Cannot reserve quota on subscription with effective status "${effective}"`,
          );
        }

        // 3. Find service quota
        const quota = sub.quotas.find(
          (q) => q.serviceType.code === serviceTypeCode,
        );
        if (!quota) {
          throw new ConflictException(
            `Service "${serviceTypeCode}" is not entitled in this subscription`,
          );
        }

        // 4. Check available quota
        if (quota.allocated !== null) {
          const remaining = quota.allocated - quota.used - quota.reserved;
          if (remaining < amount) {
            throw new ConflictException(
              `Insufficient quota remaining to reserve (Available: ${Math.max(0, remaining)}, Requested: ${amount})`,
            );
          }

          // Atomic increment reserved
          await tx.subscriptionQuota.update({
            where: { id: quota.id },
            data: {
              reserved: { increment: amount },
            },
          });
        }

        // 5. Append-only ledger transaction
        await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId: sub.id,
            type: QuotaTransactionType.RESERVE,
            allocatedDelta: 0,
            reservedDelta: quota.allocated === null ? 0 : amount,
            usedDelta: 0,
            idempotencyKey,
            referenceType: ctx.referenceType ?? null,
            referenceId: ctx.referenceId ?? null,
            reason: ctx.reason ?? 'Class/PT Booking reservation',
            createdBy: ctx.actorId ?? null,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quota.id },
          include: { serviceType: true },
        });
      });

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota reservation conflict detected');
      }
      throw error;
    }
  }

  async use(
    subscriptionId: string,
    serviceTypeCode: string,
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Usage amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();
    const now = new Date();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        // 1. Check idempotency
        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            quota: { include: { serviceType: true } },
          },
        });
        if (existingTx) {
          return existingTx.quota;
        }

        // 2. Validate subscription
        const sub = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          include: {
            quotas: {
              include: { serviceType: true },
            },
          },
        });

        if (!sub) {
          throw new NotFoundException(
            `Subscription with ID "${subscriptionId}" not found`,
          );
        }

        const effective = resolveEffectiveStatus(
          {
            status: sub.status as SubscriptionStatus,
            startDate: sub.startDate,
            endDate: sub.endDate,
          },
          now,
        );

        if (effective !== SubscriptionStatus.ACTIVE || now < new Date(sub.startDate)) {
          throw new ConflictException(
            `Cannot use quota on subscription with effective status "${effective}"`,
          );
        }

        // 3. Find service quota
        const quota = sub.quotas.find(
          (q) => q.serviceType.code === serviceTypeCode,
        );
        if (!quota) {
          throw new ConflictException(
            `Service "${serviceTypeCode}" is not entitled in this subscription`,
          );
        }

        // 4. Check available quota
        if (quota.allocated !== null) {
          const remaining = quota.allocated - quota.used - quota.reserved;
          if (remaining < amount) {
            throw new ConflictException(
              `Insufficient quota remaining to use (Available: ${Math.max(0, remaining)}, Requested: ${amount})`,
            );
          }

          // Atomic increment used
          await tx.subscriptionQuota.update({
            where: { id: quota.id },
            data: {
              used: { increment: amount },
            },
          });
        }

        // 5. Append-only ledger transaction
        await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId: sub.id,
            type: QuotaTransactionType.USE,
            allocatedDelta: 0,
            reservedDelta: 0,
            usedDelta: quota.allocated === null ? 0 : amount,
            idempotencyKey,
            referenceType: ctx.referenceType ?? null,
            referenceId: ctx.referenceId ?? null,
            reason: ctx.reason ?? 'Direct service usage / check-in',
            createdBy: ctx.actorId ?? null,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quota.id },
          include: { serviceType: true },
        });
      });

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota usage conflict detected');
      }
      throw error;
    }
  }

  async consumeReserved(
    subscriptionId: string,
    serviceTypeCode: string,
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        // 1. Check idempotency
        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            quota: { include: { serviceType: true } },
          },
        });
        if (existingTx) {
          return existingTx.quota;
        }

        // 2. Load quota
        const quota = await tx.subscriptionQuota.findFirst({
          where: {
            subscriptionId,
            serviceType: { code: serviceTypeCode },
          },
          include: { serviceType: true },
        });

        if (!quota) {
          throw new NotFoundException(
            `Quota for service "${serviceTypeCode}" not found on subscription "${subscriptionId}"`,
          );
        }

        if (quota.allocated !== null) {
          if (quota.reserved < amount) {
            throw new ConflictException(
              `Insufficient reserved quota to consume (Reserved: ${quota.reserved}, Requested: ${amount})`,
            );
          }

          // Atomic transfer from reserved to used
          await tx.subscriptionQuota.update({
            where: { id: quota.id },
            data: {
              reserved: { decrement: amount },
              used: { increment: amount },
            },
          });
        }

        // 3. Append ledger
        await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId,
            type: QuotaTransactionType.USE,
            allocatedDelta: 0,
            reservedDelta: quota.allocated === null ? 0 : -amount,
            usedDelta: quota.allocated === null ? 0 : amount,
            idempotencyKey,
            referenceType: ctx.referenceType ?? null,
            referenceId: ctx.referenceId ?? null,
            reason: ctx.reason ?? 'Confirmed booking attendance',
            createdBy: ctx.actorId ?? null,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quota.id },
          include: { serviceType: true },
        });
      });

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota consumption conflict detected');
      }
      throw error;
    }
  }

  async refundReserved(
    subscriptionId: string,
    serviceTypeCode: string,
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        // 1. Check idempotency
        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            quota: { include: { serviceType: true } },
          },
        });
        if (existingTx) {
          return existingTx.quota;
        }

        // 2. Load quota
        const quota = await tx.subscriptionQuota.findFirst({
          where: {
            subscriptionId,
            serviceType: { code: serviceTypeCode },
          },
          include: { serviceType: true },
        });

        if (!quota) {
          throw new NotFoundException(
            `Quota for service "${serviceTypeCode}" not found on subscription "${subscriptionId}"`,
          );
        }

        if (quota.allocated !== null) {
          if (quota.reserved < amount) {
            throw new ConflictException(
              `Insufficient reserved quota to refund (Reserved: ${quota.reserved}, Requested: ${amount})`,
            );
          }

          // Atomic release reservation
          await tx.subscriptionQuota.update({
            where: { id: quota.id },
            data: {
              reserved: { decrement: amount },
            },
          });
        }

        // 3. Append ledger
        await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId,
            type: QuotaTransactionType.REFUND,
            allocatedDelta: 0,
            reservedDelta: quota.allocated === null ? 0 : -amount,
            usedDelta: 0,
            idempotencyKey,
            referenceType: ctx.referenceType ?? null,
            referenceId: ctx.referenceId ?? null,
            reason: ctx.reason ?? 'Booking cancellation refund',
            createdBy: ctx.actorId ?? null,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quota.id },
          include: { serviceType: true },
        });
      });

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota refund conflict detected');
      }
      throw error;
    }
  }

  async refundUsed(
    subscriptionId: string,
    serviceTypeCode: string,
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        // 1. Check idempotency
        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            quota: { include: { serviceType: true } },
          },
        });
        if (existingTx) {
          return existingTx.quota;
        }

        // 2. Load quota
        const quota = await tx.subscriptionQuota.findFirst({
          where: {
            subscriptionId,
            serviceType: { code: serviceTypeCode },
          },
          include: { serviceType: true },
        });

        if (!quota) {
          throw new NotFoundException(
            `Quota for service "${serviceTypeCode}" not found on subscription "${subscriptionId}"`,
          );
        }

        if (quota.allocated !== null) {
          if (quota.used < amount) {
            throw new ConflictException(
              `Insufficient used quota to refund (Used: ${quota.used}, Requested: ${amount})`,
            );
          }

          // Atomic decrement used
          await tx.subscriptionQuota.update({
            where: { id: quota.id },
            data: {
              used: { decrement: amount },
            },
          });
        }

        // 3. Append ledger
        await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId,
            type: QuotaTransactionType.REFUND,
            allocatedDelta: 0,
            reservedDelta: 0,
            usedDelta: quota.allocated === null ? 0 : -amount,
            idempotencyKey,
            referenceType: ctx.referenceType ?? null,
            referenceId: ctx.referenceId ?? null,
            reason: ctx.reason ?? 'Usage refund / reversal',
            createdBy: ctx.actorId ?? null,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quota.id },
          include: { serviceType: true },
        });
      });

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota refund conflict detected');
      }
      throw error;
    }
  }

  async adjust(
    quotaId: string,
    dto: AdjustQuotaDto,
    actorId: string,
  ): Promise<SubscriptionQuotaDetail> {
    if (dto.allocatedDelta === undefined || dto.allocatedDelta === 0) {
      throw new BadRequestException('allocatedDelta must be a non-zero integer');
    }

    const idempotencyKey = randomUUID();

    try {
      const updatedQuota = await this.db.client.$transaction(async (tx) => {
        const quota = await tx.subscriptionQuota.findUnique({
          where: { id: quotaId },
          include: { serviceType: true },
        });

        if (!quota) {
          throw new NotFoundException(`Subscription quota with ID "${quotaId}" not found`);
        }

        if (quota.allocated === null) {
          throw new ConflictException(
            'Cannot adjust allocation on an unlimited service quota',
          );
        }

        const newAllocated = quota.allocated + dto.allocatedDelta!;
        if (newAllocated < 0 || newAllocated < quota.used + quota.reserved) {
          throw new ConflictException(
            `Adjusted allocation (${newAllocated}) cannot be less than current used + reserved quota (${quota.used + quota.reserved})`,
          );
        }

        await tx.subscriptionQuota.update({
          where: { id: quotaId },
          data: {
            allocated: newAllocated,
          },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId,
            subscriptionId: quota.subscriptionId,
            type: QuotaTransactionType.ADJUST,
            allocatedDelta: dto.allocatedDelta!,
            reservedDelta: 0,
            usedDelta: 0,
            idempotencyKey,
            reason: dto.reason.trim(),
            createdBy: actorId,
          },
        });

        return tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: quotaId },
          include: { serviceType: true },
        });
      });

      this.logger.log(
        `Adjusted quota ${quotaId} by ${dto.allocatedDelta} (Actor: ${actorId}). Reason: ${dto.reason}`,
      );

      return this.mapQuotaDetail(updatedQuota as unknown as RawQuotaWithRelations);
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
        throw new ConflictException('Concurrent quota adjustment conflict detected');
      }
      throw error;
    }
  }

  async getQuotaTransactions(
    quotaId: string,
    query: QueryQuotaTransactionsDto,
  ): Promise<PaginatedQuotaTransactionsResponse> {
    const quota = await this.db.client.subscriptionQuota.findUnique({
      where: { id: quotaId },
    });

    if (!quota) {
      throw new NotFoundException(`Subscription quota with ID "${quotaId}" not found`);
    }

    const {
      page = 1,
      limit = 20,
      type,
      startDateFrom,
      startDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { quotaId };

    if (type) {
      where.type = type;
    }

    if (startDateFrom || startDateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (startDateFrom) dateFilter.gte = new Date(startDateFrom);
      if (startDateTo) dateFilter.lte = new Date(startDateTo);
      where.createdAt = dateFilter;
    }

    const [total, items] = await Promise.all([
      this.db.client.quotaTransaction.count({ where }),
      this.db.client.quotaTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
    ]);

    return {
      data: items.map((i) =>
        this.mapTransactionDetail(i as unknown as RawTransactionWithRelations),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }
}
