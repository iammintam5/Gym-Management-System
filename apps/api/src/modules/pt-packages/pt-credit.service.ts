import { GYM_SERVICE_SCOPE } from '@gym/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  AttendanceStatus,
  BookingStatus,
  FreezeStatus,
  PaymentStatus,
  PtPurchaseOrigin,
  PtPurchaseStatus,
  ServiceTypeCode,
  SubscriptionStatus,
  deriveStandalonePtPurchaseStatus,
  effectivePtPurchaseStatus,
  evaluateGymCoverageForSlot,
  filterUnmirroredSubscriptionQuotas,
  selectPtCreditSourceForSlot,
  summarizeSpendablePtCredits,
  type CanUseQuotaResult,
  type GymCoverageSubscriptionCandidate,
  type MemberPtCreditBalanceResponse,
  type PtCreditSourceBalanceItem,
  type PtCreditSourceCandidate,
  type PtCreditSourceSubscriptionState,
  type SpendablePtPurchaseLike,
  type SpendableQuotaLike,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import {
  PaymentStatus as DbPaymentStatus,
  Prisma,
  PtPurchaseOrigin as DbPtPurchaseOrigin,
  PtPurchaseStatus as DbPtPurchaseStatus,
  QuotaTransactionType as DbQuotaTransactionType,
} from '@gym/database';
import { lockScheduleWrites } from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import { resolveEffectiveStatus } from '../subscriptions/helpers/subscription-status.helper';
import type { AdjustQuotaDto } from '../quotas/dto/adjust-quota.dto';
import type { QuotaOperationContext } from '../quotas/types/quota-operation.types';

export type SelectedPtBookingSource = {
  kind:
    | 'STANDALONE_PURCHASE'
    | 'LEGACY_BUNDLED_PURCHASE'
    | 'UNMIRRORED_LEGACY_QUOTA';
  ptPurchaseId: string | null;
  quotaId: string | null;
  sourceSubscriptionId: string | null;
  unlimited: boolean;
  sessionMinutes: number;
};

export interface EvaluatedPtBookingEligibility {
  coveringSubscriptionId: string;
  selectedSource: SelectedPtBookingSource;
}

type LoadedMemberSubscription = {
  id: string;
  memberId: string;
  status: string;
  paymentStatus: string;
  startDate: Date;
  endDate: Date;
  agreedPrice: Prisma.Decimal;
  createdAt: Date;
  plan: { id: string; name: string };
  freezes: Array<{
    id: string;
    startsAt: Date;
    endsAt: Date;
    status: string;
    restoredAt: Date | null;
  }>;
  quotas: Array<{
    id: string;
    subscriptionId: string;
    allocated: number | null;
    reserved: number;
    used: number;
    updatedAt: Date;
    serviceType: { id: string; code: string; name: string };
  }>;
  payments: Array<{
    id: string;
    amount: Prisma.Decimal;
    status: string;
  }>;
};

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildCanonicalPayloadHash(
  payload: Record<string, unknown>,
): string {
  const normalize = (val: unknown): unknown => {
    if (Array.isArray(val)) {
      return val.map(normalize);
    }
    if (val !== null && typeof val === 'object') {
      return Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]);
    }
    return val;
  };
  return createHash('sha256')
    .update(JSON.stringify(normalize(payload)))
    .digest('hex');
}

function sumConfirmedPaidAmount(
  payments: ReadonlyArray<{ amount: Prisma.Decimal; status: string }>,
): number {
  let total = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.status === DbPaymentStatus.PAID) {
      total = total.plus(p.amount);
    }
  }
  return Number(total);
}

function resolveVerifiedSubscriptionPaymentStatus(
  sub: Pick<
    LoadedMemberSubscription,
    'paymentStatus' | 'agreedPrice' | 'payments'
  >,
): PaymentStatus {
  if (sub.paymentStatus === PaymentStatus.PAID && sub.payments.length > 0) {
    const confirmedSum = sumConfirmedPaidAmount(sub.payments);
    if (confirmedSum < Number(sub.agreedPrice)) {
      return PaymentStatus.PENDING;
    }
  }
  return sub.paymentStatus as PaymentStatus;
}

function toSourceSubscriptionState(
  sub: LoadedMemberSubscription,
): PtCreditSourceSubscriptionState {
  const agreedPrice = Number(sub.agreedPrice);
  const confirmedPaidAmount =
    sub.payments.length > 0
      ? sumConfirmedPaidAmount(sub.payments)
      : agreedPrice;
  return {
    id: sub.id,
    memberId: sub.memberId,
    status: sub.status as SubscriptionStatus,
    paymentStatus: sub.paymentStatus as PaymentStatus,
    startDate: sub.startDate,
    endDate: sub.endDate,
    agreedPrice,
    confirmedPaidAmount,
    freezes: sub.freezes.map((f) => ({
      id: f.id,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      status: f.status as FreezeStatus,
      restoredAt: f.restoredAt,
    })),
  };
}

function toCoverageCandidate(
  sub: LoadedMemberSubscription,
): GymCoverageSubscriptionCandidate {
  return {
    id: sub.id,
    memberId: sub.memberId,
    status: sub.status as SubscriptionStatus,
    paymentStatus: resolveVerifiedSubscriptionPaymentStatus(sub),
    startDate: sub.startDate,
    endDate: sub.endDate,
    freezes: sub.freezes.map((f) => ({
      id: f.id,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      status: f.status as FreezeStatus,
      restoredAt: f.restoredAt,
    })),
  };
}

function computeNextStoredLegacyPurchaseStatus(params: {
  currentStatus: DbPtPurchaseStatus;
  paymentStatus: DbPaymentStatus;
  cutoverEligible: boolean | null;
  allocated: number | null;
  reserved: number;
  used: number;
  cancelled?: boolean;
}): DbPtPurchaseStatus {
  if (
    params.paymentStatus === DbPaymentStatus.REFUNDED ||
    params.currentStatus === DbPtPurchaseStatus.REFUNDED
  ) {
    return DbPtPurchaseStatus.REFUNDED;
  }

  if (!params.cutoverEligible) {
    return params.currentStatus;
  }

  if (
    params.cancelled ||
    params.currentStatus === DbPtPurchaseStatus.CANCELLED ||
    params.paymentStatus === DbPaymentStatus.CANCELLED
  ) {
    return DbPtPurchaseStatus.CANCELLED;
  }

  if (params.currentStatus === DbPtPurchaseStatus.EXPIRED) {
    return DbPtPurchaseStatus.EXPIRED;
  }

  if (params.paymentStatus === DbPaymentStatus.PENDING) {
    return DbPtPurchaseStatus.PENDING_PAYMENT;
  }

  if (
    params.allocated !== null &&
    params.reserved === 0 &&
    params.used === params.allocated
  ) {
    return DbPtPurchaseStatus.EXHAUSTED;
  }

  return DbPtPurchaseStatus.ACTIVE;
}

