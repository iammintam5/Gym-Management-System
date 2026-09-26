import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import { DatabaseService } from '../database/database.module';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';
import {
  AuthUser,
  PaginatedPaymentsResponse,
  PaymentReceipt,
  PaymentReconciliationResponse,
  PaymentRecordDetail,
  PaymentStatus,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';

interface RawPaymentWithRelations {
  id: string;
  subscriptionId: string;
  amount: Prisma.Decimal | number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  subscription?: {
    startDate: Date;
    endDate: Date;
    member?: {
      id: string;
      userId: string;
      fullName: string;
      phone: string | null;
    } | null;
    plan?: {
      name: string;
      durationDays: number;
    } | null;
  } | null;
  confirmer?: {
    email?: string;
    employeeProfile?: {
      fullName: string;
    } | null;
  } | null;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DatabaseService) {}

  async createPayment(
    subscriptionId: string,
    dto: CreatePaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    const sub = await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        member: true,
        plan: true,
      },
    });

    if (!sub) {
      throw new NotFoundException(`Gói tập với ID "${subscriptionId}" không tồn tại`);
    }

    const isPaid = dto.status === PaymentStatus.PAID;
    const now = new Date();

    const payment = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const created = await tx.paymentRecord.create({
          data: {
            subscriptionId,
            amount: new Prisma.Decimal(dto.amount),
            currency: dto.currency ?? 'VND',
            method: dto.method ?? null,
            status: isPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
            note: dto.note ?? null,
            confirmedBy: isPaid ? user.id : null,
            confirmedAt: isPaid ? now : null,
          },
          include: {
            subscription: {
              include: {
                member: true,
                plan: true,
              },
            },
            confirmer: {
              include: {
                employeeProfile: true,
              },
            },
          },
        });

        if (isPaid) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          // Check JIT Promotion
          if (
            sub.status === SubscriptionStatus.UPCOMING &&
            sub.startDate.getTime() <= now.getTime() &&
            sub.endDate.getTime() >= now.getTime()
          ) {
            await tx.subscription.update({
              where: { id: subscriptionId },
              data: {
                status: SubscriptionStatus.ACTIVE,
                activatedAt: now,
              },
            });
          }
        }

        return created;
      },
    );

    return this.mapPaymentDetail(payment as unknown as RawPaymentWithRelations);
  }

  async confirmPayment(
    paymentId: string,
    dto: ConfirmPaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    const payment = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Bản ghi thanh toán với ID "${paymentId}" không tồn tại`);
    }

    if (payment.status === PaymentStatus.PAID) {
      throw new ConflictException(
        'Bản ghi thanh toán này đã được xác nhận thanh toán trước đó (Payment already confirmed)',
      );
    }

    if (
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.CANCELLED
    ) {
      throw new ConflictException(
        `Không thể xác nhận thanh toán cho bản ghi có trạng thái ${payment.status}`,
      );
    }

    const now = new Date();
    const sub = payment.subscription;

    const confirmed = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const updated = await tx.paymentRecord.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.PAID,
            method: dto.method,
            note: dto.note ?? payment.note,
            confirmedBy: user.id,
            confirmedAt: now,
          },
          include: {
            subscription: {
              include: {
                member: true,
                plan: true,
              },
            },
            confirmer: {
              include: {
                employeeProfile: true,
              },
            },
          },
        });

        // Sync subscription paymentStatus
        await tx.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            paymentStatus: PaymentStatus.PAID,
          },
        });

        // JIT Promotion
        if (
          sub &&
          sub.status === SubscriptionStatus.UPCOMING &&
          sub.startDate.getTime() <= now.getTime() &&
          sub.endDate.getTime() >= now.getTime()
        ) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              activatedAt: now,
            },
          });
        }

        return updated;
      },
    );

    return this.mapPaymentDetail(confirmed as unknown as RawPaymentWithRelations);
  }

  async refundPayment(
    paymentId: string,
    dto: RefundPaymentDto,
    _user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    const payment = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      include: {
        subscription: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Bản ghi thanh toán với ID "${paymentId}" không tồn tại`);
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        `Chỉ có thể hoàn tiền cho bản ghi đã thanh toán PAID (Hiện tại: ${payment.status})`,
      );
    }

    const refunded = await this.db.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const refundNote = dto.reason
          ? `[REFUND: ${dto.reason}]`
          : `[REFUND: ${new Date().toISOString()}]`;

        const updated = await tx.paymentRecord.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.REFUNDED,
            note: payment.note ? `${payment.note} | ${refundNote}` : refundNote,
          },
          include: {
            subscription: {
              include: {
                member: true,
                plan: true,
              },
            },
            confirmer: {
              include: {
                employeeProfile: true,
              },
            },
          },
        });

        // Check if there are any remaining PAID payments for this subscription
        const remainingPaid = await tx.paymentRecord.findFirst({
          where: {
            subscriptionId: payment.subscriptionId,
            status: PaymentStatus.PAID,
          },
        });

        if (!remainingPaid) {
          await tx.subscription.update({
            where: { id: payment.subscriptionId },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
            },
          });
        }

        return updated;
      },
    );

    return this.mapPaymentDetail(refunded as unknown as RawPaymentWithRelations);
  }

  async getReceipt(paymentId: string, user: AuthUser): Promise<PaymentReceipt> {
    const payment = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
        confirmer: {
          include: {
            employeeProfile: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Bản ghi thanh toán với ID "${paymentId}" không tồn tại`);
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        'Chỉ có thể xuất biên lai cho giao dịch đã thanh toán thành công (Status: PAID)',
      );
    }

    // Authorization: Member must be owner, or user must be Staff/Admin
    const isMember = user.roles.includes(UserRole.MEMBER);
    const isStaffOrAdmin =
      user.roles.includes(UserRole.STAFF) || user.roles.includes(UserRole.ADMIN);

    if (isMember && !isStaffOrAdmin) {
      if (payment.subscription?.member?.userId !== user.id) {
        throw new ForbiddenException(
          'Hội viên không có quyền xem biên lai thanh toán của người khác',
        );
      }
    }

    const dateStr = (payment.confirmedAt ?? payment.createdAt)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const shortId = payment.id.slice(0, 8).toUpperCase();
    const receiptNumber = `REC-${dateStr}-${shortId}`;

    const cashierName =
      payment.confirmer?.employeeProfile?.fullName ??
      payment.confirmer?.email ??
      'Thu ngân quầy';

    const amountNum =
      typeof payment.amount === 'number'
        ? payment.amount
        : Number(payment.amount.toString());

    const memberId = payment.subscription?.member?.id ?? '';
    const memberCode = memberId
      ? `MEM-${memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : '';

    return {
      receiptNumber,
      confirmedAt: (payment.confirmedAt ?? payment.createdAt).toISOString(),
      amount: amountNum,
      currency: payment.currency,
      method: payment.method ?? 'CASH',
      note: payment.note ?? null,
      member: {
        fullName: payment.subscription?.member?.fullName ?? 'Hội viên',
        memberCode,
        phone: payment.subscription?.member?.phone ?? null,
      },
      subscription: {
        planName: payment.subscription?.plan?.name ?? 'Gói tập',
        durationDays: payment.subscription?.plan?.durationDays ?? 30,
        startDate: payment.subscription?.startDate
          ? payment.subscription.startDate.toISOString()
          : '',
        endDate: payment.subscription?.endDate
          ? payment.subscription.endDate.toISOString()
          : '',
      },
      cashier: {
        fullName: cashierName,
      },
    };
  }

  async findAll(query: QueryPaymentsDto): Promise<PaginatedPaymentsResponse> {
    const where: Prisma.PaymentRecordWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.method) {
      where.method = query.method;
    }
    if (query.subscriptionId) {
      where.subscriptionId = query.subscriptionId;
    }
    if (query.memberId) {
      where.subscription = {
        memberId: query.memberId,
      };
    }
    if (query.confirmedBy) {
      where.confirmedBy = query.confirmedBy;
    }
    if (query.from) {
      where.createdAt = { gte: new Date(query.from) };
    }
    if (query.to) {
      where.createdAt = { lte: new Date(query.to) };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.db.client.paymentRecord.count({ where }),
      this.db.client.paymentRecord.findMany({
        where,
        include: {
          subscription: {
            include: {
              member: true,
              plan: true,
            },
          },
          confirmer: {
            include: {
              employeeProfile: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((i: unknown) =>
        this.mapPaymentDetail(i as RawPaymentWithRelations),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async reconcile(
    query: ReconciliationQueryDto,
  ): Promise<PaymentReconciliationResponse> {
    const targetDate = query.date ? new Date(query.date) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const where: Prisma.PaymentRecordWhereInput = {
      status: PaymentStatus.PAID,
      confirmedAt: {
        gte: query.from ? new Date(query.from) : dayStart,
        lte: query.to ? new Date(query.to) : dayEnd,
      },
    };

    if (query.cashierId) {
      where.confirmedBy = query.cashierId;
    }

    const items = await this.db.client.paymentRecord.findMany({
      where,
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
        confirmer: {
          include: {
            employeeProfile: true,
          },
        },
      },
      orderBy: { confirmedAt: 'asc' },
    });

    let totalRevenue = 0;
    let cashRevenue = 0;
    let transferRevenue = 0;
    let cardRevenue = 0;

    for (const item of items) {
      const amt =
        typeof item.amount === 'number'
          ? item.amount
          : Number(item.amount.toString());

      totalRevenue += amt;

      if (item.method === 'CASH') {
        cashRevenue += amt;
      } else if (item.method === 'TRANSFER') {
        transferRevenue += amt;
      } else if (item.method === 'CARD') {
        cardRevenue += amt;
      }
    }

    return {
      date: targetDate.toISOString().slice(0, 10),
      totalRevenue,
      cashRevenue,
      transferRevenue,
      cardRevenue,
      transactionCount: items.length,
      items: items.map((i: unknown) =>
        this.mapPaymentDetail(i as RawPaymentWithRelations),
      ),
    };
  }

  async findById(id: string): Promise<PaymentRecordDetail> {
    const payment = await this.db.client.paymentRecord.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            member: true,
            plan: true,
          },
        },
        confirmer: {
          include: {
            employeeProfile: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Bản ghi thanh toán với ID "${id}" không tồn tại`);
    }

    return this.mapPaymentDetail(payment as unknown as RawPaymentWithRelations);
  }

  private mapPaymentDetail(item: RawPaymentWithRelations): PaymentRecordDetail {
    const amt =
      typeof item.amount === 'number'
        ? item.amount
        : Number(item.amount.toString());

    const memberId = item.subscription?.member?.id ?? '';
    const memberCode = memberId
      ? `MEM-${memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : '';

    return {
      id: item.id,
      subscriptionId: item.subscriptionId,
      memberId,
      memberCode,
      memberFullName: item.subscription?.member?.fullName ?? '',
      amount: amt,
      currency: item.currency,
      status: item.status,
      method: item.method ?? null,
      note: item.note ?? null,
      confirmedBy: item.confirmedBy ?? null,
      confirmedByName:
        item.confirmer?.employeeProfile?.fullName ??
        item.confirmer?.email ??
        null,
      confirmedAt: item.confirmedAt ? item.confirmedAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
      subscription: item.subscription
        ? {
            planName: item.subscription.plan?.name ?? '',
            startDate: item.subscription.startDate.toISOString(),
            endDate: item.subscription.endDate.toISOString(),
          }
        : undefined,
    };
  }
}
