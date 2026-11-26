import {
  GoneException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { lockScheduleWrites } from '../common/booking-access';
import { memberCodeRange } from '../common/member-code';
import {
  Prisma,
  PtPurchaseOrigin as DbPtPurchaseOrigin,
  PtPurchaseStatus as DbPtPurchaseStatus,
} from '@gym/database';
import {
  previousStaffRequest,
  saveStaffRequest,
} from '../common/staff-request';
import { DatabaseService } from '../database/database.module';
import { PtCreditService } from '../pt-packages/pt-credit.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { subscriptionRefundPreview } from './refund-policy';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';
import {
  GYM_SERVICE_SCOPE,
  AuthUser,
  PaginatedPaymentsResponse,
  PaymentPtPurchaseSummary,
  PaymentReceipt,
  PaymentReconciliationResponse,
  PaymentRecordDetail,
  PaymentRefundPreview,
  PaymentRefundConfirmation,
  PaymentStatus,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';

interface RawPaymentWithRelations {
  id: string;
  subscriptionId: string | null;
  ptPurchaseId?: string | null;
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
      userId?: string;
      fullName: string;
      phone?: string | null;
    } | null;
    plan?: {
      name: string;
      durationDays: number;
    } | null;
  } | null;
  ptPurchase?: {
    id: string;
    packageCodeSnapshot: string | null;
    packageNameSnapshot: string;
    allocated: number | null;
    sessionMinutesSnapshot: number;
    member?: {
      id: string;
      userId?: string;
      fullName: string;
      phone?: string | null;
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
  private readonly ptCredits: PtCreditService;

  constructor(
    private readonly db: DatabaseService,
    @Optional() ptCreditService?: PtCreditService,
  ) {
    this.ptCredits = ptCreditService ?? new PtCreditService(this.db);
  }

  private readonly paymentInclude = {
    subscription: { include: { member: true, plan: true } },
    ptPurchase: { include: { member: true } },
    confirmer: { include: { employeeProfile: true } },
  } as const;

  private resolveActorId(userId?: string | null): string | null {
    if (!userId || userId === '00000000-0000-0000-0000-000000000000') {
      return null;
    }
    return userId;
  }

  private assertSupportedWriteMethod(
    method?: string | null,
    required = false,
  ): void {
    if (required && !method) {
      throw new BadRequestException(
        'Phương thức thanh toán là bắt buộc (CASH hoặc TRANSFER).',
      );
    }
    if (
      method !== undefined &&
      method !== null &&
      method !== 'CASH' &&
      method !== 'TRANSFER'
    ) {
      throw new BadRequestException(
        'Thanh toán mới chỉ hỗ trợ phương thức CASH hoặc TRANSFER.',
      );
    }
  }

  private async lockSubscriptionAndMemberDomain(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
  ) {
    const header = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, memberId: true },
    });
    if (!header) throw new NotFoundException('Gói tập không tồn tại.');
    await this.ptCredits.lockMemberPtDomain(tx, header.memberId);
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) throw new NotFoundException('Gói tập không tồn tại.');
    return sub;
  }

  private async resolvePaymentTargetMemberId(paymentId: string): Promise<{
    subscriptionId: string | null;
    ptPurchaseId: string | null;
    memberId: string;
  }> {
    const reference = await this.db.client.paymentRecord.findUnique({
      where: { id: paymentId },
      select: {
        subscriptionId: true,
        ptPurchaseId: true,
        subscription: { select: { memberId: true } },
        ptPurchase: { select: { memberId: true } },
      },
    });
    if (!reference) {
      throw new NotFoundException('Bản ghi thanh toán không tồn tại.');
    }
    const memberId =
      reference.subscription?.memberId ??
      reference.ptPurchase?.memberId ??
      null;
    if (!memberId) {
      throw new ConflictException(
        'Bản ghi thanh toán thiếu liên kết hội viên hợp lệ.',
      );
    }
    return {
      subscriptionId: reference.subscriptionId,
      ptPurchaseId: reference.ptPurchaseId,
      memberId,
    };
  }

  private async assertSubscriptionAmountAvailable(
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

  private async assertPtPurchaseAmountAvailable(
    tx: Prisma.TransactionClient,
    ptPurchaseId: string,
    amount: Prisma.Decimal,
    agreedPrice: Prisma.Decimal,
  ): Promise<void> {
    const paid = await tx.paymentRecord.aggregate({
      where: { ptPurchaseId, status: PaymentStatus.PAID },
      _sum: { amount: true },
    });
    const collected = paid._sum.amount ?? new Prisma.Decimal(0);
    if (collected.plus(amount).greaterThan(agreedPrice)) {
      throw new ConflictException(
        'Số tiền thu vượt số tiền còn phải thanh toán của gói PT.',
      );
    }
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
    this.assertSupportedWriteMethod(dto.method, false);

    const actorId = this.resolveActorId(user.id);
    const payload = { ...dto, subscriptionId, actorId: user.id };
    const payment = await this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
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
      const sub = await this.lockSubscriptionAndMemberDomain(
        tx,
        subscriptionId,
      );
      if (sub.status === SubscriptionStatus.CANCELLED)
        throw new ConflictException('Gói tập đã hủy.');
      const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0))
        throw new BadRequestException('Số tiền phải lớn hơn 0.');
      await this.assertSubscriptionAmountAvailable(
        tx,
        subscriptionId,
        amount,
        sub.agreedPrice,
      );
      const isPaid = dto.status === PaymentStatus.PAID;
      const now = new Date();
      const created = await tx.paymentRecord.create({
        data: {
          subscriptionId,
          amount,
          currency: 'VND',
          method: dto.method ?? (isPaid ? 'CASH' : null),
          status: isPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
          note: dto.note ?? null,
          confirmedBy: isPaid ? actorId : null,
          confirmedAt: isPaid ? now : null,
        },
      });
      if (isPaid) {
        await this.ptCredits.syncSubscriptionPaymentInTx(tx, {
          subscriptionId,
          actorId,
          now,
        });
      }
      await saveStaffRequest(
        tx,
        dto.idempotencyKey,
        'CREATE_PAYMENT',
        payload,
        created.id,
      );
      return tx.paymentRecord.findUniqueOrThrow({
        where: { id: created.id },
        include: this.paymentInclude,
      });
    });
    return this.mapPaymentDetail(payment as unknown as RawPaymentWithRelations);
  }

  async confirmPayment(
    paymentId: string,
    dto: ConfirmPaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    this.assertSupportedWriteMethod(dto.method, true);
    const target = await this.resolvePaymentTargetMemberId(paymentId);
    const actorId = this.resolveActorId(user.id);

    const confirmed = await this.db.client.$transaction(async (tx) => {
      await this.ptCredits.lockMemberPtDomain(tx, target.memberId);

      const payment = await tx.paymentRecord.findUniqueOrThrow({
        where: { id: paymentId },
      });
      // Check the retired product only after the authenticated route resolves its target.
      if (!GYM_SERVICE_SCOPE.personalTraining && payment.ptPurchaseId) {
        throw new GoneException(
          'Dịch vụ PT 1–1 đã ngừng cung cấp. Dữ liệu cũ chỉ được giữ để tra cứu và đối chiếu.',
        );
      }
      if (payment.status !== PaymentStatus.PENDING)
        throw new ConflictException(
          'Payment already confirmed, cancelled or refunded.',
        );
      if (payment.currency !== 'VND')
        throw new BadRequestException('Đơn vị tiền tệ không khớp gói tập.');

      const now = new Date();

      if (payment.subscriptionId) {
        const sub = await tx.subscription.findUnique({
          where: { id: payment.subscriptionId },
        });
        if (!sub) throw new NotFoundException('Gói tập không tồn tại.');
        if (sub.status === SubscriptionStatus.CANCELLED)
          throw new ConflictException('Gói tập đã hủy.');

        await this.assertSubscriptionAmountAvailable(
          tx,
          payment.subscriptionId,
          payment.amount,
          sub.agreedPrice,
        );

        await tx.paymentRecord.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.PAID,
            method: dto.method,
            note: dto.note ?? payment.note,
            confirmedBy: actorId,
            confirmedAt: now,
          },
        });

        await this.ptCredits.syncSubscriptionPaymentInTx(tx, {
          subscriptionId: payment.subscriptionId,
          actorId,
          now,
        });
      } else if (payment.ptPurchaseId) {
        const purchase = await tx.ptPackagePurchase.findUnique({
          where: { id: payment.ptPurchaseId },
        });
        if (!purchase) {
          throw new NotFoundException('Gói PT mua rời không tồn tại.');
        }
        if (
          purchase.origin !== DbPtPurchaseOrigin.STANDALONE ||
          purchase.agreedPrice === null
        ) {
          throw new ConflictException(
            'Chỉ có thể thu tiền trực tiếp cho gói PT mua rời hợp lệ.',
          );
        }
        if (
          purchase.status === DbPtPurchaseStatus.CANCELLED ||
          purchase.status === DbPtPurchaseStatus.REFUNDED
        ) {
          throw new ConflictException('Gói PT đã hủy hoặc hoàn tiền.');
        }

        await this.assertPtPurchaseAmountAvailable(
          tx,
          purchase.id,
          payment.amount,
          purchase.agreedPrice,
        );

        await tx.paymentRecord.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.PAID,
            method: dto.method,
            note: dto.note ?? payment.note,
            confirmedBy: actorId,
            confirmedAt: now,
          },
        });

        await this.ptCredits.syncStandalonePtPurchasePaymentInTx(tx, {
          ptPurchaseId: purchase.id,
          actorId,
          now,
        });
      } else {
        throw new ConflictException(
          'Bản ghi thanh toán không gắn với gói tập hoặc gói PT hợp lệ.',
        );
      }

      return tx.paymentRecord.findUniqueOrThrow({
        where: { id: paymentId },
        include: this.paymentInclude,
      });
    });

    return this.mapPaymentDetail(
      confirmed as unknown as RawPaymentWithRelations,
    );
  }

  async getRefundPreview(
    paymentId: string,
    user: AuthUser,
  ): Promise<PaymentRefundPreview> {
    if (!user.roles.includes(UserRole.ADMIN))
      throw new ForbiddenException('Chỉ quản trị viên được xử lý hoàn tiền.');
    const target = await this.resolvePaymentTargetMemberId(paymentId);
    return this.db.client.$transaction(async (tx) => {
      await this.ptCredits.lockMemberPtDomain(tx, target.memberId);
      return subscriptionRefundPreview(tx, paymentId, new Date());
    });
  }

  async refundPayment(
    paymentId: string,
    dto: RefundPaymentDto,
    user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    if (!user.roles.includes(UserRole.ADMIN))
      throw new ForbiddenException('Chỉ quản trị viên được xử lý hoàn tiền.');
    if (
      !dto.reason?.trim() ||
      dto.reason.trim().length > 255 ||
      !['CASH', 'TRANSFER'].includes(dto.method) ||
      dto.confirmedExternal !== true ||
      !Number.isFinite(dto.expectedAmount) ||
      dto.expectedAmount <= 0 ||
      (dto.reference?.length ?? 0) > 100 ||
      (dto.method === 'TRANSFER' && !dto.reference?.trim())
    ) {
      throw new BadRequestException(
        'Cần lý do, phương thức, số tiền và xác nhận đã trả tiền; chuyển khoản phải có mã giao dịch.',
      );
    }
    const target = await this.resolvePaymentTargetMemberId(paymentId);
    const refunded = await this.db.client.$transaction(
      async (tx) => {
        // Same locks as booking/attendance; check-in also serializes on the member row.
        await this.ptCredits.lockMemberPtDomain(tx, target.memberId);
        const now = new Date();
        const preview = await subscriptionRefundPreview(tx, paymentId, now);
        if (!preview.eligible || !preview.subscriptionId)
          throw new ConflictException(preview.reasons.join(' '));
        if (!new Prisma.Decimal(dto.expectedAmount).equals(preview.amount))
          throw new ConflictException(
            'Số tiền đã thay đổi. Vui lòng kiểm tra lại trước khi xác nhận.',
          );
        const subscriptionId = preview.subscriptionId;
        const records = await tx.paymentRecord.findMany({
          where: { subscriptionId, status: PaymentStatus.PAID },
        });
        for (const payment of records) {
          const refundNote = '[REFUND: ' + dto.reason.trim() + ']';
          await tx.paymentRecord.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.REFUNDED,
              note: payment.note
                ? payment.note + ' | ' + refundNote
                : refundNote,
            },
          });
          // Immutable structured confirmation, committed together with all financial changes.
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: 'REFUND_PAYMENT',
              entityType: 'PAYMENT_RECORD',
              entityId: payment.id,
              metadata: {
                subscriptionId,
                amount: preview.amount,
                receiptAmount: Number(payment.amount),
                receiptCount: records.length,
                method: dto.method,
                reference: dto.reference?.trim() || null,
                reason: dto.reason.trim(),
                refundedAt: now.toISOString(),
                refundedBy: user.id,
                confirmedExternal: true,
              },
            },
          });
        }
        await tx.paymentRecord.updateMany({
          where: { subscriptionId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.CANCELLED },
        });
        await this.ptCredits.syncSubscriptionPaymentInTx(tx, {
          subscriptionId,
          refunded: true,
          reason: dto.reason.trim(),
          actorId: user.id,
          now,
        });
        await tx.subscriptionFreeze.updateMany({
          where: {
            subscriptionId,
            status: { in: ['REQUESTED', 'APPROVED'] },
            restoredAt: null,
          },
          data: { status: 'CANCELLED' },
        });
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            status: SubscriptionStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: 'Hoàn tiền: ' + dto.reason.trim(),
          },
        });
        return tx.paymentRecord.findUniqueOrThrow({
          where: { id: paymentId },
          include: this.paymentInclude,
        });
      },
      { maxWait: 10000, timeout: 15000 },
    );
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
        ptPurchase: {
          include: {
            member: true,
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

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.REFUNDED
    ) {
      throw new BadRequestException(
        'Chỉ có thể xuất biên lai cho giao dịch đã thanh toán thành công (Status: PAID)',
      );
    }

    const ownerMember =
      payment.subscription?.member ?? payment.ptPurchase?.member ?? null;
    const ownerUserId = ownerMember?.userId ?? null;

    // Authorization: Member must be exact owner, or user must be Staff/Admin
    const isMember = user.roles.includes(UserRole.MEMBER);
    const isStaffOrAdmin =
      user.roles.includes(UserRole.STAFF) ||
      user.roles.includes(UserRole.ADMIN);

    if (
      !isStaffOrAdmin &&
      (!isMember || !ownerUserId || ownerUserId !== user.id)
    ) {
      throw new ForbiddenException(
        'Bạn không có quyền xem biên lai thanh toán này',
      );
    }

    let refund: PaymentRefundConfirmation | null = null;
    if (payment.status === PaymentStatus.REFUNDED) {
      const audit = await this.db.client.auditLog.findFirst({
        where: {
          entityId: payment.id,
          entityType: 'PAYMENT_RECORD',
          action: 'REFUND_PAYMENT',
        },
        orderBy: { createdAt: 'desc' },
      });
      const data = audit?.metadata;
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        typeof data.amount === 'number' &&
        (data.method === 'CASH' || data.method === 'TRANSFER') &&
        typeof data.reason === 'string' &&
        typeof data.refundedAt === 'string'
      ) {
        refund = {
          amount: data.amount,
          method: data.method,
          reference: typeof data.reference === 'string' ? data.reference : null,
          reason: data.reason,
          refundedAt: data.refundedAt,
          refundedBy: audit?.actorId ?? null,
        };
      }
    }
    const effectiveConfirmedAt = payment.confirmedAt ?? payment.createdAt;
    const dateStr = effectiveConfirmedAt
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

    const memberId = ownerMember?.id ?? '';
    const memberCode = memberId
      ? `MEM-${memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : '';

    const ptPurchaseSummary: PaymentPtPurchaseSummary | null =
      payment.ptPurchase
        ? {
            id: payment.ptPurchase.id,
            packageCode: payment.ptPurchase.packageCodeSnapshot,
            packageName: payment.ptPurchase.packageNameSnapshot,
            sessionCount: payment.ptPurchase.allocated,
            sessionMinutes: payment.ptPurchase.sessionMinutesSnapshot,
          }
        : null;

    const isPtPackageTarget =
      !payment.subscription && Boolean(payment.ptPurchase);

    return {
      receiptNumber,
      status: payment.status as PaymentStatus,
      refund,
      confirmedAt: effectiveConfirmedAt.toISOString(),
      amount: amountNum,
      currency: payment.currency,
      method: payment.method ?? 'CASH',
      note: payment.note ?? null,
      targetType: isPtPackageTarget ? 'PT_PACKAGE' : 'SUBSCRIPTION',
      member: {
        fullName: ownerMember?.fullName ?? 'Hội viên',
        memberCode,
        phone: ownerMember?.phone ?? null,
      },
      subscription: payment.subscription
        ? {
            planName: payment.subscription.plan?.name ?? 'Gói tập',
            durationDays: payment.subscription.plan?.durationDays ?? 30,
            startDate: payment.subscription.startDate.toISOString(),
            endDate: payment.subscription.endDate.toISOString(),
          }
        : {
            planName: payment.ptPurchase?.packageNameSnapshot ?? 'Gói PT 1-1',
            durationDays: 0,
            startDate: effectiveConfirmedAt.toISOString(),
            endDate: effectiveConfirmedAt.toISOString(),
          },
      ptPurchase: ptPurchaseSummary,
      cashier: {
        fullName: cashierName,
      },
    };
  }

  async findSelf(
    userId: string,
    query: QueryPaymentsDto,
  ): Promise<PaginatedPaymentsResponse> {
    const member = await this.db.client.memberProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Hồ sơ hội viên không tồn tại.');
    return this.findAll({ ...query, memberId: member.id });
  }

  async findAll(query: QueryPaymentsDto): Promise<PaginatedPaymentsResponse> {
    const where: Prisma.PaymentRecordWhereInput = {};
    const andFilters: Prisma.PaymentRecordWhereInput[] = [];

    if (query.search?.trim()) {
      const search = query.search.trim();
      const memberRange = memberCodeRange(search);
      const receipt = /^REC-\d{8}-([a-f0-9]{8})$/i.exec(search);
      andFilters.push({
        OR: [
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
          {
            ptPurchase: {
              member: { fullName: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            ptPurchase: {
              packageNameSnapshot: { contains: search, mode: 'insensitive' },
            },
          },
          {
            ptPurchase: {
              packageCodeSnapshot: { contains: search, mode: 'insensitive' },
            },
          },
          ...(memberRange
            ? [
                { subscription: { memberId: memberRange } },
                { ptPurchase: { memberId: memberRange } },
              ]
            : []),
          ...(receipt ? [{ id: memberCodeRange(receipt[1]!) }] : []),
        ],
      });
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
    if (query.ptPurchaseId) {
      where.ptPurchaseId = query.ptPurchaseId;
    }
    if (query.memberId) {
      andFilters.push({
        OR: [
          { subscription: { memberId: query.memberId } },
          { ptPurchase: { memberId: query.memberId } },
        ],
      });
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
    if (andFilters.length > 0) {
      where.AND = andFilters;
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
          ptPurchase: {
            include: {
              member: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
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
        ptPurchase: {
          include: {
            member: {
              select: {
                id: true,
                fullName: true,
              },
            },
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
        ptPurchase: {
          include: {
            member: {
              select: {
                id: true,
                fullName: true,
              },
            },
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

    const ownerMember =
      item.subscription?.member ?? item.ptPurchase?.member ?? null;
    const memberId = ownerMember?.id ?? '';
    const memberCode = memberId
      ? `MEM-${memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : '';

    const ptPurchaseSummary: PaymentPtPurchaseSummary | null = item.ptPurchase
      ? {
          id: item.ptPurchase.id,
          packageCode: item.ptPurchase.packageCodeSnapshot,
          packageName: item.ptPurchase.packageNameSnapshot,
          sessionCount: item.ptPurchase.allocated,
          sessionMinutes: item.ptPurchase.sessionMinutesSnapshot,
        }
      : null;

    return {
      id: item.id,
      subscriptionId: item.subscriptionId ?? null,
      ptPurchaseId: item.ptPurchaseId ?? null,
      memberId,
      memberCode,
      memberFullName: ownerMember?.fullName ?? '',
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
      ptPurchase: ptPurchaseSummary,
    };
  }
}