@Injectable()
export class PtCreditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Coherent topological lock order shared across runtime writers and PtLegacyConversionService:
   * lockScheduleWrites -> (optional idempotencyKey lock) -> member_profiles -> subscriptions (ASC)
   * -> subscription_quotas (ASC) -> pt_package_purchases (ASC) -> pt_bookings (ASC).
   */
  async lockMemberPtDomain(
    tx: Prisma.TransactionClient,
    memberId: string,
  ): Promise<void> {
    await lockScheduleWrites(tx);
    await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${memberId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE member_id = ${memberId}::uuid ORDER BY id ASC FOR UPDATE`;
    await tx.$queryRaw`
      SELECT sq.id
      FROM subscription_quotas sq
      INNER JOIN subscriptions s ON s.id = sq.subscription_id
      WHERE s.member_id = ${memberId}::uuid
      ORDER BY sq.id ASC
      FOR UPDATE
    `;
    await tx.$queryRaw`SELECT id FROM pt_package_purchases WHERE member_id = ${memberId}::uuid ORDER BY id ASC FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM pt_bookings WHERE member_id = ${memberId}::uuid ORDER BY id ASC FOR UPDATE`;
  }

  async lockIdempotencyKey(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))::text`;
  }

  async findIdempotentReplay<TSnapshot>(
    tx: Prisma.TransactionClient,
    idempotencyKey: string,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<{
    replayed: true;
    quotaTransactionId: string;
    snapshot: TSnapshot;
  } | null> {
    await this.lockIdempotencyKey(tx, idempotencyKey);
    const existingTx = await tx.quotaTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (!existingTx) {
      return null;
    }

    const expectedHash = buildCanonicalPayloadHash({
      operation,
      ...payload,
    });

    const audits = await tx.auditLog.findMany({
      where: {
        action: 'PT_CREDIT_MUTATION',
        entityType: 'QUOTA_TRANSACTION',
        entityId: existingTx.id,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    for (const entry of audits) {
      if (!isJsonObject(entry.metadata)) {
        continue;
      }
      const storedOp = entry.metadata.operation;
      const storedHash = entry.metadata.requestHash;
      const storedSnapshot = entry.metadata.resultSnapshot;
      if (typeof storedOp === 'string' && typeof storedHash === 'string') {
        if (storedOp !== operation || storedHash !== expectedHash) {
          throw new ConflictException(
            `IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key "${idempotencyKey}" was already used with different parameters.`,
          );
        }
        return {
          replayed: true,
          quotaTransactionId: existingTx.id,
          snapshot: storedSnapshot as TSnapshot,
        };
      }
    }

    throw new ConflictException(
      `IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key "${idempotencyKey}" already belongs to another transaction.`,
    );
  }

  async saveIdempotentMutationAudit(
    tx: Prisma.TransactionClient,
    params: {
      quotaTransactionId: string;
      idempotencyKey: string;
      operation: string;
      actorId?: string | null;
      payload: Record<string, unknown>;
      resultSnapshot: unknown;
    },
  ): Promise<void> {
    const requestHash = buildCanonicalPayloadHash({
      operation: params.operation,
      ...params.payload,
    });

    await tx.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: 'PT_CREDIT_MUTATION',
        entityType: 'QUOTA_TRANSACTION',
        entityId: params.quotaTransactionId,
        metadata: {
          idempotencyKey: params.idempotencyKey,
          operation: params.operation,
          requestHash,
          resultSnapshot: params.resultSnapshot as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async hasCutoverOccurred(): Promise<boolean> {
    const [legacyPurchasesCount, conversionAuditCount] = await Promise.all([
      this.db.client.ptPackagePurchase.count({
        where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
      }),
      this.db.client.auditLog.count({
        where: { action: 'PT_LEGACY_CONVERSION_EXECUTED' },
      }),
    ]);
    return legacyPurchasesCount > 0 || conversionAuditCount > 0;
  }

  async hasCutoverOccurredInTx(tx: Prisma.TransactionClient): Promise<boolean> {
    const [legacyPurchasesCount, conversionAuditCount] = await Promise.all([
      tx.ptPackagePurchase.count({
        where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
      }),
      tx.auditLog.count({
        where: { action: 'PT_LEGACY_CONVERSION_EXECUTED' },
      }),
    ]);
    return legacyPurchasesCount > 0 || conversionAuditCount > 0;
  }

  private async loadMemberPtStateInTx(
    tx: Prisma.TransactionClient,
    memberId: string,
  ) {
    const [member, subscriptions, ptPurchases] = await Promise.all([
      tx.memberProfile.findUnique({
        where: { id: memberId },
        include: { user: true },
      }),
      tx.subscription.findMany({
        where: { memberId },
        include: {
          plan: { select: { id: true, name: true } },
          freezes: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              status: true,
              restoredAt: true,
            },
          },
          quotas: {
            include: { serviceType: true },
          },
          payments: {
            select: { id: true, amount: true, status: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.ptPackagePurchase.findMany({
        where: { memberId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    if (!member) {
      throw new NotFoundException(
        `Hội viên với ID "${memberId}" không tồn tại`,
      );
    }

    return {
      member,
      subscriptions: subscriptions as unknown as LoadedMemberSubscription[],
      ptPurchases,
    };
  }

  /**
   * Evaluates Gym coverage for `[startsAt, endsAt]` and deterministically selects one
   * eligible PT credit source (post-conversion mapped purchases, standalone purchases,
   * or pre-conversion unmirrored PT quotas). Caller MUST hold `lockMemberPtDomain`.
   */
  async evaluateAndSelectBookingSourceInTx(
    tx: Prisma.TransactionClient,
    params: {
      memberId: string;
      startsAt: Date;
      endsAt: Date;
      now?: Date;
    },
  ): Promise<EvaluatedPtBookingEligibility> {
    const now = params.now ?? new Date();
    const { member, subscriptions, ptPurchases } =
      await this.loadMemberPtStateInTx(tx, params.memberId);

    const coverageCandidates = subscriptions.map(toCoverageCandidate);
    const coverage = evaluateGymCoverageForSlot(
      coverageCandidates,
      params.startsAt,
      params.endsAt,
      {
        memberIsActive: member.user.isActive,
        referenceNow: now,
      },
    );

    if (!coverage.covered || !coverage.coveringSubscriptionId) {
      if (coverage.reason === 'MEMBER_INACTIVE') {
        throw new BadRequestException('Tài khoản hội viên đã bị vô hiệu hoá');
      }
      if (
        coverage.reason === 'FROZEN_DURING_INTERVAL' ||
        coverage.reason === 'SUSPENDED_WITHOUT_RESTORE_WINDOW'
      ) {
        throw new ConflictException(
          'Buổi tập nằm trong thời gian bảo lưu đã duyệt hoặc gói tập đang tạm ngưng.',
        );
      }
      throw new BadRequestException(
        'Hội viên không có gói tập đã thanh toán đủ bao trùm toàn bộ thời gian buổi tập (No paid Gym subscription covering appointment)',
      );
    }

    const subById = new Map(subscriptions.map((s) => [s.id, s]));
    const purchaseById = new Map(ptPurchases.map((p) => [p.id, p]));

    const sourceCandidates: PtCreditSourceCandidate[] = [];
    for (const p of ptPurchases) {
      const sourceSub = p.sourceSubscriptionId
        ? (subById.get(p.sourceSubscriptionId) ?? null)
        : null;
      sourceCandidates.push({
        id: p.id,
        memberId: p.memberId,
        origin: p.origin as PtPurchaseOrigin,
        storedStatus: p.status as PtPurchaseStatus,
        paymentStatus: p.paymentStatus as PaymentStatus,
        allocated: p.allocated,
        reserved: p.reserved,
        used: p.used,
        cutoverEligible: p.cutoverEligible,
        createdAt: p.createdAt,
        sourceSubscription: sourceSub
          ? toSourceSubscriptionState(sourceSub)
          : null,
      });
    }

    // Pre-conversion unmirrored legacy PT quotas: preserve original subscription-bound behavior
    // (must fall within the subscription's own startDate..endDate before any cutover carry-over).
    const allMemberQuotas: Array<
      SpendableQuotaLike & {
        sub: LoadedMemberSubscription;
      }
    > = [];
    for (const sub of subscriptions) {
      for (const q of sub.quotas) {
        if (q.serviceType.code === ServiceTypeCode.PT) {
          allMemberQuotas.push({
            id: q.id,
            subscriptionId: sub.id,
            service: q.serviceType.code,
            allocated: q.allocated,
            reserved: q.reserved,
            used: q.used,
            sub,
          });
        }
      }
    }

    const unmirroredPtQuotas = filterUnmirroredSubscriptionQuotas(
      allMemberQuotas,
      ptPurchases.map((p) => ({
        origin: p.origin as PtPurchaseOrigin,
        legacyQuotaId: p.legacyQuotaId,
      })),
    );
    const unmirroredBySyntheticId = new Map<
      string,
      (typeof unmirroredPtQuotas)[number]
    >();

    for (const uq of unmirroredPtQuotas) {
      const sub = uq.sub;
      const verifiedPayment = resolveVerifiedSubscriptionPaymentStatus(sub);
      if (
        verifiedPayment !== PaymentStatus.PAID ||
        sub.status === SubscriptionStatus.CANCELLED ||
        now.getTime() > sub.endDate.getTime() ||
        params.startsAt.getTime() < sub.startDate.getTime() ||
        params.endsAt.getTime() > sub.endDate.getTime() ||
        uq.allocated === 0
      ) {
        continue;
      }

      const syntheticId = `unmirrored-quota:${uq.id}`;
      unmirroredBySyntheticId.set(syntheticId, uq);
      sourceCandidates.push({
        id: syntheticId,
        memberId: sub.memberId,
        origin: PtPurchaseOrigin.LEGACY_BUNDLED,
        storedStatus:
          uq.allocated !== null && uq.reserved === 0 && uq.used === uq.allocated
            ? PtPurchaseStatus.EXHAUSTED
            : PtPurchaseStatus.ACTIVE,
        paymentStatus: PaymentStatus.PAID,
        allocated: uq.allocated,
        reserved: uq.reserved,
        used: uq.used,
        cutoverEligible: true,
        createdAt: sub.createdAt,
        sourceSubscription: toSourceSubscriptionState(sub),
      });
    }

    const selection = selectPtCreditSourceForSlot(
      sourceCandidates,
      params.startsAt,
      params.endsAt,
      { referenceNow: now },
    );

    if (!selection.selectedPurchaseId) {
      // Distinguish exhausted finite credits (409 Conflict) from missing/historical/unpaid PT entitlement (400 Bad Request)
      const sawExhaustedEligibleFinite =
        this.hasExhaustedOtherwiseValidPtSource(
          ptPurchases,
          unmirroredPtQuotas,
          subById,
          params.startsAt,
          params.endsAt,
          now,
        );
      if (sawExhaustedEligibleFinite) {
        throw new ConflictException(
          'Hội viên đã hết số lượt tập cùng Huấn luyện viên (PT quota exhausted)',
        );
      }
      throw new BadRequestException(
        'Hội viên không có quyền lợi hoặc gói tập PT 1-1 hợp lệ cho khung giờ này (PT entitlement required)',
      );
    }

    const unmirroredChosen = unmirroredBySyntheticId.get(
      selection.selectedPurchaseId,
    );
    if (unmirroredChosen) {
      return {
        coveringSubscriptionId: coverage.coveringSubscriptionId,
        selectedSource: {
          kind: 'UNMIRRORED_LEGACY_QUOTA',
          ptPurchaseId: null,
          quotaId: unmirroredChosen.id,
          sourceSubscriptionId: unmirroredChosen.subscriptionId,
          unlimited: unmirroredChosen.allocated === null,
          sessionMinutes: 60,
        },
      };
    }

    const chosenPurchase = purchaseById.get(selection.selectedPurchaseId);
    if (!chosenPurchase) {
      throw new ConflictException('Không tìm thấy nguồn buổi PT đã chọn.');
    }

    if (chosenPurchase.origin === DbPtPurchaseOrigin.STANDALONE) {
      const requiredDurationMs =
        chosenPurchase.sessionMinutesSnapshot * 60 * 1000;
      const requestedDurationMs =
        params.endsAt.getTime() - params.startsAt.getTime();
      if (requestedDurationMs !== requiredDurationMs) {
        throw new BadRequestException(
          `Gói PT mua rời yêu cầu thời lượng đúng ${chosenPurchase.sessionMinutesSnapshot} phút mỗi buổi.`,
        );
      }

      return {
        coveringSubscriptionId: coverage.coveringSubscriptionId,
        selectedSource: {
          kind: 'STANDALONE_PURCHASE',
          ptPurchaseId: chosenPurchase.id,
          quotaId: null,
          sourceSubscriptionId: null,
          unlimited: false,
          sessionMinutes: chosenPurchase.sessionMinutesSnapshot,
        },
      };
    }

    if (!chosenPurchase.legacyQuotaId || !chosenPurchase.sourceSubscriptionId) {
      throw new ConflictException(
        `Gói PT chuyển đổi ${chosenPurchase.id} thiếu liên kết nguồn cũ.`,
      );
    }

    return {
      coveringSubscriptionId: coverage.coveringSubscriptionId,
      selectedSource: {
        kind: 'LEGACY_BUNDLED_PURCHASE',
        ptPurchaseId: chosenPurchase.id,
        quotaId: chosenPurchase.legacyQuotaId,
        sourceSubscriptionId: chosenPurchase.sourceSubscriptionId,
        unlimited: chosenPurchase.allocated === null,
        sessionMinutes: chosenPurchase.sessionMinutesSnapshot,
      },
    };
  }

  private hasExhaustedOtherwiseValidPtSource(
    ptPurchases: ReadonlyArray<{
      id: string;
      memberId: string;
      origin: DbPtPurchaseOrigin;
      status: DbPtPurchaseStatus;
      paymentStatus: DbPaymentStatus;
      allocated: number | null;
      reserved: number;
      used: number;
      cutoverEligible: boolean | null;
      sourceSubscriptionId: string | null;
    }>,
    unmirroredPtQuotas: ReadonlyArray<{
      id: string;
      allocated: number | null;
      reserved: number;
      used: number;
      sub: LoadedMemberSubscription;
    }>,
    subById: ReadonlyMap<string, LoadedMemberSubscription>,
    startsAt: Date,
    endsAt: Date,
    now: Date,
  ): boolean {
    for (const p of ptPurchases) {
      if (p.allocated === null || p.allocated <= 0) {
        continue;
      }
      if (p.allocated - p.reserved - p.used >= 1) {
        continue;
      }
      if (p.origin === DbPtPurchaseOrigin.STANDALONE) {
        if (
          p.paymentStatus === DbPaymentStatus.PAID &&
          (p.status === DbPtPurchaseStatus.ACTIVE ||
            p.status === DbPtPurchaseStatus.EXHAUSTED)
        ) {
          return true;
        }
        continue;
      }
      if (!p.cutoverEligible || !p.sourceSubscriptionId) {
        continue;
      }
      const sub = subById.get(p.sourceSubscriptionId);
      if (!sub) {
        continue;
      }
      const eff = effectivePtPurchaseStatus(
        {
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          storedStatus: p.status as PtPurchaseStatus,
          paymentStatus: p.paymentStatus as PaymentStatus,
          allocated: p.allocated,
          reserved: p.reserved,
          used: p.used,
          cutoverEligible: p.cutoverEligible,
        },
        toSourceSubscriptionState(sub),
        now,
      );
      if (
        (eff === PtPurchaseStatus.ACTIVE ||
          eff === PtPurchaseStatus.EXHAUSTED) &&
        startsAt.getTime() >= sub.startDate.getTime()
      ) {
        return true;
      }
    }

    for (const uq of unmirroredPtQuotas) {
      const sub = uq.sub;
      if (
        uq.allocated !== null &&
        uq.allocated > 0 &&
        uq.allocated - uq.reserved - uq.used < 1 &&
        resolveVerifiedSubscriptionPaymentStatus(sub) === PaymentStatus.PAID &&
        sub.status !== SubscriptionStatus.CANCELLED &&
        now.getTime() <= sub.endDate.getTime() &&
        startsAt.getTime() >= sub.startDate.getTime() &&
        endsAt.getTime() <= sub.endDate.getTime()
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Reserves 1 PT session on the selected source and appends a ledger row referencing the actual `bookingId`.
   * Dual-writes `subscription_quotas` and `pt_package_purchases` in the SAME transaction for `LEGACY_BUNDLED`.
   */
  async reserveBookingCreditInTx(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      selectedSource: SelectedPtBookingSource;
      idempotencyKey: string;
      actorId: string | null;
      reason: string;
    },
  ): Promise<{ quotaTransactionId: string }> {
    const src = params.selectedSource;

    if (src.kind === 'STANDALONE_PURCHASE') {
      if (!src.ptPurchaseId) {
        throw new ConflictException('Thiếu mã gói PT mua rời khi giữ chỗ.');
      }
      const purchase = await tx.ptPackagePurchase.findUniqueOrThrow({
        where: { id: src.ptPurchaseId },
      });
      if (
        purchase.origin !== DbPtPurchaseOrigin.STANDALONE ||
        purchase.allocated === null ||
        purchase.paymentStatus !== DbPaymentStatus.PAID ||
        purchase.status !== DbPtPurchaseStatus.ACTIVE ||
        purchase.reserved + purchase.used >= purchase.allocated
      ) {
        throw new ConflictException('Gói PT mua rời đã hết buổi khả dụng.');
      }

      const nextReserved = purchase.reserved + 1;
      const nextStatus = deriveStandalonePtPurchaseStatus({
        paymentStatus: PaymentStatus.PAID,
        allocated: purchase.allocated,
        reserved: nextReserved,
        used: purchase.used,
      });

      await tx.ptPackagePurchase.update({
        where: { id: purchase.id },
        data: {
          reserved: nextReserved,
          status: nextStatus as DbPtPurchaseStatus,
        },
      });

      const createdTx = await tx.quotaTransaction.create({
        data: {
          quotaId: null,
          subscriptionId: null,
          ptPurchaseId: purchase.id,
          type: DbQuotaTransactionType.RESERVE,
          allocatedDelta: 0,
          reservedDelta: 1,
          usedDelta: 0,
          idempotencyKey: params.idempotencyKey,
          referenceType: 'PT_BOOKING',
          referenceId: params.bookingId,
          reason: params.reason,
          createdBy: params.actorId,
        },
      });

      return { quotaTransactionId: createdTx.id };
    }

    if (!src.quotaId || !src.sourceSubscriptionId) {
      throw new ConflictException(
        'Thiếu liên kết hạn mức PT nguồn khi giữ chỗ.',
      );
    }

    const quota = await tx.subscriptionQuota.findUniqueOrThrow({
      where: { id: src.quotaId },
    });
    const mirroredPurchase = src.ptPurchaseId
      ? await tx.ptPackagePurchase.findUniqueOrThrow({
          where: { id: src.ptPurchaseId },
        })
      : await tx.ptPackagePurchase.findFirst({
          where: {
            legacyQuotaId: quota.id,
            origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
          },
        });

    if (mirroredPurchase) {
      if (
        mirroredPurchase.allocated !== quota.allocated ||
        mirroredPurchase.reserved !== quota.reserved ||
        mirroredPurchase.used !== quota.used
      ) {
        throw new ConflictException(
          `Số dư quyền PT cũ (${mirroredPurchase.id}) không khớp hạn mức gốc (${quota.id}).`,
        );
      }
    }

    let reservedDelta = 0;
    if (quota.allocated !== null) {
      if (quota.reserved + quota.used >= quota.allocated) {
        throw new ConflictException('Gói tập đã hết lượt PT khả dụng.');
      }
      reservedDelta = 1;
      const nextReserved = quota.reserved + 1;

      await tx.subscriptionQuota.update({
        where: { id: quota.id },
        data: { reserved: nextReserved },
      });

      if (mirroredPurchase) {
        const nextStatus = computeNextStoredLegacyPurchaseStatus({
          currentStatus: mirroredPurchase.status,
          paymentStatus: mirroredPurchase.paymentStatus,
          cutoverEligible: mirroredPurchase.cutoverEligible,
          allocated: mirroredPurchase.allocated,
          reserved: nextReserved,
          used: mirroredPurchase.used,
        });
        await tx.ptPackagePurchase.update({
          where: { id: mirroredPurchase.id },
          data: {
            reserved: nextReserved,
            status: nextStatus,
          },
        });
      }
    }

    const createdTx = await tx.quotaTransaction.create({
      data: {
        quotaId: quota.id,
        subscriptionId: src.sourceSubscriptionId,
        ptPurchaseId: mirroredPurchase?.id ?? null,
        type: DbQuotaTransactionType.RESERVE,
        allocatedDelta: 0,
        reservedDelta,
        usedDelta: 0,
        idempotencyKey: params.idempotencyKey,
        referenceType: 'PT_BOOKING',
        referenceId: params.bookingId,
        reason: params.reason,
        createdBy: params.actorId,
      },
    });

    return { quotaTransactionId: createdTx.id };
  }

  /**
   * Verifies Gym coverage and credit-source validity at attendance / no-show confirmation time.
   * Supports paid UPCOMING covering subscriptions whose period has arrived (auto-promoting JIT if active).
   */
  async assertPtBookingAttendanceAccessInTx(
    tx: Prisma.TransactionClient,
    booking: {
      id: string;
      memberId: string;
      subscriptionId: string;
      sourceSubscriptionId: string | null;
      quotaId: string | null;
      ptPurchaseId: string | null;
      startsAt: Date;
      endsAt: Date;
    },
    now = new Date(),
  ): Promise<void> {
    const member = await tx.memberProfile.findUniqueOrThrow({
      where: { id: booking.memberId },
      include: { user: true },
    });
    if (!member.user.isActive) {
      throw new BadRequestException('Tài khoản hội viên đã ngừng hoạt động.');
    }

    const coveringSub = (await tx.subscription.findUnique({
      where: { id: booking.subscriptionId },
      include: {
        plan: { select: { id: true, name: true } },
        freezes: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            restoredAt: true,
          },
        },
        quotas: { include: { serviceType: true } },
        payments: { select: { id: true, amount: true, status: true } },
      },
    })) as unknown as LoadedMemberSubscription | null;

    if (!coveringSub || coveringSub.memberId !== booking.memberId) {
      throw new BadRequestException(
        'Gói tập phủ lịch hẹn không tồn tại hoặc không thuộc hội viên này.',
      );
    }

    const verifiedPay = resolveVerifiedSubscriptionPaymentStatus(coveringSub);
    if (
      verifiedPay !== PaymentStatus.PAID ||
      coveringSub.status === SubscriptionStatus.CANCELLED ||
      coveringSub.startDate > booking.startsAt ||
      coveringSub.endDate < booking.endsAt
    ) {
      throw new BadRequestException(
        'Gói tập chưa thanh toán đủ hoặc không còn quyền tham gia buổi tập.',
      );
    }

    const activeFreeze = coveringSub.freezes.find(
      (f) =>
        f.status === FreezeStatus.APPROVED &&
        !f.restoredAt &&
        f.startsAt < booking.endsAt &&
        f.endsAt > booking.startsAt,
    );
    if (activeFreeze) {
      throw new ConflictException(
        'Buổi tập nằm trong thời gian bảo lưu đã duyệt.',
      );
    }
    if (
      coveringSub.status === SubscriptionStatus.SUSPENDED &&
      !coveringSub.freezes.some(
        (f) => f.status === FreezeStatus.APPROVED && !f.restoredAt,
      )
    ) {
      throw new BadRequestException(
        'Gói tập đang tạm ngưng, không thể xác nhận điểm danh.',
      );
    }

    if (
      coveringSub.status === SubscriptionStatus.UPCOMING &&
      coveringSub.startDate <= now &&
      coveringSub.endDate >= now
    ) {
      await tx.subscription.update({
        where: { id: coveringSub.id },
        data: { status: SubscriptionStatus.ACTIVE, activatedAt: now },
      });
    }

    // Verify persisted PT credit source has not been refunded or cancelled
    if (booking.ptPurchaseId) {
      const purchase = await tx.ptPackagePurchase.findUniqueOrThrow({
        where: { id: booking.ptPurchaseId },
      });
      if (
        purchase.paymentStatus !== DbPaymentStatus.PAID ||
        purchase.status === DbPtPurchaseStatus.REFUNDED ||
        purchase.status === DbPtPurchaseStatus.CANCELLED ||
        purchase.status === DbPtPurchaseStatus.PENDING_PAYMENT
      ) {
        throw new BadRequestException(
          'Nguồn buổi PT của lịch hẹn đã bị huỷ hoặc hoàn tiền.',
        );
      }
    }

    if (booking.sourceSubscriptionId) {
      const sourceSub = (await tx.subscription.findUnique({
        where: { id: booking.sourceSubscriptionId },
        include: {
          plan: { select: { id: true, name: true } },
          freezes: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              status: true,
              restoredAt: true,
            },
          },
          quotas: { include: { serviceType: true } },
          payments: { select: { id: true, amount: true, status: true } },
        },
      })) as unknown as LoadedMemberSubscription | null;

      if (
        !sourceSub ||
        sourceSub.status === SubscriptionStatus.CANCELLED ||
        resolveVerifiedSubscriptionPaymentStatus(sourceSub) !==
          PaymentStatus.PAID
      ) {
        throw new BadRequestException(
          'Gói gốc cấp quyền PT của lịch hẹn đã bị huỷ hoặc hoàn tiền.',
        );
      }

      const sourceFreeze = sourceSub.freezes.find(
        (f) =>
          f.status === FreezeStatus.APPROVED &&
          !f.restoredAt &&
          f.startsAt < booking.endsAt &&
          f.endsAt > booking.startsAt,
      );
      if (sourceFreeze) {
        throw new ConflictException(
          'Gói nguồn quyền PT đang bảo lưu trong thời gian buổi tập.',
        );
      }
    }
  }

  /**
   * Settles a PT booking's persisted credit source (`USE` on attendance/no-show, `REFUND` on cancellation).
   * Enforces immutable source association and strictly-once settlement per booking ID.
   */
  async settleBookingCreditInTx(
    tx: Prisma.TransactionClient,
    params: {
      booking: {
        id: string;
        memberId: string;
        subscriptionId: string;
        sourceSubscriptionId: string | null;
        quotaId: string | null;
        ptPurchaseId: string | null;
      };
      settlement: 'USE' | 'REFUND';
      idempotencyKey: string;
      actorId: string | null;
      reason: string;
    },
  ): Promise<{ quotaTransactionId: string }> {
    // Guard strictly-once settlement per booking ID across all writers (cancel, attend, sub-cancel, freeze, refund)
    const priorSettlement = await tx.quotaTransaction.findFirst({
      where: {
        referenceType: 'PT_BOOKING',
        referenceId: params.booking.id,
        type: {
          in: [DbQuotaTransactionType.USE, DbQuotaTransactionType.REFUND],
        },
      },
    });
    if (priorSettlement) {
      throw new ConflictException(
        `Buổi tập PT (${params.booking.id}) đã được tất toán lượt tập trước đó.`,
      );
    }

    const { booking } = params;
    const txType =
      params.settlement === 'USE'
        ? DbQuotaTransactionType.USE
        : DbQuotaTransactionType.REFUND;

    // Case A: Standalone PT purchase booking (quotaId === null)
    if (!booking.quotaId) {
      if (!booking.ptPurchaseId) {
        throw new ConflictException(
          `Lịch tập PT (${booking.id}) thiếu nguồn buổi tập để tất toán.`,
        );
      }
      const purchase = await tx.ptPackagePurchase.findUniqueOrThrow({
        where: { id: booking.ptPurchaseId },
      });
      if (
        purchase.origin !== DbPtPurchaseOrigin.STANDALONE ||
        purchase.allocated === null
      ) {
        throw new ConflictException(
          `Nguồn buổi PT (${purchase.id}) không phải gói mua rời hợp lệ.`,
        );
      }
      if (purchase.reserved < 1) {
        throw new ConflictException(
          `Gói PT mua rời (${purchase.id}) không còn lượt giữ chỗ để tất toán.`,
        );
      }

      const nextReserved = purchase.reserved - 1;
      const nextUsed =
        params.settlement === 'USE' ? purchase.used + 1 : purchase.used;
      const nextStatus = deriveStandalonePtPurchaseStatus({
        paymentStatus: purchase.paymentStatus as PaymentStatus,
        allocated: purchase.allocated,
        reserved: nextReserved,
        used: nextUsed,
        cancelled: purchase.status === DbPtPurchaseStatus.CANCELLED,
      });

      await tx.ptPackagePurchase.update({
        where: { id: purchase.id },
        data: {
          reserved: nextReserved,
          used: nextUsed,
          status: nextStatus as DbPtPurchaseStatus,
        },
      });

      const createdTx = await tx.quotaTransaction.create({
        data: {
          quotaId: null,
          subscriptionId: null,
          ptPurchaseId: purchase.id,
          type: txType,
          allocatedDelta: 0,
          reservedDelta: -1,
          usedDelta: params.settlement === 'USE' ? 1 : 0,
          idempotencyKey: params.idempotencyKey,
          referenceType: 'PT_BOOKING',
          referenceId: booking.id,
          reason: params.reason,
          createdBy: params.actorId,
        },
      });

      return { quotaTransactionId: createdTx.id };
    }

    // Case B: Legacy quota (pre-conversion or mirrored LEGACY_BUNDLED purchase)
    const quota = await tx.subscriptionQuota.findUniqueOrThrow({
      where: { id: booking.quotaId },
    });
    const sourceSubscriptionId =
      booking.sourceSubscriptionId ?? quota.subscriptionId;

    const mirroredPurchase = booking.ptPurchaseId
      ? await tx.ptPackagePurchase.findUniqueOrThrow({
          where: { id: booking.ptPurchaseId },
        })
      : await tx.ptPackagePurchase.findFirst({
          where: {
            legacyQuotaId: quota.id,
            origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
          },
        });

    if (mirroredPurchase) {
      if (
        mirroredPurchase.allocated !== quota.allocated ||
        mirroredPurchase.reserved !== quota.reserved ||
        mirroredPurchase.used !== quota.used
      ) {
        throw new ConflictException(
          `Số dư quyền PT cũ (${mirroredPurchase.id}) không khớp hạn mức gốc (${quota.id}).`,
        );
      }
    }

    let reservedDelta = 0;
    let usedDelta = 0;

    if (quota.allocated !== null) {
      if (quota.reserved < 1) {
        throw new ConflictException(
          `Hạn mức PT (${quota.id}) không còn lượt giữ chỗ để tất toán.`,
        );
      }
      reservedDelta = -1;
      usedDelta = params.settlement === 'USE' ? 1 : 0;

      const nextReserved = quota.reserved - 1;
      const nextUsed = quota.used + usedDelta;

      await tx.subscriptionQuota.update({
        where: { id: quota.id },
        data: {
          reserved: nextReserved,
          used: nextUsed,
        },
      });

      if (mirroredPurchase) {
        const nextStatus = computeNextStoredLegacyPurchaseStatus({
          currentStatus: mirroredPurchase.status,
          paymentStatus: mirroredPurchase.paymentStatus,
          cutoverEligible: mirroredPurchase.cutoverEligible,
          allocated: mirroredPurchase.allocated,
          reserved: nextReserved,
          used: nextUsed,
        });
        await tx.ptPackagePurchase.update({
          where: { id: mirroredPurchase.id },
          data: {
            reserved: nextReserved,
            used: nextUsed,
            status: nextStatus,
          },
        });
      }
    }

    const createdTx = await tx.quotaTransaction.create({
      data: {
        quotaId: quota.id,
        subscriptionId: sourceSubscriptionId,
        ptPurchaseId: mirroredPurchase?.id ?? null,
        type: txType,
        allocatedDelta: 0,
        reservedDelta,
        usedDelta,
        idempotencyKey: params.idempotencyKey,
        referenceType: 'PT_BOOKING',
        referenceId: booking.id,
        reason: params.reason,
        createdBy: params.actorId,
      },
    });

    return { quotaTransactionId: createdTx.id };
  }

  /**
   * Maps `SubscriptionQuota` rows for read APIs: when a PT quota has been converted to a
   * `LEGACY_BUNDLED` `PtPackagePurchase`, reads counters from the mapped purchase.
   */
  async mapSubscriptionQuotasWithMappedPt(
    quotas: ReadonlyArray<{
      id: string;
      subscriptionId: string;
      allocated: number | null;
      reserved: number;
      used: number;
      updatedAt: Date;
      serviceType: { id: string; code: string; name: string };
    }>,
  ): Promise<SubscriptionQuotaDetail[]> {
    const ptQuotaIds = quotas
      .filter((q) => q.serviceType.code === ServiceTypeCode.PT)
      .map((q) => q.id);

    const mappedByQuotaId = new Map<
      string,
      {
        allocated: number | null;
        reserved: number;
        used: number;
        updatedAt: Date;
      }
    >();

    if (ptQuotaIds.length > 0) {
      const purchases = await this.db.client.ptPackagePurchase.findMany({
        where: {
          origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
          legacyQuotaId: { in: ptQuotaIds },
        },
      });
      for (const p of purchases) {
        if (p.legacyQuotaId) {
          mappedByQuotaId.set(p.legacyQuotaId, {
            allocated: p.allocated,
            reserved: p.reserved,
            used: p.used,
            updatedAt: p.updatedAt,
          });
        }
      }
    }

    return quotas.map((q) => {
      const mapped = mappedByQuotaId.get(q.id);
      const allocated = mapped ? mapped.allocated : q.allocated;
      const reserved = mapped ? mapped.reserved : q.reserved;
      const used = mapped ? mapped.used : q.used;
      const updatedAt = mapped ? mapped.updatedAt : q.updatedAt;
      const unlimited = allocated === null;
      const remaining = unlimited
        ? null
        : Math.max(0, allocated - used - reserved);

      return {
        id: q.id,
        subscriptionId: q.subscriptionId,
        service: q.serviceType.code,
        serviceName: q.serviceType.name,
        unlimited,
        allocated,
        reserved,
        used,
        remaining,
        updatedAt: updatedAt.toISOString(),
      };
    });
  }

  /**
   * Read check for `QuotasService.canUse(subscriptionId, 'PT', amount)`.
   * Preserves pre-conversion quota behavior before conversion; reads mapped purchase after conversion.
   */
  async canUseSubscriptionPtQuota(
    subscriptionId: string,
    amount = 1,
  ): Promise<CanUseQuotaResult> {
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return {
        allowed: false,
        reason: 'INVALID_QUOTA_AMOUNT',
        remaining: 0,
        unlimited: false,
      };
    }

    const sub = (await this.db.client.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: { select: { id: true, name: true } },
        freezes: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            restoredAt: true,
          },
        },
        quotas: { include: { serviceType: true } },
        payments: { select: { id: true, amount: true, status: true } },
      },
    })) as unknown as LoadedMemberSubscription | null;

    if (!sub) {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_NOT_FOUND',
        remaining: 0,
        unlimited: false,
      };
    }

    const ptQuota = sub.quotas.find(
      (q) => q.serviceType.code === ServiceTypeCode.PT,
    );
    if (!ptQuota) {
      return {
        allowed: false,
        reason: 'SERVICE_NOT_ENTITLED',
        remaining: 0,
        unlimited: false,
      };
    }

    const now = new Date();
    const mappedPurchase = await this.db.client.ptPackagePurchase.findFirst({
      where: {
        origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
        legacyQuotaId: ptQuota.id,
      },
    });

    if (mappedPurchase) {
      const eff = effectivePtPurchaseStatus(
        {
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          storedStatus: mappedPurchase.status as PtPurchaseStatus,
          paymentStatus: mappedPurchase.paymentStatus as PaymentStatus,
          allocated: mappedPurchase.allocated,
          reserved: mappedPurchase.reserved,
          used: mappedPurchase.used,
          cutoverEligible: mappedPurchase.cutoverEligible,
        },
        toSourceSubscriptionState(sub),
        now,
      );

      const activeFreeze = sub.freezes.some(
        (f) =>
          f.status === FreezeStatus.APPROVED &&
          !f.restoredAt &&
          f.startsAt <= now &&
          f.endsAt > now,
      );

      const remaining =
        mappedPurchase.allocated === null
          ? null
          : Math.max(
              0,
              mappedPurchase.allocated -
                mappedPurchase.used -
                mappedPurchase.reserved,
            );

      if (
        eff !== PtPurchaseStatus.ACTIVE ||
        now < sub.startDate ||
        activeFreeze
      ) {
        if (
          eff === PtPurchaseStatus.EXHAUSTED &&
          now >= sub.startDate &&
          !activeFreeze
        ) {
          return {
            allowed: false,
            reason: 'INSUFFICIENT_QUOTA',
            remaining: 0,
            unlimited: false,
          };
        }
        return {
          allowed: false,
          reason: 'SUBSCRIPTION_NOT_ACTIVE',
          remaining: remaining ?? 0,
          unlimited: false,
        };
      }

      if (mappedPurchase.allocated === null) {
        return { allowed: true, remaining: null, unlimited: true };
      }

      if ((remaining ?? 0) >= amount) {
        return { allowed: true, remaining, unlimited: false };
      }

      return {
        allowed: false,
        reason: 'INSUFFICIENT_QUOTA',
        remaining: remaining ?? 0,
        unlimited: false,
      };
    }

    // Pre-conversion legacy behavior
    const effective = resolveEffectiveStatus(
      {
        status: sub.status as SubscriptionStatus,
        startDate: sub.startDate,
        endDate: sub.endDate,
      },
      now,
    );

    if (
      effective !== SubscriptionStatus.ACTIVE ||
      now < new Date(sub.startDate)
    ) {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_NOT_ACTIVE',
        remaining: 0,
        unlimited: false,
      };
    }

    if (ptQuota.allocated === null) {
      return { allowed: true, remaining: null, unlimited: true };
    }

    const remaining = Math.max(
      0,
      ptQuota.allocated - ptQuota.used - ptQuota.reserved,
    );
    if (remaining >= amount) {
      return { allowed: true, remaining, unlimited: false };
    }

    return {
      allowed: false,
      reason: 'INSUFFICIENT_QUOTA',
      remaining,
      unlimited: false,
    };
  }

  /**
   * Normalizes `QuotasService` PT mutations (`reserve`, `use`, `consumeReserved`, `refundReserved`, `refundUsed`)
   * with full idempotency payload binding and atomic dual-write when a mapped `LEGACY_BUNDLED` purchase exists.
   */
  async mutateSubscriptionPtQuota(
    subscriptionId: string,
    operation:
      | 'QUOTA_RESERVE'
      | 'QUOTA_USE'
      | 'QUOTA_CONSUME_RESERVED'
      | 'QUOTA_REFUND_RESERVED'
      | 'QUOTA_REFUND_USED',
    ctx: QuotaOperationContext = {},
  ): Promise<SubscriptionQuotaDetail> {
    const amount = ctx.amount ?? 1;
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('Amount must be a positive integer');
    }

    const idempotencyKey = ctx.idempotencyKey ?? randomUUID();
    const requestPayload = {
      subscriptionId,
      serviceTypeCode: ServiceTypeCode.PT,
      amount,
      referenceType: ctx.referenceType ?? null,
      referenceId: ctx.referenceId ?? null,
      reason: ctx.reason ?? null,
      actorId: ctx.actorId ?? null,
    };

    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      const replay = await this.findIdempotentReplay<SubscriptionQuotaDetail>(
        tx,
        idempotencyKey,
        operation,
        requestPayload,
      );
      if (replay) {
        return replay.snapshot;
      }

      const subRef = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: { id: true, memberId: true },
      });
      if (!subRef) {
        throw new NotFoundException(
          `Subscription with ID "${subscriptionId}" not found`,
        );
      }

      await this.lockMemberPtDomain(tx, subRef.memberId);

      const sub = (await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: {
          plan: { select: { id: true, name: true } },
          freezes: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              status: true,
              restoredAt: true,
            },
          },
          quotas: { include: { serviceType: true } },
          payments: { select: { id: true, amount: true, status: true } },
        },
      })) as unknown as LoadedMemberSubscription;

      const quota = sub.quotas.find(
        (q) => q.serviceType.code === ServiceTypeCode.PT,
      );
      if (!quota) {
        if (operation === 'QUOTA_RESERVE' || operation === 'QUOTA_USE') {
          throw new ConflictException(
            `Service "${ServiceTypeCode.PT}" is not entitled in this subscription`,
          );
        }
        throw new NotFoundException(
          `Quota for service "${ServiceTypeCode.PT}" not found on subscription "${subscriptionId}"`,
        );
      }

      const mirroredPurchase = await tx.ptPackagePurchase.findFirst({
        where: {
          origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
          legacyQuotaId: quota.id,
        },
      });

      if (mirroredPurchase) {
        if (
          mirroredPurchase.allocated !== quota.allocated ||
          mirroredPurchase.reserved !== quota.reserved ||
          mirroredPurchase.used !== quota.used
        ) {
          throw new ConflictException(
            `Mirrored PT purchase ${mirroredPurchase.id} is out of sync with quota ${quota.id}.`,
          );
        }
      }

      const now = new Date();
      if (operation === 'QUOTA_RESERVE' || operation === 'QUOTA_USE') {
        if (mirroredPurchase) {
          const eff = effectivePtPurchaseStatus(
            {
              origin: PtPurchaseOrigin.LEGACY_BUNDLED,
              storedStatus: mirroredPurchase.status as PtPurchaseStatus,
              paymentStatus: mirroredPurchase.paymentStatus as PaymentStatus,
              allocated: mirroredPurchase.allocated,
              reserved: mirroredPurchase.reserved,
              used: mirroredPurchase.used,
              cutoverEligible: mirroredPurchase.cutoverEligible,
            },
            toSourceSubscriptionState(sub),
            now,
          );
          const activeFreeze = sub.freezes.some(
            (f) =>
              f.status === FreezeStatus.APPROVED &&
              !f.restoredAt &&
              f.startsAt <= now &&
              f.endsAt > now,
          );
          if (
            eff !== PtPurchaseStatus.ACTIVE ||
            now < sub.startDate ||
            activeFreeze
          ) {
            if (
              eff === PtPurchaseStatus.EXHAUSTED &&
              now >= sub.startDate &&
              !activeFreeze
            ) {
              throw new ConflictException(
                `Insufficient PT credits remaining (Available: 0, Requested: ${amount})`,
              );
            }
            throw new ConflictException(
              `Cannot mutate PT credit source with effective status "${eff}"`,
            );
          }
        } else {
          const effective = resolveEffectiveStatus(
            {
              status: sub.status as SubscriptionStatus,
              startDate: sub.startDate,
              endDate: sub.endDate,
            },
            now,
          );
          if (
            effective !== SubscriptionStatus.ACTIVE ||
            now < new Date(sub.startDate)
          ) {
            throw new ConflictException(
              `Cannot use or reserve PT quota on subscription with effective status "${effective}"`,
            );
          }
        }
      }

      const currentAllocated = mirroredPurchase
        ? mirroredPurchase.allocated
        : quota.allocated;
      const currentReserved = mirroredPurchase
        ? mirroredPurchase.reserved
        : quota.reserved;
      const currentUsed = mirroredPurchase ? mirroredPurchase.used : quota.used;

      let nextReserved = currentReserved;
      let nextUsed = currentUsed;
      let reservedDelta = 0;
      let usedDelta = 0;
      let txType: DbQuotaTransactionType;
      let defaultReason: string;

      switch (operation) {
        case 'QUOTA_RESERVE': {
          txType = DbQuotaTransactionType.RESERVE;
          defaultReason = 'Class/PT Booking reservation';
          if (currentAllocated !== null) {
            const remaining = currentAllocated - currentUsed - currentReserved;
            if (remaining < amount) {
              throw new ConflictException(
                `Insufficient quota remaining to reserve (Available: ${Math.max(0, remaining)}, Requested: ${amount})`,
              );
            }
            nextReserved = currentReserved + amount;
            reservedDelta = amount;
          }
          break;
        }
        case 'QUOTA_USE': {
          txType = DbQuotaTransactionType.USE;
          defaultReason = 'Direct service usage / check-in';
          if (currentAllocated !== null) {
            const remaining = currentAllocated - currentUsed - currentReserved;
            if (remaining < amount) {
              throw new ConflictException(
                `Insufficient quota remaining to use (Available: ${Math.max(0, remaining)}, Requested: ${amount})`,
              );
            }
            nextUsed = currentUsed + amount;
            usedDelta = amount;
          }
          break;
        }
        case 'QUOTA_CONSUME_RESERVED': {
          txType = DbQuotaTransactionType.USE;
          defaultReason = 'Confirmed booking attendance';
          if (currentAllocated !== null) {
            if (currentReserved < amount) {
              throw new ConflictException(
                `Insufficient reserved quota to consume (Reserved: ${currentReserved}, Requested: ${amount})`,
              );
            }
            nextReserved = currentReserved - amount;
            nextUsed = currentUsed + amount;
            reservedDelta = -amount;
            usedDelta = amount;
          }
          break;
        }
        case 'QUOTA_REFUND_RESERVED': {
          txType = DbQuotaTransactionType.REFUND;
          defaultReason = 'Booking cancellation refund';
          if (currentAllocated !== null) {
            if (currentReserved < amount) {
              throw new ConflictException(
                `Insufficient reserved quota to refund (Reserved: ${currentReserved}, Requested: ${amount})`,
              );
            }
            nextReserved = currentReserved - amount;
            reservedDelta = -amount;
          }
          break;
        }
        case 'QUOTA_REFUND_USED': {
          txType = DbQuotaTransactionType.REFUND;
          defaultReason = 'Usage refund / reversal';
          if (currentAllocated !== null) {
            if (currentUsed < amount) {
              throw new ConflictException(
                `Insufficient used quota to refund (Used: ${currentUsed}, Requested: ${amount})`,
              );
            }
            nextUsed = currentUsed - amount;
            usedDelta = -amount;
          }
          break;
        }
      }

      const updatedQuota = await tx.subscriptionQuota.update({
        where: { id: quota.id },
        data: {
          reserved: nextReserved,
          used: nextUsed,
        },
        include: { serviceType: true },
      });

      if (mirroredPurchase && currentAllocated !== null) {
        const nextStatus = computeNextStoredLegacyPurchaseStatus({
          currentStatus: mirroredPurchase.status,
          paymentStatus: mirroredPurchase.paymentStatus,
          cutoverEligible: mirroredPurchase.cutoverEligible,
          allocated: currentAllocated,
          reserved: nextReserved,
          used: nextUsed,
        });
        await tx.ptPackagePurchase.update({
          where: { id: mirroredPurchase.id },
          data: {
            reserved: nextReserved,
            used: nextUsed,
            status: nextStatus,
          },
        });
      }

      const createdTx = await tx.quotaTransaction.create({
        data: {
          quotaId: quota.id,
          subscriptionId: sub.id,
          ptPurchaseId: mirroredPurchase?.id ?? null,
          type: txType,
          allocatedDelta: 0,
          reservedDelta,
          usedDelta,
          idempotencyKey,
          referenceType: ctx.referenceType ?? null,
          referenceId: ctx.referenceId ?? null,
          reason: ctx.reason ?? defaultReason,
          createdBy: ctx.actorId ?? null,
        },
      });

      const detail: SubscriptionQuotaDetail = {
        id: updatedQuota.id,
        subscriptionId: updatedQuota.subscriptionId,
        service: updatedQuota.serviceType.code,
        serviceName: updatedQuota.serviceType.name,
        unlimited: currentAllocated === null,
        allocated: currentAllocated,
        reserved: nextReserved,
        used: nextUsed,
        remaining:
          currentAllocated === null
            ? null
            : Math.max(0, currentAllocated - nextUsed - nextReserved),
        updatedAt: updatedQuota.updatedAt.toISOString(),
      };

      await this.saveIdempotentMutationAudit(tx, {
        quotaTransactionId: createdTx.id,
        idempotencyKey,
        operation,
        actorId: ctx.actorId ?? null,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
  }

  /**
   * Admin PT quota adjustment (`POST /api/quotas/:id/adjust`):
   * Enforces invariants, supports idempotent retries, and dual-writes mapped `LEGACY_BUNDLED` purchase.
   */
  async adjustPtQuota(
    quotaId: string,
    dto: AdjustQuotaDto,
    actorId: string,
  ): Promise<SubscriptionQuotaDetail> {
    if (dto.allocatedDelta === undefined || dto.allocatedDelta === 0) {
      throw new BadRequestException(
        'allocatedDelta must be a non-zero integer',
      );
    }

    const allocatedDelta = dto.allocatedDelta;
    const reason = dto.reason.trim();
    const idempotencyKey = dto.idempotencyKey?.trim() || randomUUID();
    const requestPayload = {
      quotaId,
      allocatedDelta,
      reason,
      actorId,
    };

    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      const replay = await this.findIdempotentReplay<SubscriptionQuotaDetail>(
        tx,
        idempotencyKey,
        'QUOTA_ADJUST',
        requestPayload,
      );
      if (replay) {
        return replay.snapshot;
      }

      const header = await tx.subscriptionQuota.findUnique({
        where: { id: quotaId },
        include: { subscription: { select: { memberId: true } } },
      });
      if (!header) {
        throw new NotFoundException(
          `Subscription quota with ID "${quotaId}" not found`,
        );
      }

      await this.lockMemberPtDomain(tx, header.subscription.memberId);

      const quota = await tx.subscriptionQuota.findUniqueOrThrow({
        where: { id: quotaId },
        include: { serviceType: true },
      });

      if (quota.allocated === null) {
        throw new ConflictException(
          'Cannot adjust allocation on an unlimited service quota',
        );
      }

      const mirroredPurchase = await tx.ptPackagePurchase.findFirst({
        where: {
          origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
          legacyQuotaId: quota.id,
        },
      });

      if (mirroredPurchase) {
        if (
          mirroredPurchase.allocated !== quota.allocated ||
          mirroredPurchase.reserved !== quota.reserved ||
          mirroredPurchase.used !== quota.used
        ) {
          throw new ConflictException(
            `Mirrored PT purchase ${mirroredPurchase.id} is out of sync with quota ${quota.id}.`,
          );
        }
      }

      const newAllocated = quota.allocated + allocatedDelta;
      if (newAllocated < 0 || newAllocated < quota.used + quota.reserved) {
        throw new ConflictException(
          `Adjusted allocation (${newAllocated}) cannot be less than current used + reserved quota (${quota.used + quota.reserved})`,
        );
      }

      if (
        mirroredPurchase &&
        mirroredPurchase.cutoverEligible === true &&
        newAllocated === 0
      ) {
        throw new ConflictException(
          'Cannot reduce an eligible converted PT package allocation to 0; cancel the subscription if revoking unused entitlement.',
        );
      }

      const updatedQuota = await tx.subscriptionQuota.update({
        where: { id: quota.id },
        data: { allocated: newAllocated },
        include: { serviceType: true },
      });

      if (mirroredPurchase) {
        const nextStatus = computeNextStoredLegacyPurchaseStatus({
          currentStatus: mirroredPurchase.status,
          paymentStatus: mirroredPurchase.paymentStatus,
          cutoverEligible: mirroredPurchase.cutoverEligible,
          allocated: newAllocated,
          reserved: quota.reserved,
          used: quota.used,
        });
        await tx.ptPackagePurchase.update({
          where: { id: mirroredPurchase.id },
          data: {
            allocated: newAllocated,
            status: nextStatus,
          },
        });
      }

      const createdTx = await tx.quotaTransaction.create({
        data: {
          quotaId: quota.id,
          subscriptionId: quota.subscriptionId,
          ptPurchaseId: mirroredPurchase?.id ?? null,
          type: DbQuotaTransactionType.ADJUST,
          allocatedDelta,
          reservedDelta: 0,
          usedDelta: 0,
          idempotencyKey,
          reason,
          createdBy: actorId,
        },
      });

      const detail: SubscriptionQuotaDetail = {
        id: updatedQuota.id,
        subscriptionId: updatedQuota.subscriptionId,
        service: updatedQuota.serviceType.code,
        serviceName: updatedQuota.serviceType.name,
        unlimited: false,
        allocated: newAllocated,
        reserved: quota.reserved,
        used: quota.used,
        remaining: Math.max(0, newAllocated - quota.used - quota.reserved),
        updatedAt: updatedQuota.updatedAt.toISOString(),
      };

      await this.saveIdempotentMutationAudit(tx, {
        quotaTransactionId: createdTx.id,
        idempotencyKey,
        operation: 'QUOTA_ADJUST',
        actorId,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
  }

  private async preservesAssignedTrainer(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    booking: { subscriptionId: string; trainerId: string },
  ): Promise<boolean> {
    // Preserve existing unassigned historical bookings while they stay in their original period.
    if (subscriptionId === booking.subscriptionId) return true;
    const target = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { assignedTrainerId: true },
    });
    return target?.assignedTrainerId === booking.trainerId;
  }

  /**
   * Handles PT side-effects when a Gym subscription is cancelled:
   * - Only affects future BOOKED PT bookings that lose required Gym coverage or were sourced from the cancelled subscription.
   * - Re-points `subscriptionId` when another paid subscription still covers the appointment with the same assigned PT.
   * - Refunds held PT credits strictly once; preserves standalone and carried finite balances from other subscriptions.
   */
  async handleSubscriptionCancelledInTx(
    tx: Prisma.TransactionClient,
    params: {
      cancelledSubscriptionId: string;
      memberId: string;
      now: Date;
      actorId?: string | null;
      reason: string;
    },
  ): Promise<void> {
    // Retired PT history must not be rewritten by active Gym lifecycle jobs.
    if (!GYM_SERVICE_SCOPE.personalTraining) return;

    const { member, subscriptions } = await this.loadMemberPtStateInTx(
      tx,
      params.memberId,
    );

    const remainingCandidates = subscriptions
      .filter((s) => s.id !== params.cancelledSubscriptionId)
      .map(toCoverageCandidate);

    const futurePtBookings = await tx.ptBooking.findMany({
      where: {
        memberId: params.memberId,
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
        startsAt: { gte: params.now },
        OR: [
          { subscriptionId: params.cancelledSubscriptionId },
          { sourceSubscriptionId: params.cancelledSubscriptionId },
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    for (const booking of futurePtBookings) {
      const sourcedFromCancelled =
        booking.sourceSubscriptionId === params.cancelledSubscriptionId ||
        (booking.sourceSubscriptionId === null &&
          booking.quotaId !== null &&
          booking.subscriptionId === params.cancelledSubscriptionId);

      if (!sourcedFromCancelled) {
        const alternateCoverage = evaluateGymCoverageForSlot(
          remainingCandidates,
          booking.startsAt,
          booking.endsAt,
          {
            memberIsActive: member.user.isActive,
            referenceNow: params.now,
          },
        );

        if (
          alternateCoverage.covered &&
          alternateCoverage.coveringSubscriptionId &&
          (await this.preservesAssignedTrainer(
            tx,
            alternateCoverage.coveringSubscriptionId,
            booking,
          ))
        ) {
          await tx.ptBooking.update({
            where: { id: booking.id },
            data: { subscriptionId: alternateCoverage.coveringSubscriptionId },
          });
          continue;
        }
      }

      await tx.ptBooking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: params.now,
        },
      });

      await this.settleBookingCreditInTx(tx, {
        booking,
        settlement: 'REFUND',
        idempotencyKey: `cancel-sub-${params.cancelledSubscriptionId}-pt-${booking.id}`,
        actorId: params.actorId ?? null,
        reason: `Subscription cancelled (${params.reason}): Auto-refund held PT booking`,
      });
    }

    // Sync any LEGACY_BUNDLED purchase sourced from THIS cancelled subscription
    const sourceLegacyPurchase = await tx.ptPackagePurchase.findFirst({
      where: {
        origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
        sourceSubscriptionId: params.cancelledSubscriptionId,
      },
    });
    if (
      sourceLegacyPurchase &&
      sourceLegacyPurchase.status !== DbPtPurchaseStatus.REFUNDED
    ) {
      await tx.ptPackagePurchase.update({
        where: { id: sourceLegacyPurchase.id },
        data: { status: DbPtPurchaseStatus.CANCELLED },
      });
    }
  }

  /**
   * Handles already-booked Class & PT overlaps when a SubscriptionFreeze becomes APPROVED:
   * - Cancels & refunds overlapping ClassBookings on `subscriptionId`.
   * - Re-evaluates overlapping BOOKED PT appointments: re-points covering `subscriptionId` if another
   *   valid paid subscription covers the slot (and source is unaffected); otherwise cancels + refunds
   *   held PT credit once with recorded freeze reason and AuditLog.
   */
  async handleFreezeApprovedInTx(
    tx: Prisma.TransactionClient,
    params: {
      freezeId: string;
      subscriptionId: string;
      memberId: string;
      freezeStartsAt: Date;
      freezeEndsAt: Date;
      freezeReason?: string | null;
      actorId: string | null;
      now: Date;
    },
  ): Promise<void> {
    const reasonSuffix = params.freezeReason?.trim()
      ? ` (${params.freezeReason.trim()})`
      : '';

    // 1. Overlapping ClassBookings on the frozen subscription
    const overlappingClassBookings = await tx.classBooking.findMany({
      where: {
        subscriptionId: params.subscriptionId,
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
        schedule: {
          startsAt: { lt: params.freezeEndsAt },
          endsAt: { gt: params.freezeStartsAt },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const cb of overlappingClassBookings) {
      await tx.classBooking.update({
        where: { id: cb.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: params.now,
        },
      });

      const quota = await tx.subscriptionQuota.findUniqueOrThrow({
        where: { id: cb.quotaId },
      });
      if (quota.allocated !== null && quota.reserved > 0) {
        await tx.subscriptionQuota.update({
          where: { id: cb.quotaId },
          data: { reserved: { decrement: 1 } },
        });
      }

      await tx.quotaTransaction.create({
        data: {
          quotaId: cb.quotaId,
          subscriptionId: cb.subscriptionId,
          type: DbQuotaTransactionType.REFUND,
          allocatedDelta: 0,
          reservedDelta: quota.allocated === null ? 0 : -1,
          usedDelta: 0,
          idempotencyKey: `freeze-approve-${params.freezeId}-class-${cb.id}`,
          referenceType: 'CLASS_BOOKING',
          referenceId: cb.id,
          reason: `Huỷ tự động lịch lớp nhóm trùng kỳ bảo lưu${reasonSuffix}`,
          createdBy: params.actorId,
        },
      });
    }

    // Retired PT history must not be rewritten by active Gym lifecycle jobs.
    if (!GYM_SERVICE_SCOPE.personalTraining) return;

    // 2. Overlapping PT Bookings of the member
    const { member, subscriptions } = await this.loadMemberPtStateInTx(
      tx,
      params.memberId,
    );
    const coverageCandidates = subscriptions.map(toCoverageCandidate);

    const overlappingPtBookings = await tx.ptBooking.findMany({
      where: {
        memberId: params.memberId,
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
        startsAt: { lt: params.freezeEndsAt },
        endsAt: { gt: params.freezeStartsAt },
        OR: [
          { subscriptionId: params.subscriptionId },
          { sourceSubscriptionId: params.subscriptionId },
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    for (const pb of overlappingPtBookings) {
      const sourcedFromFrozen =
        pb.sourceSubscriptionId === params.subscriptionId ||
        (pb.sourceSubscriptionId === null &&
          pb.quotaId !== null &&
          pb.subscriptionId === params.subscriptionId);

      if (!sourcedFromFrozen) {
        const alternateCoverage = evaluateGymCoverageForSlot(
          coverageCandidates,
          pb.startsAt,
          pb.endsAt,
          {
            memberIsActive: member.user.isActive,
            referenceNow: params.now,
          },
        );
        if (
          alternateCoverage.covered &&
          alternateCoverage.coveringSubscriptionId &&
          (await this.preservesAssignedTrainer(
            tx,
            alternateCoverage.coveringSubscriptionId,
            pb,
          ))
        ) {
          if (alternateCoverage.coveringSubscriptionId !== pb.subscriptionId) {
            await tx.ptBooking.update({
              where: { id: pb.id },
              data: {
                subscriptionId: alternateCoverage.coveringSubscriptionId,
              },
            });
          }
          continue;
        }
      }

      const cancelReason = `Huỷ tự động lịch PT 1-1 trùng kỳ bảo lưu${reasonSuffix}`;
      await tx.ptBooking.update({
        where: { id: pb.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: params.now,
        },
      });

      const { quotaTransactionId } = await this.settleBookingCreditInTx(tx, {
        booking: pb,
        settlement: 'REFUND',
        idempotencyKey: `freeze-approve-${params.freezeId}-pt-${pb.id}`,
        actorId: params.actorId,
        reason: cancelReason,
      });

      await tx.auditLog.create({
        data: {
          actorId: params.actorId,
          action: 'PT_BOOKING_CANCELLED_BY_FREEZE',
          entityType: 'PT_BOOKING',
          entityId: pb.id,
          metadata: {
            freezeId: params.freezeId,
            subscriptionId: params.subscriptionId,
            quotaTransactionId,
            reason: cancelReason,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * After a freeze restores and shifts chained UPCOMING renewals forward, ensures any future BOOKED
   * PT appointments stay aligned with updated Gym coverage & upcoming-source start dates without double granting.
   */
  async handleFreezeRestoredInTx(
    tx: Prisma.TransactionClient,
    params: {
      freezeId: string;
      subscriptionId: string;
      memberId: string;
      actorId: string | null;
      now: Date;
    },
  ): Promise<void> {
    // Retired PT history must not be rewritten by active Gym lifecycle jobs.
    if (!GYM_SERVICE_SCOPE.personalTraining) return;

    const { member, subscriptions } = await this.loadMemberPtStateInTx(
      tx,
      params.memberId,
    );
    const coverageCandidates = subscriptions.map(toCoverageCandidate);
    const subById = new Map(subscriptions.map((s) => [s.id, s]));

    const futurePtBookings = await tx.ptBooking.findMany({
      where: {
        memberId: params.memberId,
        status: BookingStatus.BOOKED,
        attendance: AttendanceStatus.PENDING,
        startsAt: { gte: params.now },
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });

    for (const pb of futurePtBookings) {
      const sourceSub = pb.sourceSubscriptionId
        ? (subById.get(pb.sourceSubscriptionId) ?? null)
        : null;
      const sourceShiftedPastBooking =
        sourceSub !== null &&
        pb.startsAt.getTime() < sourceSub.startDate.getTime();

      const coverage = evaluateGymCoverageForSlot(
        coverageCandidates,
        pb.startsAt,
        pb.endsAt,
        {
          memberIsActive: member.user.isActive,
          referenceNow: params.now,
        },
      );

      if (
        !sourceShiftedPastBooking &&
        coverage.covered &&
        coverage.coveringSubscriptionId &&
        (await this.preservesAssignedTrainer(
          tx,
          coverage.coveringSubscriptionId,
          pb,
        ))
      ) {
        if (coverage.coveringSubscriptionId !== pb.subscriptionId) {
          await tx.ptBooking.update({
            where: { id: pb.id },
            data: { subscriptionId: coverage.coveringSubscriptionId },
          });
        }
        continue;
      }

      const reason =
        'Huỷ tự động lịch PT 1-1 do kỳ gia hạn dời ngày bắt đầu sau khi mở bảo lưu';
      await tx.ptBooking.update({
        where: { id: pb.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: params.now,
        },
      });

      await this.settleBookingCreditInTx(tx, {
        booking: pb,
        settlement: 'REFUND',
        idempotencyKey: `freeze-restore-${params.freezeId}-pt-${pb.id}`,
        actorId: params.actorId,
        reason,
      });
    }
  }

  /**
   * Synchronizes subscription `paymentStatus` (and JIT `ACTIVE` promotion), updates any mapped
   * `LEGACY_BUNDLED` `PtPackagePurchase`, and cancels/refunds affected future bookings if payment is revoked.
   */
  async syncSubscriptionPaymentInTx(
    tx: Prisma.TransactionClient,
    params: {
      subscriptionId: string;
      refunded?: boolean;
      reason?: string | null;
      actorId?: string | null;
      now?: Date;
    },
  ): Promise<void> {
    const now = params.now ?? new Date();
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: params.subscriptionId },
    });

    const paid = await tx.paymentRecord.aggregate({
      where: {
        subscriptionId: params.subscriptionId,
        status: DbPaymentStatus.PAID,
      },
      _sum: { amount: true },
    });
    const total = paid._sum.amount ?? new Prisma.Decimal(0);
    const settled = total.greaterThanOrEqualTo(sub.agreedPrice);

    const nextPaymentStatus: DbPaymentStatus = settled
      ? DbPaymentStatus.PAID
      : params.refunded && total.isZero()
        ? DbPaymentStatus.REFUNDED
        : DbPaymentStatus.PENDING;

    const activate =
      settled &&
      sub.status === SubscriptionStatus.UPCOMING &&
      sub.startDate <= now &&
      sub.endDate >= now;

    await tx.subscription.update({
      where: { id: params.subscriptionId },
      data: {
        paymentStatus: nextPaymentStatus,
        ...(activate
          ? { status: SubscriptionStatus.ACTIVE, activatedAt: now }
          : {}),
      },
    });

    // If subscription lost PAID status (partial or full refund), cancel/refund affected future bookings first
    if (nextPaymentStatus !== DbPaymentStatus.PAID && params.refunded) {
      const futureClassBookings = await tx.classBooking.findMany({
        where: {
          subscriptionId: params.subscriptionId,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
          schedule: { startsAt: { gte: now } },
        },
      });

      for (const cb of futureClassBookings) {
        await tx.classBooking.update({
          where: { id: cb.id },
          data: { status: BookingStatus.CANCELLED, cancelledAt: now },
        });
        const quota = await tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: cb.quotaId },
        });
        if (quota.allocated !== null && quota.reserved > 0) {
          await tx.subscriptionQuota.update({
            where: { id: cb.quotaId },
            data: { reserved: { decrement: 1 } },
          });
        }
        await tx.quotaTransaction.create({
          data: {
            quotaId: cb.quotaId,
            subscriptionId: cb.subscriptionId,
            type: DbQuotaTransactionType.REFUND,
            allocatedDelta: 0,
            reservedDelta: quota.allocated === null ? 0 : -1,
            usedDelta: 0,
            idempotencyKey: `refund-sub-${params.subscriptionId}-class-${cb.id}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: cb.id,
            reason: `Hoàn tiền gói tập: tự động hoàn lượt lớp nhóm`,
            createdBy: params.actorId ?? null,
          },
        });
      }

      // Gym settlement and group refunds above remain active; PT history below is frozen.
      if (!GYM_SERVICE_SCOPE.personalTraining) return;

      const { member, subscriptions } = await this.loadMemberPtStateInTx(
        tx,
        sub.memberId,
      );
      const coverageCandidates = subscriptions.map(toCoverageCandidate);

      const futurePtBookings = await tx.ptBooking.findMany({
        where: {
          memberId: sub.memberId,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
          startsAt: { gte: now },
          OR: [
            { subscriptionId: params.subscriptionId },
            { sourceSubscriptionId: params.subscriptionId },
          ],
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      });

      for (const pb of futurePtBookings) {
        const sourcedFromRefundedSub =
          pb.sourceSubscriptionId === params.subscriptionId ||
          (pb.sourceSubscriptionId === null &&
            pb.quotaId !== null &&
            pb.subscriptionId === params.subscriptionId);

        if (!sourcedFromRefundedSub) {
          const alt = evaluateGymCoverageForSlot(
            coverageCandidates,
            pb.startsAt,
            pb.endsAt,
            {
              memberIsActive: member.user.isActive,
              referenceNow: now,
            },
          );
          if (
            alt.covered &&
            alt.coveringSubscriptionId &&
            (await this.preservesAssignedTrainer(
              tx,
              alt.coveringSubscriptionId,
              pb,
            ))
          ) {
            if (alt.coveringSubscriptionId !== pb.subscriptionId) {
              await tx.ptBooking.update({
                where: { id: pb.id },
                data: { subscriptionId: alt.coveringSubscriptionId },
              });
            }
            continue;
          }
        }

        await tx.ptBooking.update({
          where: { id: pb.id },
          data: { status: BookingStatus.CANCELLED, cancelledAt: now },
        });

        await this.settleBookingCreditInTx(tx, {
          booking: pb,
          settlement: 'REFUND',
          idempotencyKey: `refund-sub-${params.subscriptionId}-pt-${pb.id}`,
          actorId: params.actorId ?? null,
          reason: `Hoàn tiền gói tập${params.reason ? ` (${params.reason})` : ''}: tự động hoàn buổi PT giữ chỗ`,
        });
      }
    }

    // Retired PT history must not be rewritten by active Gym lifecycle jobs.
    if (!GYM_SERVICE_SCOPE.personalTraining) return;

    // Sync mapped LEGACY_BUNDLED purchase if one exists for this subscription
    const legacyPurchase = await tx.ptPackagePurchase.findFirst({
      where: {
        origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
        sourceSubscriptionId: params.subscriptionId,
      },
    });
    if (legacyPurchase) {
      const nextStatus = computeNextStoredLegacyPurchaseStatus({
        currentStatus: legacyPurchase.status,
        paymentStatus: nextPaymentStatus,
        cutoverEligible: legacyPurchase.cutoverEligible,
        allocated: legacyPurchase.allocated,
        reserved: legacyPurchase.reserved,
        used: legacyPurchase.used,
        cancelled: sub.status === SubscriptionStatus.CANCELLED,
      });

      if (
        legacyPurchase.paymentStatus !== nextPaymentStatus ||
        legacyPurchase.status !== nextStatus
      ) {
        await tx.ptPackagePurchase.update({
          where: { id: legacyPurchase.id },
          data: {
            paymentStatus: nextPaymentStatus,
            status: nextStatus,
          },
        });
      }
    }
  }

  /**
   * Synchronizes a standalone `PtPackagePurchase` when a linked `PaymentRecord` is confirmed or refunded.
   */
  async syncStandalonePtPurchasePaymentInTx(
    tx: Prisma.TransactionClient,
    params: {
      ptPurchaseId: string;
      refunded?: boolean;
      reason?: string | null;
      actorId?: string | null;
      now?: Date;
    },
  ): Promise<void> {
    const now = params.now ?? new Date();
    const purchase = await tx.ptPackagePurchase.findUniqueOrThrow({
      where: { id: params.ptPurchaseId },
    });
    if (
      purchase.origin !== DbPtPurchaseOrigin.STANDALONE ||
      purchase.agreedPrice === null ||
      purchase.allocated === null
    ) {
      throw new ConflictException(
        `Gói PT (${purchase.id}) không phải gói bán rời hợp lệ để đồng bộ thanh toán.`,
      );
    }

    const paid = await tx.paymentRecord.aggregate({
      where: {
        ptPurchaseId: params.ptPurchaseId,
        status: DbPaymentStatus.PAID,
      },
      _sum: { amount: true },
    });
    const total = paid._sum.amount ?? new Prisma.Decimal(0);
    const settled = total.greaterThanOrEqualTo(purchase.agreedPrice);

    if (!settled && params.refunded) {
      if (purchase.used > 0) {
        throw new ConflictException(
          'Chỉ được hoàn tiền cho gói PT mua rời chưa sử dụng buổi tập nào.',
        );
      }

      const consumedBookingsCount = await tx.ptBooking.count({
        where: {
          ptPurchaseId: purchase.id,
          status: { in: [BookingStatus.COMPLETED, BookingStatus.NO_SHOW] },
        },
      });
      if (consumedBookingsCount > 0) {
        throw new ConflictException(
          'Chỉ được hoàn tiền cho gói PT mua rời chưa phát sinh buổi tập hoàn tất hoặc vắng mặt.',
        );
      }

      // Cancel & refund any active BOOKED appointments funded by this standalone PT purchase
      const heldBookings = await tx.ptBooking.findMany({
        where: {
          ptPurchaseId: purchase.id,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      });

      for (const pb of heldBookings) {
        await tx.ptBooking.update({
          where: { id: pb.id },
          data: { status: BookingStatus.CANCELLED, cancelledAt: now },
        });
        await this.settleBookingCreditInTx(tx, {
          booking: pb,
          settlement: 'REFUND',
          idempotencyKey: `refund-pt-purchase-${purchase.id}-pt-${pb.id}`,
          actorId: params.actorId ?? null,
          reason: `Hoàn tiền gói PT mua rời${params.reason ? ` (${params.reason})` : ''}: hoàn lượt giữ chỗ`,
        });
      }
    }

    const refreshed = await tx.ptPackagePurchase.findUniqueOrThrow({
      where: { id: params.ptPurchaseId },
    });
    if (refreshed.allocated === null) {
      throw new ConflictException(
        'Standalone PT purchase allocated cannot be null.',
      );
    }

    let nextPaymentStatus: DbPaymentStatus;
    if (settled) {
      nextPaymentStatus = DbPaymentStatus.PAID;
    } else if (params.refunded && total.isZero()) {
      nextPaymentStatus = DbPaymentStatus.REFUNDED;
    } else {
      if (refreshed.used > 0 || refreshed.reserved > 0) {
        throw new ConflictException(
          'Không thể hoàn một phần làm gói PT mua rời đã sử dụng quay về chờ thanh toán.',
        );
      }
      nextPaymentStatus = DbPaymentStatus.PENDING;
    }

    const nextStatus = deriveStandalonePtPurchaseStatus({
      paymentStatus: nextPaymentStatus as PaymentStatus,
      allocated: refreshed.allocated,
      reserved: refreshed.reserved,
      used: refreshed.used,
      cancelled: refreshed.status === DbPtPurchaseStatus.CANCELLED,
    });

    await tx.ptPackagePurchase.update({
      where: { id: refreshed.id },
      data: {
        paymentStatus: nextPaymentStatus,
        status: nextStatus as DbPtPurchaseStatus,
      },
    });
  }

  async getSelfPtCreditBalance(
    userId: string,
    now = new Date(),
  ): Promise<MemberPtCreditBalanceResponse> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException(
        'Member profile not found for the current authenticated user',
      );
    }
    return this.getMemberPtCreditBalance(profile.id, now);
  }

  async getMemberPtCreditBalance(
    memberId: string,
    now = new Date(),
  ): Promise<MemberPtCreditBalanceResponse> {
    return this.db.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );

      const { member, subscriptions, ptPurchases } =
        await this.loadMemberPtStateInTx(tx, memberId);
      const cutoverActive = await this.hasCutoverOccurredInTx(tx);

      const coverageNow = evaluateGymCoverageForSlot(
        subscriptions.map(toCoverageCandidate),
        now,
        new Date(now.getTime() + 1),
        {
          memberIsActive: member.user.isActive,
          referenceNow: now,
        },
      );

      const subById = new Map(subscriptions.map((s) => [s.id, s]));

      const spendablePurchasesInput: SpendablePtPurchaseLike[] =
        ptPurchases.map((p) => {
          const sourceSub = p.sourceSubscriptionId
            ? (subById.get(p.sourceSubscriptionId) ?? null)
            : null;
          return {
            id: p.id,
            memberId: p.memberId,
            origin: p.origin as PtPurchaseOrigin,
            legacyQuotaId: p.legacyQuotaId,
            storedStatus: p.status as PtPurchaseStatus,
            paymentStatus: p.paymentStatus as PaymentStatus,
            allocated: p.allocated,
            reserved: p.reserved,
            used: p.used,
            cutoverEligible: p.cutoverEligible,
            sourceSubscription: sourceSub
              ? toSourceSubscriptionState(sourceSub)
              : null,
          };
        });

      const allPtQuotas: Array<
        SpendableQuotaLike & {
          serviceName: string;
          sub: LoadedMemberSubscription;
        }
      > = [];
      const activeUnmirroredSubIds = new Set<string>();

      for (const sub of subscriptions) {
        const verifiedPayment = resolveVerifiedSubscriptionPaymentStatus(sub);
        const activeFreezeNow = sub.freezes.some(
          (f) =>
            f.status === FreezeStatus.APPROVED &&
            !f.restoredAt &&
            f.startsAt <= now &&
            f.endsAt > now,
        );
        const isLiveNow =
          verifiedPayment === PaymentStatus.PAID &&
          (sub.status === SubscriptionStatus.ACTIVE ||
            sub.status === SubscriptionStatus.UPCOMING) &&
          sub.startDate <= now &&
          sub.endDate >= now &&
          !activeFreezeNow;

        if (isLiveNow) {
          activeUnmirroredSubIds.add(sub.id);
        }

        for (const q of sub.quotas) {
          if (q.serviceType.code === ServiceTypeCode.PT) {
            allPtQuotas.push({
              id: q.id,
              subscriptionId: sub.id,
              service: q.serviceType.code,
              serviceName: q.serviceType.name,
              allocated: q.allocated,
              reserved: q.reserved,
              used: q.used,
              sub,
            });
          }
        }
      }

      const summary = summarizeSpendablePtCredits(
        allPtQuotas,
        spendablePurchasesInput,
        {
          now,
          activeUnmirroredSubscriptionIds: activeUnmirroredSubIds,
        },
      );

      const eligiblePurchaseIdSet = new Set(summary.eligiblePurchaseIds);
      const sources: PtCreditSourceBalanceItem[] = [];
      let finiteAllocatedTotal = 0;

      for (const p of ptPurchases) {
        const sourceSub = p.sourceSubscriptionId
          ? (subById.get(p.sourceSubscriptionId) ?? null)
          : null;
        const effStatus = effectivePtPurchaseStatus(
          {
            origin: p.origin as PtPurchaseOrigin,
            storedStatus: p.status as PtPurchaseStatus,
            paymentStatus: p.paymentStatus as PaymentStatus,
            allocated: p.allocated,
            reserved: p.reserved,
            used: p.used,
            cutoverEligible: p.cutoverEligible,
          },
          sourceSub ? toSourceSubscriptionState(sourceSub) : null,
          now,
        );
        const currentlySpendable = eligiblePurchaseIdSet.has(p.id);
        if (currentlySpendable && p.allocated !== null) {
          finiteAllocatedTotal += p.allocated;
        }

        sources.push({
          id: p.id,
          kind: 'PT_PURCHASE',
          origin: p.origin as PtPurchaseOrigin,
          ptPurchaseId: p.id,
          legacyQuotaId: p.legacyQuotaId,
          sourceSubscriptionId: p.sourceSubscriptionId,
          packageCode: p.packageCodeSnapshot,
          packageName: p.packageNameSnapshot,
          sessionMinutes: p.sessionMinutesSnapshot,
          unlimited: p.allocated === null,
          allocated: p.allocated,
          reserved: p.reserved,
          used: p.used,
          remaining:
            p.allocated === null
              ? null
              : Math.max(0, p.allocated - p.used - p.reserved),
          paymentStatus: p.paymentStatus as PaymentStatus,
          effectiveStatus: effStatus,
          cutoverEligible: p.cutoverEligible,
          currentlySpendable,
          originalStartDate: p.originalStartDate
            ? p.originalStartDate.toISOString()
            : null,
          originalEndDate: p.originalEndDate
            ? p.originalEndDate.toISOString()
            : null,
        });
      }

      const unmirroredQuotas = filterUnmirroredSubscriptionQuotas(
        allPtQuotas,
        spendablePurchasesInput,
      );
      for (const uq of unmirroredQuotas) {
        const remaining =
          uq.allocated === null
            ? null
            : Math.max(0, uq.allocated - uq.used - uq.reserved);
        const currentlySpendable =
          activeUnmirroredSubIds.has(uq.subscriptionId) &&
          (uq.allocated === null || (remaining ?? 0) >= 1 || uq.reserved > 0);
        if (currentlySpendable && uq.allocated !== null) {
          finiteAllocatedTotal += uq.allocated;
        }

        const verifiedPay = resolveVerifiedSubscriptionPaymentStatus(uq.sub);
        let effStatus = PtPurchaseStatus.ACTIVE;
        if (verifiedPay === PaymentStatus.REFUNDED) {
          effStatus = PtPurchaseStatus.REFUNDED;
        } else if (uq.sub.status === SubscriptionStatus.CANCELLED) {
          effStatus = PtPurchaseStatus.CANCELLED;
        } else if (now > uq.sub.endDate) {
          effStatus = PtPurchaseStatus.EXPIRED;
        } else if (verifiedPay === PaymentStatus.PENDING) {
          effStatus = PtPurchaseStatus.PENDING_PAYMENT;
        } else if (
          uq.allocated !== null &&
          uq.reserved === 0 &&
          uq.used === uq.allocated
        ) {
          effStatus = PtPurchaseStatus.EXHAUSTED;
        }

        sources.push({
          id: uq.id,
          kind: 'UNMIRRORED_LEGACY_QUOTA',
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          ptPurchaseId: null,
          legacyQuotaId: uq.id,
          sourceSubscriptionId: uq.subscriptionId,
          packageCode: 'LEGACY_PT',
          packageName: `${uq.sub.plan.name} — ${uq.serviceName}`,
          sessionMinutes: 60,
          unlimited: uq.allocated === null,
          allocated: uq.allocated,
          reserved: uq.reserved,
          used: uq.used,
          remaining,
          paymentStatus: verifiedPay,
          effectiveStatus: effStatus,
          cutoverEligible: null,
          currentlySpendable,
          originalStartDate: uq.sub.startDate.toISOString(),
          originalEndDate: uq.sub.endDate.toISOString(),
        });
      }

      return {
        memberId,
        asOf: now.toISOString(),
        cutoverActive,
        hasActiveGymCoverageNow: coverageNow.covered,
        coveringSubscriptionIdNow: coverageNow.coveringSubscriptionId,
        finiteAllocatedTotal,
        summary,
        sources,
      };
    });
  }
}
