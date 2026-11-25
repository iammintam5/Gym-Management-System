import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import {
  PaymentStatus,
  PtPurchaseOrigin,
  PtPurchaseStatus,
  SubscriptionStatus,
  UserRole,
  effectivePtPurchaseStatus,
  type AuthUser,
  type PaginatedPtPackagePurchasesResponse,
  type PtPackagePlanDetail,
  type PtPackagePurchaseDetail,
  type PtPackageSaleResult,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { lockScheduleWrites } from '../common/booking-access';
import {
  previousStaffRequest,
  saveStaffRequest,
} from '../common/staff-request';
import { PtCreditService } from './pt-credit.service';
import { mapPlanDetail } from './pt-catalog-initializer.service';
import type {
  CreatePtPackagePlanDto,
  UpdatePtPackagePlanDto,
} from './dto/pt-package-plan.dto';
import type { PurchasePtPackageDto } from './dto/purchase-pt-package.dto';
import type { QueryPtPurchasesDto } from './dto/query-pt-purchases.dto';

const purchaseInclude = {
  sourceSubscription: {
    select: {
      status: true,
      paymentStatus: true,
      endDate: true,
      agreedPrice: true,
      payments: { select: { amount: true, status: true } },
    },
  },
  payments: {
    select: { id: true },
    take: 1,
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.PtPackagePurchaseInclude;
type PurchaseRow = Prisma.PtPackagePurchaseGetPayload<{
  include: typeof purchaseInclude;
}>;
function mapPurchase(purchase: PurchaseRow): PtPackagePurchaseDetail {
  const source = purchase.sourceSubscription;
  const effectiveStatus = effectivePtPurchaseStatus(
    {
      origin: purchase.origin as PtPurchaseOrigin,
      storedStatus: purchase.status as PtPurchaseStatus,
      paymentStatus: purchase.paymentStatus as PaymentStatus,
      allocated: purchase.allocated,
      reserved: purchase.reserved,
      used: purchase.used,
      cutoverEligible: purchase.cutoverEligible,
    },
    source
      ? {
          status: source.status as SubscriptionStatus,
          paymentStatus: source.paymentStatus as PaymentStatus,
          endDate: source.endDate,
          agreedPrice: Number(source.agreedPrice),
          confirmedPaidAmount: source.payments.length
            ? source.payments
                .filter((payment) => payment.status === PaymentStatus.PAID)
                .reduce((total, payment) => total + Number(payment.amount), 0)
            : Number(source.agreedPrice),
        }
      : null,
  );
  return {
    id: purchase.id,
    memberId: purchase.memberId,
    origin: purchase.origin as PtPurchaseOrigin,
    ptPlanId: purchase.ptPlanId,
    sourceSubscriptionId: purchase.sourceSubscriptionId,
    legacyQuotaId: purchase.legacyQuotaId,
    packageCodeSnapshot: purchase.packageCodeSnapshot,
    packageNameSnapshot: purchase.packageNameSnapshot,
    sessionCountSnapshot: purchase.sessionCountSnapshot,
    sessionMinutesSnapshot: purchase.sessionMinutesSnapshot,
    unlimited: purchase.allocated === null,
    allocated: purchase.allocated,
    reserved: purchase.reserved,
    used: purchase.used,
    remaining:
      purchase.allocated === null
        ? null
        : Math.max(0, purchase.allocated - purchase.used - purchase.reserved),
    agreedPrice:
      purchase.agreedPrice === null ? null : Number(purchase.agreedPrice),
    currency: purchase.currency,
    paymentStatus: purchase.paymentStatus as PaymentStatus,
    storedStatus: purchase.status as PtPurchaseStatus,
    effectiveStatus,
    originalStartDate: purchase.originalStartDate?.toISOString() ?? null,
    originalEndDate: purchase.originalEndDate?.toISOString() ?? null,
    cutoverAt: purchase.cutoverAt?.toISOString() ?? null,
    cutoverEligible: purchase.cutoverEligible,
    createdBy: purchase.createdBy,
    createdAt: purchase.createdAt.toISOString(),
    updatedAt: purchase.updatedAt.toISOString(),
  };
}

@Injectable()
export class PtPackagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly credits: PtCreditService,
  ) {}

  async listPlans(user: AuthUser): Promise<PtPackagePlanDetail[]> {
    const plans = await this.db.client.ptPackagePlan.findMany({
      where: user.roles.includes(UserRole.ADMIN) ? {} : { isActive: true },
      orderBy: [{ sessionCount: 'asc' }, { code: 'asc' }],
    });
    return plans.map(mapPlanDetail);
  }

  async savePlan(
    dto: CreatePtPackagePlanDto | UpdatePtPackagePlanDto,
    actorId: string,
    id?: string,
  ): Promise<PtPackagePlanDetail> {
    try {
      const plan = await this.db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('gym-pt-catalog-init', 0))::text`;
        if (id && !(await tx.ptPackagePlan.findUnique({ where: { id } })))
          throw new NotFoundException('Gói PT không tồn tại.');
        const saved = id
          ? await tx.ptPackagePlan.update({ where: { id }, data: dto })
          : await tx.ptPackagePlan.create({
              data: { ...(dto as CreatePtPackagePlanDto), sessionMinutes: 60 },
            });
        await tx.auditLog.create({
          data: {
            actorId,
            action: id ? 'PT_PLAN_UPDATED' : 'PT_PLAN_CREATED',
            entityType: 'PT_PACKAGE_PLAN',
            entityId: saved.id,
            metadata: {
              code: saved.code,
              sessionCount: saved.sessionCount,
              price: Number(saved.price),
              isActive: saved.isActive,
            },
          },
        });
        return saved;
      });
      return mapPlanDetail(plan);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Mã gói PT đã được sử dụng.');
      throw error;
    }
  }

  async purchase(
    dto: PurchasePtPackageDto,
    user: AuthUser,
  ): Promise<PtPackageSaleResult> {
    const payload = { ...dto, actorId: user.id };
    return this.db.client.$transaction(
      async (tx) => {
        await lockScheduleWrites(tx);
        const previousId = await previousStaffRequest(
          tx,
          dto.idempotencyKey,
          'PURCHASE_PT_PACKAGE',
          payload,
        );
        if (previousId) {
          const previous = await tx.ptPackagePurchase.findUniqueOrThrow({
            where: { id: previousId },
            include: purchaseInclude,
          });
          if (!previous.payments[0])
            throw new ConflictException(
              'Lần mua PT thiếu biên lai. Vui lòng kiểm tra giao dịch.',
            );
          return {
            purchase: mapPurchase(previous),
            paymentId: previous.payments[0].id,
          };
        }
        await this.credits.lockMemberPtDomain(tx, dto.memberId);
        const member = await tx.memberProfile.findUnique({
          where: { id: dto.memberId },
          include: { user: true },
        });
        if (!member) throw new NotFoundException('Hội viên không tồn tại.');
        if (!member.user.isActive)
          throw new ConflictException('Tài khoản hội viên đã ngừng hoạt động.');
        const open = await tx.ptPackagePurchase.findFirst({
          where: {
            memberId: dto.memberId,
            origin: PtPurchaseOrigin.STANDALONE,
            status: {
              in: [PtPurchaseStatus.ACTIVE, PtPurchaseStatus.PENDING_PAYMENT],
            },
          },
        });
        if (open)
          throw new ConflictException(
            'Hội viên còn gói PT đang sử dụng hoặc chờ thanh toán. Vui lòng kiểm tra hồ sơ.',
          );

        // Lock the plan until its sold terms and full payment have committed together.
        await tx.$queryRaw`SELECT id FROM pt_package_plans WHERE id = ${dto.ptPlanId}::uuid FOR SHARE`;
        const plan = await tx.ptPackagePlan.findUnique({
          where: { id: dto.ptPlanId },
        });
        if (!plan) throw new NotFoundException('Gói PT không tồn tại.');
        if (!plan.isActive)
          throw new ConflictException(
            'Gói PT đã ngừng bán. Vui lòng chọn gói khác.',
          );
        if (
          !plan.price.equals(dto.expectedPrice) ||
          plan.updatedAt.toISOString() !==
            new Date(dto.expectedPlanUpdatedAt).toISOString()
        )
          throw new ConflictException(
            'Thông tin gói PT đã thay đổi. Hãy mở lại form để kiểm tra giá và số buổi trước khi thu tiền.',
          );
        if (!['CASH', 'TRANSFER'].includes(dto.paymentMethod))
          throw new BadRequestException(
            'Vui lòng chọn tiền mặt hoặc chuyển khoản.',
          );
        const now = new Date();
        const purchase = await tx.ptPackagePurchase.create({
          data: {
            memberId: member.id,
            origin: PtPurchaseOrigin.STANDALONE,
            ptPlanId: plan.id,
            packageCodeSnapshot: plan.code,
            packageNameSnapshot: plan.name,
            sessionCountSnapshot: plan.sessionCount,
            sessionMinutesSnapshot: 60,
            allocated: plan.sessionCount,
            agreedPrice: plan.price,
            currency: 'VND',
            status: PtPurchaseStatus.ACTIVE,
            paymentStatus: PaymentStatus.PAID,
            createdBy: user.id,
          },
        });
        const payment = await tx.paymentRecord.create({
          data: {
            ptPurchaseId: purchase.id,
            amount: plan.price,
            currency: 'VND',
            status: PaymentStatus.PAID,
            method: dto.paymentMethod,
            note: dto.note?.trim() || null,
            confirmedBy: user.id,
            confirmedAt: now,
          },
        });
        await saveStaffRequest(
          tx,
          dto.idempotencyKey,
          'PURCHASE_PT_PACKAGE',
          payload,
          purchase.id,
        );
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'PT_PACKAGE_PURCHASED',
            entityType: 'PT_PACKAGE_PURCHASE',
            entityId: purchase.id,
            metadata: {
              paymentId: payment.id,
              planId: plan.id,
              amount: Number(plan.price),
              sessionCount: plan.sessionCount,
              method: dto.paymentMethod,
            },
          },
        });
        return {
          purchase: mapPurchase({
            ...purchase,
            sourceSubscription: null,
            payments: [payment],
          }),
          paymentId: payment.id,
        };
      },
      { timeout: 15000 },
    );
  }

  async selfHistory(
    userId: string,
    query: QueryPtPurchasesDto,
  ): Promise<PaginatedPtPackagePurchasesResponse> {
    const member = await this.db.client.memberProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Hồ sơ hội viên không tồn tại.');
    return this.history(member.id, query);
  }

  async history(
    memberId: string,
    { page, limit }: QueryPtPurchasesDto,
  ): Promise<PaginatedPtPackagePurchasesResponse> {
    if (
      !(await this.db.client.memberProfile.findUnique({
        where: { id: memberId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Hồ sơ hội viên không tồn tại.');
    return this.db.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      const where = { memberId };
      const [rows, total] = await Promise.all([
        tx.ptPackagePurchase.findMany({
          where,
          include: purchaseInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.ptPackagePurchase.count({ where }),
      ]);
      return {
        data: rows.map((row) => ({
          ...mapPurchase(row),
          paymentId: row.payments[0]?.id ?? null,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    });
  }
}
