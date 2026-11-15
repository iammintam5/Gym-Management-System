import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { memberCodeRange } from '../common/member-code';
import { Prisma } from '@gym/database';
import {
  previousStaffRequest,
  saveStaffRequest,
} from '../common/staff-request';
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

  private readonly paymentInclude = {
    subscription: { include: { member: true, plan: true } },
    confirmer: { include: { employeeProfile: true } },
  } as const;

  private async lockSubscription(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) throw new NotFoundException('Gói tập không tồn tại.');
    return sub;
  }

  private async assertAmountAvailable(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    amount: Prisma.Decimal,
    agreedPrice: Prisma.Decimal,
  ): Promise<void> {
    const paid = await tx.paymentRecord.aggregate({
      where: { subscriptionId, status: PaymentStatus.PAID },
      _sum: { amount: true },
    });
    const collected = paid._sum.amount ?? new Prisma.Decimal(0);
    if (collected.plus(amount).greaterThan(agreedPrice)) {
      throw new ConflictException(
        'Số tiền thu vượt số tiền còn phải thanh toán của gói tập.',
      );
    }
  }

  private async syncPaymentStatus(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    refunded = false,
  ): Promise<void> {
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const paid = await tx.paymentRecord.aggregate({
      where: { subscriptionId, status: PaymentStatus.PAID },
      _sum: { amount: true },
    });
    const total = paid._sum.amount ?? new Prisma.Decimal(0);
    const settled = total.greaterThanOrEqualTo(sub.agreedPrice);
    const now = new Date();
    const activate =
      settled &&
      sub.status === SubscriptionStatus.UPCOMING &&
      sub.startDate <= now &&
      sub.endDate >= now;
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        paymentStatus: settled
          ? PaymentStatus.PAID
          : refunded && total.isZero()
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PENDING,
        ...(activate
          ? { status: SubscriptionStatus.ACTIVE, activatedAt: now }
          : {}),
      },
    });
  }

  async createPayment(
    subscriptionId: string,
    dto: CreatePaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    if (
      dto.status &&
      dto.status !== PaymentStatus.PAID &&
      dto.status !== PaymentStatus.PENDING
    ) {
      throw new BadRequestException(
        'Chỉ có thể tạo thanh toán PENDING hoặc PAID.',
      );
    }
    if ((dto.currency ?? 'VND') !== 'VND')
      throw new BadRequestException('Gói tập được thanh toán bằng VND.');
    const payload = { ...dto, subscriptionId, actorId: user.id };
    const payment = await this.db.client.$transaction(async (tx) => {
      const previousId = await previousStaffRequest(
        tx,
        dto.idempotencyKey,
        'CREATE_PAYMENT',
        payload,
      );
      if (previousId)
        return tx.paymentRecord.findUniqueOrThrow({
          where: { id: previousId },
          include: this.paymentInclude,
        });
      const sub = await this.lockSubscription(tx, subscriptionId);
      if (sub.status === SubscriptionStatus.CANCELLED)
        throw new ConflictException('Gói tập đã hủy.');
      const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0))
        throw new BadRequestException('Số tiền phải lớn hơn 0.');
      await this.assertAmountAvailable(
        tx,
        subscriptionId,
        amount,
        sub.agreedPrice,
      );
      const isPaid = dto.status === PaymentStatus.PAID;
      const created = await tx.paymentRecord.create({
        data: {
          subscriptionId,
          amount,
          currency: 'VND',
          method: dto.method ?? (isPaid ? 'CASH' : null),
          status: isPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
          note: dto.note ?? null,
          confirmedBy: isPaid ? user.id : null,
          confirmedAt: isPaid ? new Date() : null,
        },
        include: this.paymentInclude,
      });
      if (isPaid) await this.syncPaymentStatus(tx, subscriptionId);
      await saveStaffRequest(
        tx,
        dto.idempotencyKey,
        'CREATE_PAYMENT',
        payload,
        created.id,
      );
      return created;
    });
    return this.mapPaymentDetail(payment as unknown as RawPaymentWithRelations);
  }

  async confirmPayment(
    paymentId: string,
    dto: ConfirmPaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    const reference = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      select: { subscriptionId: true },
    });
    if (!reference)
      throw new NotFoundException('Bản ghi thanh toán không tồn tại.');
    const confirmed = await this.db.client.$transaction(async (tx) => {
      const sub = await this.lockSubscription(tx, reference.subscriptionId);
      if (sub.status === SubscriptionStatus.CANCELLED)
        throw new ConflictException('Gói tập đã hủy.');
      const payment = await tx.paymentRecord.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (payment.status !== PaymentStatus.PENDING)
        throw new ConflictException(
          'Payment already confirmed, cancelled or refunded.',
        );
      if (payment.currency !== 'VND')
        throw new BadRequestException('Đơn vị tiền tệ không khớp gói tập.');
      await this.assertAmountAvailable(
        tx,
        payment.subscriptionId,
        payment.amount,
        sub.agreedPrice,
      );
      const updated = await tx.paymentRecord.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.PAID,
          method: dto.method,
          note: dto.note ?? payment.note,
          confirmedBy: user.id,
          confirmedAt: new Date(),
        },
        include: this.paymentInclude,
      });
      await this.syncPaymentStatus(tx, payment.subscriptionId);
      return updated;
    });
    return this.mapPaymentDetail(
      confirmed as unknown as RawPaymentWithRelations,
    );
  }

  async refundPayment(
    paymentId: string,
    dto: RefundPaymentDto,
    _user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    const reference = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      select: { subscriptionId: true },
    });
    if (!reference)
      throw new NotFoundException('Bản ghi thanh toán không tồn tại.');
    const refunded = await this.db.client.$transaction(async (tx) => {
      await this.lockSubscription(tx, reference.subscriptionId);
      const payment = await tx.paymentRecord.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (payment.status !== PaymentStatus.PAID)
        throw new BadRequestException(
          'Chỉ có thể hoàn tiền cho bản ghi đã thanh toán PAID.',
        );
      const refundNote = dto.reason
        ? `[REFUND: ${dto.reason}]`
        : `[REFUND: ${new Date().toISOString()}]`;
      const updated = await tx.paymentRecord.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REFUNDED,
          note: payment.note ? `${payment.note} | ${refundNote}` : refundNote,
        },
        include: this.paymentInclude,
      });
      await this.syncPaymentStatus(tx, payment.subscriptionId, true);
      return updated;
    });
    return this.mapPaymentDetail(
      refunded as unknown as RawPaymentWithRelations,
    );
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
      throw new NotFoundException(
        `Bản ghi thanh toán với ID "${paymentId}" không tồn tại`,
      );
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(
        'Chỉ có thể xuất biên lai cho giao dịch đã thanh toán thành công (Status: PAID)',
      );
    }

    // Authorization: Member must be owner, or user must be Staff/Admin
    const isMember = user.roles.includes(UserRole.MEMBER);
    const isStaffOrAdmin =
      user.roles.includes(UserRole.STAFF) ||
      user.roles.includes(UserRole.ADMIN);

    if (
      !isStaffOrAdmin &&
      (!isMember || payment.subscription.member.userId !== user.id)
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem biên lai thanh toán này',
      );
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

    if (query.search?.trim()) {
      const search = query.search.trim();
      const memberRange = memberCodeRange(search);
      const receipt = /^REC-\d{8}-([a-f0-9]{8})$/i.exec(search);
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
        ...(memberRange ? [{ subscription: { memberId: memberRange } }] : []),
        ...(receipt ? [{ id: memberCodeRange(receipt[1]!) }] : []),
      ];
    }
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
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
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
              member: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
              plan: true,
            },
          },
          confirmer: {
            select: {
              email: true,
              employeeProfile: {
                select: {
                  fullName: true,
                },
              },
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
    const localDate =
      query.date ??
      new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const dayStart = new Date(`${localDate.slice(0, 10)}T00:00:00+07:00`);
    const dayEnd = new Date(dayStart.getTime() + 86400000 - 1);

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
            member: {
              select: {
                id: true,
                fullName: true,
              },
            },
            plan: true,
          },
        },
        confirmer: {
          select: {
            email: true,
            employeeProfile: {
              select: {
                fullName: true,
              },
            },
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
      date: localDate.slice(0, 10),
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
            member: {
              select: {
                id: true,
                fullName: true,
              },
            },
            plan: true,
          },
        },
        confirmer: {
          select: {
            email: true,
            employeeProfile: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Bản ghi thanh toán với ID "${id}" không tồn tại`,
      );
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
