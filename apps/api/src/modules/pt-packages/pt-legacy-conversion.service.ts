import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BookingStatus,
  PaymentStatus,
  PtPurchaseStatus,
  ServiceTypeCode,
  SubscriptionStatus,
  buildOrphanPtReservedReconcileKey,
  classifyLegacyPtQuotaAtCutover,
  type LegacyPtHistoricalReason,
  type PtConversionRowReconciliation,
  type PtCutoverVerificationReport,
  type PtHistoricalLedgerGapDiagnostic,
  type PtLegacyConversionReport,
  type PtOrphanReservationAnomalyCause,
  type PtOrphanReservationDiagnostic,
  type PtOrphanReservationReconcileResult,
  type PtPaymentTotalsSnapshot,
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

export interface RunLegacyPtConversionOptions {
  cutoverAt: Date | string;
  dryRun?: boolean;
  confirmRuntimeCutoverReady?: boolean;
  actorId?: string | null;
  injectFailureBeforeCommit?: boolean;
}

export interface ReconcileOrphanReservedQuotaOptions {
  quotaId: string;
  actorId: string;
  reason: string;
  expectedReleaseCount?: number;
  idempotencyKey?: string;
  injectFailureBeforeCommit?: boolean;
}

type StoredReconcileResultSnapshot = {
  quotaId: string;
  subscriptionId: string;
  memberId: string;
  ptPurchaseId: string | null;
  releasedCount: number;
  previousReserved: number;
  newReserved: number;
  activeBookedCount: number;
  preservedUsed: number;
  anomalyCause: PtOrphanReservationAnomalyCause | null;
  quotaTransactionId: string;
};

function buildReconcileRequestHash(payload: {
  quotaId: string;
  actorId: string;
  reason: string;
  expectedReleaseCount: number | null;
}): string {
  const entries = Object.entries(payload).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStoredReconcileAudit(
  metadata: Prisma.JsonValue | null | undefined,
): {
  requestHash: string;
  quotaTransactionId: string;
  resultSnapshot: StoredReconcileResultSnapshot;
} | null {
  if (!isJsonObject(metadata)) {
    return null;
  }
  const requestHash = metadata.requestHash;
  const quotaTransactionId = metadata.quotaTransactionId;
  const snapshot = metadata.resultSnapshot;
  if (
    typeof requestHash !== 'string' ||
    typeof quotaTransactionId !== 'string' ||
    !isJsonObject(snapshot)
  ) {
    return null;
  }

  const quotaId = snapshot.quotaId;
  const subscriptionId = snapshot.subscriptionId;
  const memberId = snapshot.memberId;
  const ptPurchaseId = snapshot.ptPurchaseId;
  const releasedCount = snapshot.releasedCount;
  const previousReserved = snapshot.previousReserved;
  const newReserved = snapshot.newReserved;
  const activeBookedCount = snapshot.activeBookedCount;
  const preservedUsed = snapshot.preservedUsed;
  const anomalyCause = snapshot.anomalyCause;
  const snapshotTxId = snapshot.quotaTransactionId;

  if (
    typeof quotaId !== 'string' ||
    typeof subscriptionId !== 'string' ||
    typeof memberId !== 'string' ||
    (ptPurchaseId !== null && typeof ptPurchaseId !== 'string') ||
    typeof releasedCount !== 'number' ||
    typeof previousReserved !== 'number' ||
    typeof newReserved !== 'number' ||
    typeof activeBookedCount !== 'number' ||
    typeof preservedUsed !== 'number' ||
    (anomalyCause !== null &&
      anomalyCause !== 'UNBACKED_INITIAL_RESERVED_BALANCE' &&
      anomalyCause !== 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT') ||
    typeof snapshotTxId !== 'string'
  ) {
    return null;
  }

  return {
    requestHash,
    quotaTransactionId,
    resultSnapshot: {
      quotaId,
      subscriptionId,
      memberId,
      ptPurchaseId,
      releasedCount,
      previousReserved,
      newReserved,
      activeBookedCount,
      preservedUsed,
      anomalyCause,
      quotaTransactionId: snapshotTxId,
    },
  };
}

function historicalReasonForStoredStatus(
  status: DbPtPurchaseStatus,
): LegacyPtHistoricalReason | null {
  switch (status) {
    case DbPtPurchaseStatus.REFUNDED:
      return 'REFUNDED_BEFORE_CUTOVER';
    case DbPtPurchaseStatus.CANCELLED:
      return 'CANCELLED_BEFORE_CUTOVER';
    case DbPtPurchaseStatus.EXPIRED:
      return 'EXPIRED_BEFORE_CUTOVER';
    case DbPtPurchaseStatus.EXHAUSTED:
      return 'ZERO_ALLOCATION';
    default:
      return null;
  }
}

type PaymentSnapshotInputRow = {
  subscriptionId: string | null;
  ptPurchaseId: string | null;
  amount: Prisma.Decimal;
  status: DbPaymentStatus;
  method: string | null;
};

function parseRequiredCutoverDate(value: Date | string | undefined): Date {
  if (!value) {
    throw new BadRequestException(
      'cutoverAt is required to classify legacy PT rights deterministically.',
    );
  }
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Invalid cutoverAt timestamp.');
  }
  return parsed;
}

function summarizePayments(
  payments: readonly PaymentSnapshotInputRow[],
): PtPaymentTotalsSnapshot {
  const snapshot: PtPaymentTotalsSnapshot = {
    totalCount: payments.length,
    subscriptionLinkedCount: 0,
    ptPurchaseLinkedCount: 0,
    paidTotalAmount: 0,
    pendingTotalAmount: 0,
    refundedTotalAmount: 0,
    cancelledTotalAmount: 0,
    paidByMethod: {
      CASH: 0,
      TRANSFER: 0,
      CARD: 0,
      OTHER: 0,
    },
  };

  for (const payment of payments) {
    if (payment.subscriptionId) {
      snapshot.subscriptionLinkedCount += 1;
    }
    if (payment.ptPurchaseId) {
      snapshot.ptPurchaseLinkedCount += 1;
    }

    const amount = Number(payment.amount);
    if (payment.status === DbPaymentStatus.PAID) {
      snapshot.paidTotalAmount += amount;
      const method = payment.method?.toUpperCase();
      if (method === 'CASH') {
        snapshot.paidByMethod.CASH += amount;
      } else if (method === 'TRANSFER') {
        snapshot.paidByMethod.TRANSFER += amount;
      } else if (method === 'CARD') {
        snapshot.paidByMethod.CARD += amount;
      } else {
        snapshot.paidByMethod.OTHER += amount;
      }
    } else if (payment.status === DbPaymentStatus.PENDING) {
      snapshot.pendingTotalAmount += amount;
    } else if (payment.status === DbPaymentStatus.REFUNDED) {
      snapshot.refundedTotalAmount += amount;
    } else if (payment.status === DbPaymentStatus.CANCELLED) {
      snapshot.cancelledTotalAmount += amount;
    }
  }

  return snapshot;
}

function paymentSnapshotsEqual(
  left: PtPaymentTotalsSnapshot,
  right: PtPaymentTotalsSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

@Injectable()
export class PtLegacyConversionService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Controlled, checkpointed conversion from legacy SubscriptionQuota(PT) to PtPackagePurchase.
   * Defaults to read-only dry-run; live writes require confirmRuntimeCutoverReady=true so
   * operational writes cannot drift from legacy writers prior to runtime cutover.
   */
  async runLegacyConversion(
    options: RunLegacyPtConversionOptions,
  ): Promise<PtLegacyConversionReport> {
    const cutoverDate = parseRequiredCutoverDate(options.cutoverAt);
    const dryRun = options.dryRun ?? true;

    if (!dryRun && options.confirmRuntimeCutoverReady !== true) {
      throw new ConflictException(
        'Legacy PT write conversion is blocked until confirmRuntimeCutoverReady=true confirms all runtime writers share the cutover protocol.',
      );
    }

    return this.db.client.$transaction(
      async (tx) => {
        if (dryRun) {
          await tx.$executeRawUnsafe(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
          );
        } else {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('gym-pt-cutover', 0))::text`;
          await lockScheduleWrites(tx);
          await tx.$executeRawUnsafe(
            'LOCK TABLE "plan_entitlements", "subscriptions", "subscription_quotas", "pt_bookings", "quota_transactions", "payment_records", "pt_package_purchases" IN SHARE ROW EXCLUSIVE MODE',
          );
        }

        const [
          existingLegacyPurchases,
          standalonePurchases,
          priorConversionAudits,
        ] = await Promise.all([
          tx.ptPackagePurchase.findMany({
            where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
          }),
          tx.ptPackagePurchase.findMany({
            where: { origin: DbPtPurchaseOrigin.STANDALONE },
          }),
          tx.auditLog.findMany({
            where: { action: 'PT_LEGACY_CONVERSION_EXECUTED' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        ]);

        for (const purchase of existingLegacyPurchases) {
          if (
            !purchase.cutoverAt ||
            purchase.cutoverAt.getTime() !== cutoverDate.getTime()
          ) {
            throw new ConflictException(
              `CUTOVER_CHECKPOINT_MISMATCH: Existing legacy purchase ${purchase.id} was converted at ${purchase.cutoverAt?.toISOString() ?? 'null'}, not ${cutoverDate.toISOString()}.`,
            );
          }
        }

        for (const audit of priorConversionAudits) {
          if (!isJsonObject(audit.metadata)) {
            continue;
          }
          const rawAuditCutover = audit.metadata.cutoverAt;
          if (typeof rawAuditCutover === 'string') {
            const parsedAuditCutover = new Date(rawAuditCutover);
            if (
              Number.isNaN(parsedAuditCutover.getTime()) ||
              parsedAuditCutover.getTime() !== cutoverDate.getTime()
            ) {
              throw new ConflictException(
                `CUTOVER_CHECKPOINT_MISMATCH: Existing conversion checkpoint in audit ${audit.id} was recorded at ${rawAuditCutover}, not ${cutoverDate.toISOString()}.`,
              );
            }
          }
        }

        const [ptQuotas, allPtBookings, ptRelatedTxs, paymentsBefore] =
          await Promise.all([
            tx.subscriptionQuota.findMany({
              where: { serviceType: { code: ServiceTypeCode.PT } },
              include: {
                serviceType: true,
                subscription: {
                  include: {
                    plan: true,
                  },
                },
              },
              orderBy: [
                { subscription: { createdAt: 'asc' } },
                { id: 'asc' },
              ],
            }),
            tx.ptBooking.findMany({
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
            tx.quotaTransaction.findMany({
              where: {
                OR: [
                  { quota: { serviceType: { code: ServiceTypeCode.PT } } },
                  { referenceType: 'PT_BOOKING' },
                  { ptPurchaseId: { not: null } },
                ],
              },
              include: {
                quota: {
                  include: {
                    serviceType: true,
                  },
                },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
            tx.paymentRecord.findMany({
              select: {
                subscriptionId: true,
                ptPurchaseId: true,
                amount: true,
                status: true,
                method: true,
              },
            }),
          ]);

        const ptQuotaById = new Map(ptQuotas.map((q) => [q.id, q]));
        const existingByQuotaId = new Map(
          existingLegacyPurchases
            .filter((p) => p.legacyQuotaId !== null)
            .map((p) => [p.legacyQuotaId as string, p]),
        );
        const existingById = new Map(
          existingLegacyPurchases.map((p) => [p.id, p]),
        );
        const standaloneById = new Map(
          standalonePurchases.map((p) => [p.id, p]),
        );

        // Reject any unmatched or cross-member/cross-quota sources rather than assigning the wrong owner.
        for (const purchase of existingLegacyPurchases) {
          if (!purchase.legacyQuotaId) {
            throw new ConflictException(
              `UNMATCHED_LEGACY_PURCHASE: Purchase ${purchase.id} is missing legacyQuotaId.`,
            );
          }
          const sourceQuota = ptQuotaById.get(purchase.legacyQuotaId);
          if (!sourceQuota) {
            throw new ConflictException(
              `UNMATCHED_LEGACY_PURCHASE: Purchase ${purchase.id} references missing PT quota ${purchase.legacyQuotaId}.`,
            );
          }
          if (
            purchase.memberId !== sourceQuota.subscription.memberId ||
            purchase.sourceSubscriptionId !== sourceQuota.subscriptionId ||
            purchase.allocated !== sourceQuota.allocated ||
            purchase.reserved !== sourceQuota.reserved ||
            purchase.used !== sourceQuota.used ||
            purchase.agreedPrice !== null ||
            purchase.currency !== null ||
            purchase.cutoverEligible === null
          ) {
            throw new ConflictException(
              `LEGACY_PURCHASE_DRIFT_DETECTED: Existing purchase ${purchase.id} no longer matches quota ${sourceQuota.id}.`,
            );
          }
        }

        const confirmedPaidBySubId = new Map<string, Prisma.Decimal>();
        const paymentCountBySubId = new Map<string, number>();
        for (const payment of paymentsBefore) {
          if (!payment.subscriptionId) {
            continue;
          }
          paymentCountBySubId.set(
            payment.subscriptionId,
            (paymentCountBySubId.get(payment.subscriptionId) ?? 0) + 1,
          );
          if (payment.status === DbPaymentStatus.PAID) {
            const current =
              confirmedPaidBySubId.get(payment.subscriptionId) ??
              new Prisma.Decimal(0);
            confirmedPaidBySubId.set(
              payment.subscriptionId,
              current.plus(payment.amount),
            );
          }
        }

        const bookingsByQuotaId = new Map<string, typeof allPtBookings>();
        for (const booking of allPtBookings) {
          if (booking.quotaId === null) {
            const standalone = booking.ptPurchaseId
              ? standaloneById.get(booking.ptPurchaseId) ?? null
              : null;
            if (
              !standalone ||
              booking.sourceSubscriptionId !== null ||
              standalone.memberId !== booking.memberId
            ) {
              throw new ConflictException(
                `UNMATCHED_PT_BOOKING_SOURCE: Standalone PtBooking ${booking.id} lacks a valid member-owned STANDALONE purchase.`,
              );
            }
            continue;
          }

          const sourceQuota = ptQuotaById.get(booking.quotaId);
          if (!sourceQuota) {
            throw new ConflictException(
              `UNMATCHED_PT_BOOKING_SOURCE: PtBooking ${booking.id} references non-PT or missing quota ${booking.quotaId}.`,
            );
          }
          const expectedSourceSubId =
            booking.sourceSubscriptionId ?? booking.subscriptionId;
          if (
            sourceQuota.subscriptionId !== expectedSourceSubId ||
            sourceQuota.subscription.memberId !== booking.memberId
          ) {
            throw new ConflictException(
              `UNMATCHED_PT_BOOKING_SOURCE: PtBooking ${booking.id} owner/sourceSubscription does not match quota ${booking.quotaId}.`,
            );
          }
          if (booking.ptPurchaseId !== null) {
            const linked = existingById.get(booking.ptPurchaseId);
            if (
              !linked ||
              linked.legacyQuotaId !== booking.quotaId ||
              linked.memberId !== booking.memberId
            ) {
              throw new ConflictException(
                `UNMATCHED_PT_BOOKING_PURCHASE: PtBooking ${booking.id} ptPurchaseId ${booking.ptPurchaseId} mismatches quota ${booking.quotaId}.`,
              );
            }
          }
          const group = bookingsByQuotaId.get(booking.quotaId) ?? [];
          group.push(booking);
          bookingsByQuotaId.set(booking.quotaId, group);
        }

        const txsByQuotaId = new Map<string, typeof ptRelatedTxs>();
        for (const txRow of ptRelatedTxs) {
          if (txRow.quotaId === null) {
            const standalone = txRow.ptPurchaseId
              ? standaloneById.get(txRow.ptPurchaseId) ?? null
              : null;
            if (!standalone || txRow.subscriptionId !== null) {
              throw new ConflictException(
                `UNMATCHED_PT_QUOTA_TRANSACTION_SOURCE: Standalone QuotaTransaction ${txRow.id} lacks a valid STANDALONE purchase.`,
              );
            }
            continue;
          }

          if (!txRow.quota || txRow.quota.serviceType.code !== ServiceTypeCode.PT) {
            throw new ConflictException(
              `UNMATCHED_PT_QUOTA_TRANSACTION_SOURCE: QuotaTransaction ${txRow.id} references non-PT quota ${txRow.quotaId}.`,
            );
          }
          if (txRow.quota.subscriptionId !== txRow.subscriptionId) {
            throw new ConflictException(
              `UNMATCHED_PT_QUOTA_TRANSACTION_SOURCE: QuotaTransaction ${txRow.id} subscriptionId mismatches quota ${txRow.quotaId}.`,
            );
          }
          if (txRow.ptPurchaseId !== null) {
            const linked = existingById.get(txRow.ptPurchaseId);
            if (
              !linked ||
              linked.legacyQuotaId !== txRow.quotaId ||
              linked.sourceSubscriptionId !== txRow.subscriptionId
            ) {
              throw new ConflictException(
                `UNMATCHED_PT_QUOTA_TRANSACTION_PURCHASE: QuotaTransaction ${txRow.id} ptPurchaseId ${txRow.ptPurchaseId} mismatches quota ${txRow.quotaId}.`,
              );
            }
          }
          const group = txsByQuotaId.get(txRow.quotaId) ?? [];
          group.push(txRow);
          txsByQuotaId.set(txRow.quotaId, group);
        }

        const paymentTotalsBefore = summarizePayments(paymentsBefore);

        const rows: PtConversionRowReconciliation[] = [];
        const orphanReservationCandidates: PtOrphanReservationDiagnostic[] = [];
        const historicalLedgerGaps: PtHistoricalLedgerGapDiagnostic[] = [];

        let createdPurchasesCount = 0;
        let syncedPurchasesCount = 0;
        let unchangedPurchasesCount = 0;
        let linkedBookingsCount = 0;
        let linkedTransactionsCount = 0;

        for (const quota of ptQuotas) {
          const sub = quota.subscription;
          const existingPurchase = existingByQuotaId.get(quota.id) ?? null;
          const paidSum =
            confirmedPaidBySubId.get(sub.id) ?? new Prisma.Decimal(0);
          const totalPaymentRecords = paymentCountBySubId.get(sub.id) ?? 0;

          let rowStatus: PtPurchaseStatus;
          let rowCutoverEligible: boolean;
          let rowHistoricalReason: LegacyPtHistoricalReason | null = null;
          let rowUnlimited = quota.allocated === null;
          let needsStatusSync = false;
          let syncPaymentStatus: DbPaymentStatus = sub.paymentStatus;
          let syncStatus: DbPtPurchaseStatus = DbPtPurchaseStatus.ACTIVE;

          if (!existingPurchase) {
            if (sub.createdAt.getTime() > cutoverDate.getTime()) {
              throw new ConflictException(
                `POST_CUTOVER_LEGACY_SOURCE_DETECTED: Subscription ${sub.id} was created at ${sub.createdAt.toISOString()}, after cutoverAt ${cutoverDate.toISOString()}.`,
              );
            }
            if (
              existingLegacyPurchases.length > 0 ||
              priorConversionAudits.length > 0
            ) {
              throw new ConflictException(
                `POST_CUTOVER_UNCONVERTED_QUOTA_DETECTED: Unconverted PT quota ${quota.id} appeared after initial cutover checkpoint ${cutoverDate.toISOString()}.`,
              );
            }
            if (
              sub.paymentStatus === DbPaymentStatus.PAID &&
              totalPaymentRecords > 0 &&
              paidSum.lessThan(sub.agreedPrice)
            ) {
              throw new ConflictException(
                `UNVERIFIED_SUBSCRIPTION_PAYMENT: Subscription ${sub.id} is marked PAID without confirmed PaymentRecord total covering agreedPrice.`,
              );
            }

            const classification = classifyLegacyPtQuotaAtCutover({
              cutoverAt: cutoverDate,
              subscriptionStatus: sub.status as SubscriptionStatus,
              paymentStatus: sub.paymentStatus as PaymentStatus,
              startDate: sub.startDate,
              endDate: sub.endDate,
              allocated: quota.allocated,
              reserved: quota.reserved,
              used: quota.used,
            });
            rowStatus = classification.status;
            rowCutoverEligible = classification.cutoverEligible;
            rowHistoricalReason = classification.historicalReason;
            rowUnlimited = classification.unlimited;
          } else {
            rowCutoverEligible = Boolean(existingPurchase.cutoverEligible);
            let desiredPaymentStatus = existingPurchase.paymentStatus;
            let desiredStatus = existingPurchase.status;

            if (!rowCutoverEligible) {
              if (sub.paymentStatus === DbPaymentStatus.REFUNDED) {
                desiredPaymentStatus = DbPaymentStatus.REFUNDED;
                desiredStatus = DbPtPurchaseStatus.REFUNDED;
              } else {
                desiredStatus = existingPurchase.status;
                desiredPaymentStatus =
                  existingPurchase.status === DbPtPurchaseStatus.REFUNDED
                    ? DbPaymentStatus.REFUNDED
                    : sub.paymentStatus;
              }
              rowHistoricalReason = historicalReasonForStoredStatus(desiredStatus);
            } else {
              if (
                sub.paymentStatus === DbPaymentStatus.REFUNDED ||
                existingPurchase.status === DbPtPurchaseStatus.REFUNDED
              ) {
                desiredPaymentStatus = DbPaymentStatus.REFUNDED;
                desiredStatus = DbPtPurchaseStatus.REFUNDED;
              } else if (
                sub.status === SubscriptionStatus.CANCELLED ||
                sub.paymentStatus === DbPaymentStatus.CANCELLED ||
                existingPurchase.status === DbPtPurchaseStatus.CANCELLED
              ) {
                desiredPaymentStatus = sub.paymentStatus;
                desiredStatus = DbPtPurchaseStatus.CANCELLED;
              } else if (sub.paymentStatus === DbPaymentStatus.PENDING) {
                desiredPaymentStatus = DbPaymentStatus.PENDING;
                desiredStatus = DbPtPurchaseStatus.PENDING_PAYMENT;
              } else {
                if (
                  (existingPurchase.paymentStatus === DbPaymentStatus.PENDING ||
                    totalPaymentRecords > 0) &&
                  paidSum.lessThan(sub.agreedPrice)
                ) {
                  throw new ConflictException(
                    `UNVERIFIED_SUBSCRIPTION_PAYMENT: Cannot activate legacy purchase ${existingPurchase.id} without confirmed PaymentRecord total covering agreedPrice.`,
                  );
                }
                desiredPaymentStatus = DbPaymentStatus.PAID;
                if (existingPurchase.status === DbPtPurchaseStatus.EXPIRED) {
                  desiredStatus = DbPtPurchaseStatus.EXPIRED;
                } else if (
                  quota.allocated !== null &&
                  quota.reserved === 0 &&
                  quota.used === quota.allocated
                ) {
                  desiredStatus = DbPtPurchaseStatus.EXHAUSTED;
                } else {
                  desiredStatus = DbPtPurchaseStatus.ACTIVE;
                }
              }
            }

            rowStatus = desiredStatus as PtPurchaseStatus;
            syncPaymentStatus = desiredPaymentStatus;
            syncStatus = desiredStatus;
            needsStatusSync =
              existingPurchase.status !== desiredStatus ||
              existingPurchase.paymentStatus !== desiredPaymentStatus;
          }

          const bookingsForQuota = bookingsByQuotaId.get(quota.id) ?? [];
          const txsForQuota = txsByQuotaId.get(quota.id) ?? [];

          const activeBookedCount = bookingsForQuota.filter(
            (b) => b.status === BookingStatus.BOOKED,
          ).length;
          const netLedgerReservedDelta = txsForQuota.reduce(
            (sum, row) => sum + row.reservedDelta,
            0,
          );
          const netLedgerUsedDelta = txsForQuota.reduce(
            (sum, row) => sum + row.usedDelta,
            0,
          );
          const completedOrNoShowCount = bookingsForQuota.filter(
            (b) =>
              b.status === BookingStatus.COMPLETED ||
              b.status === BookingStatus.NO_SHOW,
          ).length;

          if (
            quota.allocated !== null &&
            quota.reserved > activeBookedCount
          ) {
            const anomalyCause: PtOrphanReservationAnomalyCause =
              netLedgerReservedDelta > 0
                ? 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT'
                : 'UNBACKED_INITIAL_RESERVED_BALANCE';

            orphanReservationCandidates.push({
              quotaId: quota.id,
              subscriptionId: quota.subscriptionId,
              memberId: sub.memberId,
              ptPurchaseId: existingPurchase?.id ?? null,
              allocated: quota.allocated,
              reservedInQuota: quota.reserved,
              usedInQuota: quota.used,
              activeBookedCount,
              confirmedOrphanCount: quota.reserved - activeBookedCount,
              netLedgerReservedDelta,
              anomalyCause,
              suggestedIdempotencyKey: buildOrphanPtReservedReconcileKey(
                quota.id,
              ),
            });
          }

          if (
            (quota.used > 0 || quota.reserved > 0) &&
            (txsForQuota.length === 0 ||
              netLedgerUsedDelta < quota.used ||
              quota.used > completedOrNoShowCount)
          ) {
            historicalLedgerGaps.push({
              quotaId: quota.id,
              subscriptionId: quota.subscriptionId,
              memberId: sub.memberId,
              allocated: quota.allocated,
              reservedInQuota: quota.reserved,
              usedInQuota: quota.used,
              recordedBookingCount: bookingsForQuota.length,
              ledgerTransactionCount: txsForQuota.length,
              netLedgerUsedDelta,
              preservedOpeningUsed: Math.max(
                0,
                quota.used - netLedgerUsedDelta,
              ),
            });
          }

          const unlinkedBookings = bookingsForQuota.filter(
            (b) => b.ptPurchaseId === null,
          );
          const unlinkedTxs = txsForQuota.filter(
            (row) => row.ptPurchaseId === null,
          );

          let targetPurchaseId = existingPurchase?.id ?? null;
          let action: PtConversionRowReconciliation['action'];

          if (!existingPurchase) {
            if (dryRun) {
              action = 'WOULD_CREATE';
            } else {
              const created = await tx.ptPackagePurchase.create({
                data: {
                  memberId: sub.memberId,
                  origin: DbPtPurchaseOrigin.LEGACY_BUNDLED,
                  ptPlanId: null,
                  sourceSubscriptionId: quota.subscriptionId,
                  legacyQuotaId: quota.id,
                  packageCodeSnapshot: 'LEGACY_PT',
                  packageNameSnapshot: `${sub.plan.name} — ${quota.serviceType.name}`,
                  sessionCountSnapshot: quota.allocated,
                  sessionMinutesSnapshot: 60,
                  allocated: quota.allocated,
                  reserved: quota.reserved,
                  used: quota.used,
                  agreedPrice: null,
                  currency: null,
                  paymentStatus: sub.paymentStatus,
                  status: rowStatus as DbPtPurchaseStatus,
                  originalStartDate: sub.startDate,
                  originalEndDate: sub.endDate,
                  cutoverAt: cutoverDate,
                  cutoverEligible: rowCutoverEligible,
                  createdBy: options.actorId ?? null,
                },
              });
              targetPurchaseId = created.id;
              action = 'CREATED';
              createdPurchasesCount += 1;
            }
          } else if (needsStatusSync) {
            if (dryRun) {
              action = 'WOULD_SYNC_STATUS';
            } else {
              await tx.ptPackagePurchase.update({
                where: { id: existingPurchase.id },
                data: {
                  paymentStatus: syncPaymentStatus,
                  status: syncStatus,
                },
              });
              action = 'SYNCED_STATUS';
            }
            syncedPurchasesCount += 1;
          } else {
            action = 'UNCHANGED';
            unchangedPurchasesCount += 1;
          }

          if (!dryRun && targetPurchaseId) {
            if (unlinkedBookings.length > 0) {
              const updatedBookings = await tx.ptBooking.updateMany({
                where: {
                  quotaId: quota.id,
                  ptPurchaseId: null,
                },
                data: {
                  ptPurchaseId: targetPurchaseId,
                },
              });
              linkedBookingsCount += updatedBookings.count;
            }

            if (unlinkedTxs.length > 0) {
              const updatedTxs = await tx.quotaTransaction.updateMany({
                where: {
                  quotaId: quota.id,
                  subscriptionId: quota.subscriptionId,
                  ptPurchaseId: null,
                },
                data: {
                  ptPurchaseId: targetPurchaseId,
                },
              });
              linkedTransactionsCount += updatedTxs.count;
            }
          } else {
            linkedBookingsCount += unlinkedBookings.length;
            linkedTransactionsCount += unlinkedTxs.length;
          }

          rows.push({
            quotaId: quota.id,
            subscriptionId: quota.subscriptionId,
            memberId: sub.memberId,
            ptPurchaseId: targetPurchaseId,
            action,
            status: rowStatus,
            cutoverEligible: rowCutoverEligible,
            historicalReason: rowHistoricalReason,
            unlimited: rowUnlimited,
            allocated: quota.allocated,
            reserved: quota.reserved,
            used: quota.used,
            agreedPrice: null,
            linkedBookingsCount: unlinkedBookings.length,
            linkedTransactionsCount: unlinkedTxs.length,
          });
        }

        let paymentTotalsAfter = paymentTotalsBefore;
        let recordedInitialAuditOnEmptyDb = false;

        if (!dryRun) {
          // Strip forward-looking bundled PT catalog templates from Gym membership plans at cutover
          // while preserving all already-purchased SubscriptionQuota and PaymentRecord snapshots.
          const deletedPlanPtEntitlements = await tx.planEntitlement.deleteMany({
            where: {
              serviceType: { code: ServiceTypeCode.PT },
            },
          });

          const [
            convertedRows,
            unlinkedPtBookingsAfter,
            unlinkedPtTxsAfter,
            paymentsAfter,
          ] = await Promise.all([
            tx.ptPackagePurchase.findMany({
              where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
            }),
            tx.ptBooking.count({
              where: { quotaId: { not: null }, ptPurchaseId: null },
            }),
            tx.quotaTransaction.count({
              where: {
                quotaId: { not: null },
                quota: { serviceType: { code: ServiceTypeCode.PT } },
                ptPurchaseId: null,
              },
            }),
            tx.paymentRecord.findMany({
              select: {
                subscriptionId: true,
                ptPurchaseId: true,
                amount: true,
                status: true,
                method: true,
              },
            }),
          ]);

          if (convertedRows.length !== ptQuotas.length) {
            throw new ConflictException(
              `RECONCILIATION_MISMATCH: Expected ${ptQuotas.length} converted PT purchases, found ${convertedRows.length}.`,
            );
          }

          const convertedByQuotaId = new Map(
            convertedRows.map((row) => [row.legacyQuotaId, row]),
          );
          for (const quota of ptQuotas) {
            const converted = convertedByQuotaId.get(quota.id);
            if (
              !converted ||
              converted.memberId !== quota.subscription.memberId ||
              converted.sourceSubscriptionId !== quota.subscriptionId ||
              converted.allocated !== quota.allocated ||
              converted.reserved !== quota.reserved ||
              converted.used !== quota.used ||
              converted.agreedPrice !== null ||
              converted.currency !== null
            ) {
              throw new ConflictException(
                `RECONCILIATION_MISMATCH: Converted purchase for quota ${quota.id} failed per-row verification.`,
              );
            }
          }

          if (unlinkedPtBookingsAfter !== 0 || unlinkedPtTxsAfter !== 0) {
            throw new ConflictException(
              `RECONCILIATION_MISMATCH: Remaining unlinked records after conversion (bookings=${unlinkedPtBookingsAfter}, transactions=${unlinkedPtTxsAfter}).`,
            );
          }

          paymentTotalsAfter = summarizePayments(paymentsAfter);
          if (!paymentSnapshotsEqual(paymentTotalsBefore, paymentTotalsAfter)) {
            throw new ConflictException(
              'RECONCILIATION_MISMATCH: Payment totals mutated during legacy PT conversion.',
            );
          }

          if (options.injectFailureBeforeCommit) {
            throw new ConflictException(
              'INJECTED_CONVERSION_ROLLBACK_FAILURE',
            );
          }

          if (
            createdPurchasesCount > 0 ||
            syncedPurchasesCount > 0 ||
            linkedBookingsCount > 0 ||
            linkedTransactionsCount > 0 ||
            deletedPlanPtEntitlements.count > 0 ||
            priorConversionAudits.length === 0
          ) {
            if (
              createdPurchasesCount === 0 &&
              syncedPurchasesCount === 0 &&
              linkedBookingsCount === 0 &&
              linkedTransactionsCount === 0
            ) {
              recordedInitialAuditOnEmptyDb = true;
            }
            await tx.auditLog.create({
              data: {
                actorId: options.actorId ?? null,
                action: 'PT_LEGACY_CONVERSION_EXECUTED',
                entityType: 'PT_PACKAGE_PURCHASE',
                metadata: {
                  cutoverAt: cutoverDate.toISOString(),
                  totalLegacyQuotas: ptQuotas.length,
                  createdPurchasesCount,
                  syncedPurchasesCount,
                  unchangedPurchasesCount,
                  linkedBookingsCount,
                  linkedTransactionsCount,
                  removedBundledPtPlanEntitlementsCount:
                    deletedPlanPtEntitlements.count,
                  orphanCandidatesCount: orphanReservationCandidates.length,
                  historicalLedgerGapsCount: historicalLedgerGaps.length,
                } as Prisma.InputJsonValue,
              },
            });
          }
        }

        const idempotentNoOp =
          !dryRun &&
          !recordedInitialAuditOnEmptyDb &&
          createdPurchasesCount === 0 &&
          syncedPurchasesCount === 0 &&
          linkedBookingsCount === 0 &&
          linkedTransactionsCount === 0;

        return {
          dryRun,
          cutoverAt: cutoverDate.toISOString(),
          idempotentNoOp,
          totalLegacyQuotas: ptQuotas.length,
          createdPurchasesCount,
          syncedPurchasesCount,
          unchangedPurchasesCount,
          linkedBookingsCount,
          linkedTransactionsCount,
          orphanReservationCandidates,
          historicalLedgerGaps,
          paymentTotalsBefore,
          paymentTotalsAfter,
          rows,
        };
      },
      { timeout: 30000 },
    );
  }

  /**
   * Read-only diagnostic listing confirmed orphan reserved counts on finite PT quotas.
   */
  async inspectOrphanReservations(options?: {
    quotaId?: string;
  }): Promise<PtOrphanReservationDiagnostic[]> {
    return this.db.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );

      const quotas = await tx.subscriptionQuota.findMany({
        where: {
          ...(options?.quotaId ? { id: options.quotaId } : {}),
          serviceType: { code: ServiceTypeCode.PT },
        },
        include: {
          subscription: true,
          ptPackagePurchases: {
            where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
          },
          ptBookings: true,
          transactions: true,
        },
        orderBy: [{ subscription: { createdAt: 'asc' } }, { id: 'asc' }],
      });

      const diagnostics: PtOrphanReservationDiagnostic[] = [];
      for (const quota of quotas) {
        if (quota.allocated === null) {
          continue;
        }
        const activeBookedCount = quota.ptBookings.filter(
          (b) => b.status === BookingStatus.BOOKED,
        ).length;
        if (quota.reserved <= activeBookedCount) {
          continue;
        }
        const netLedgerReservedDelta = quota.transactions.reduce(
          (sum, row) => sum + row.reservedDelta,
          0,
        );
        const anomalyCause: PtOrphanReservationAnomalyCause =
          netLedgerReservedDelta > 0
            ? 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT'
            : 'UNBACKED_INITIAL_RESERVED_BALANCE';

        diagnostics.push({
          quotaId: quota.id,
          subscriptionId: quota.subscriptionId,
          memberId: quota.subscription.memberId,
          ptPurchaseId: quota.ptPackagePurchases[0]?.id ?? null,
          allocated: quota.allocated,
          reservedInQuota: quota.reserved,
          usedInQuota: quota.used,
          activeBookedCount,
          confirmedOrphanCount: quota.reserved - activeBookedCount,
          netLedgerReservedDelta,
          anomalyCause,
          suggestedIdempotencyKey: buildOrphanPtReservedReconcileKey(quota.id),
        });
      }

      return diagnostics;
    });
  }

  /**
   * Releases ONLY confirmed orphan reserved credit after verifying real BOOKED appointments.
   * Preserves historical used balances, uses a deterministic idempotency key, and writes AuditLog.
   */
  async reconcileOrphanReservedQuota(
    options: ReconcileOrphanReservedQuotaOptions,
  ): Promise<PtOrphanReservationReconcileResult> {
    const quotaId = options.quotaId?.trim();
    const actorId = options.actorId?.trim();
    const reason = options.reason?.trim();

    if (!quotaId) {
      throw new BadRequestException('quotaId is required');
    }
    if (!actorId) {
      throw new BadRequestException('actorId is required');
    }
    if (!reason) {
      throw new BadRequestException(
        'reason is required for orphan reservation reconciliation',
      );
    }

    if (
      options.expectedReleaseCount !== undefined &&
      (!Number.isInteger(options.expectedReleaseCount) ||
        options.expectedReleaseCount <= 0)
    ) {
      throw new BadRequestException(
        'expectedReleaseCount must be a positive integer when provided',
      );
    }

    const idempotencyKey =
      options.idempotencyKey?.trim() ||
      buildOrphanPtReservedReconcileKey(quotaId);
    const reconcileRequestHash = buildReconcileRequestHash({
      quotaId,
      actorId,
      reason,
      expectedReleaseCount: options.expectedReleaseCount ?? null,
    });

    return this.db.client.$transaction(
      async (tx) => {
        await lockScheduleWrites(tx);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))::text`;

        const existingTx = await tx.quotaTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (existingTx) {
          if (
            existingTx.referenceType !==
              'ORPHAN_RESERVATION_RECONCILIATION' ||
            existingTx.referenceId !== quotaId ||
            existingTx.quotaId !== quotaId
          ) {
            throw new ConflictException(
              `Idempotency key "${idempotencyKey}" already belongs to another transaction.`,
            );
          }

          if (
            existingTx.reason !== reason ||
            existingTx.createdBy !== actorId
          ) {
            throw new ConflictException(
              `IDEMPOTENCY_PAYLOAD_MISMATCH: Reconciliation idempotency key "${idempotencyKey}" was already used with different actor or reason.`,
            );
          }

          const candidateAudits = await tx.auditLog.findMany({
            where: {
              action: 'PT_ORPHAN_RESERVATION_RECONCILED',
              entityType: 'SUBSCRIPTION_QUOTA',
              entityId: quotaId,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });

          let matchedAuditId: string | null = null;
          let matchedParsed: ReturnType<typeof parseStoredReconcileAudit> = null;
          for (const entry of candidateAudits) {
            const parsed = parseStoredReconcileAudit(entry.metadata);
            if (parsed && parsed.quotaTransactionId === existingTx.id) {
              matchedAuditId = entry.id;
              matchedParsed = parsed;
              break;
            }
          }

          if (
            !matchedParsed ||
            matchedParsed.requestHash !== reconcileRequestHash
          ) {
            throw new ConflictException(
              `IDEMPOTENCY_PAYLOAD_MISMATCH: Reconciliation idempotency key "${idempotencyKey}" was already executed with different parameters.`,
            );
          }

          return {
            ...matchedParsed.resultSnapshot,
            idempotencyKey,
            idempotentReplay: true,
            auditLogId: matchedAuditId,
          };
        }

        const quotaHeader = await tx.subscriptionQuota.findUnique({
          where: { id: quotaId },
          select: {
            id: true,
            subscriptionId: true,
            subscription: {
              select: { memberId: true },
            },
          },
        });
        if (!quotaHeader) {
          throw new NotFoundException(
            `SubscriptionQuota "${quotaId}" not found`,
          );
        }

        // Topological lock order: member_profiles -> subscriptions -> subscription_quotas -> pt_package_purchases -> pt_bookings
        await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${quotaHeader.subscription.memberId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${quotaHeader.subscriptionId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM subscription_quotas WHERE id = ${quotaId}::uuid FOR UPDATE`;

        const quota = await tx.subscriptionQuota.findUnique({
          where: { id: quotaId },
          include: {
            serviceType: true,
            subscription: true,
            ptPackagePurchases: {
              where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
            },
          },
        });
        if (!quota) {
          throw new NotFoundException(
            `SubscriptionQuota "${quotaId}" not found`,
          );
        }
        if (quota.serviceType.code !== ServiceTypeCode.PT) {
          throw new BadRequestException(
            'Orphan PT reservation reconciliation only supports PT quotas.',
          );
        }
        if (quota.allocated === null) {
          throw new ConflictException(
            'Unlimited PT quota cannot have finite orphan reserved credits.',
          );
        }

        const mirroredPurchase = quota.ptPackagePurchases[0] ?? null;
        if (mirroredPurchase) {
          await tx.$queryRaw`SELECT id FROM pt_package_purchases WHERE id = ${mirroredPurchase.id}::uuid FOR UPDATE`;
          if (
            mirroredPurchase.allocated !== quota.allocated ||
            mirroredPurchase.reserved !== quota.reserved ||
            mirroredPurchase.used !== quota.used
          ) {
            throw new ConflictException(
              `Mirrored purchase ${mirroredPurchase.id} balances are out of sync with quota ${quota.id}.`,
            );
          }
        }

        // Lock member bookings in deterministic ID order so no concurrent booking can race with orphan detection.
        await tx.$queryRaw`SELECT id FROM pt_bookings WHERE member_id = ${quota.subscription.memberId}::uuid ORDER BY id ASC FOR UPDATE`;

        const relatedBookings = await tx.ptBooking.findMany({
          where: {
            OR: [
              { quotaId: quota.id },
              ...(mirroredPurchase
                ? [{ ptPurchaseId: mirroredPurchase.id }]
                : []),
            ],
          },
        });

        const subscriptionBookedCount = await tx.ptBooking.count({
          where: {
            status: BookingStatus.BOOKED,
            OR: [
              { sourceSubscriptionId: quota.subscriptionId },
              {
                sourceSubscriptionId: null,
                quotaId: { not: null },
                subscriptionId: quota.subscriptionId,
              },
            ],
          },
        });

        const activeBookedBookings = relatedBookings.filter(
          (booking) => booking.status === BookingStatus.BOOKED,
        );
        if (subscriptionBookedCount > activeBookedBookings.length) {
          throw new ConflictException(
            'Cannot reconcile orphan reservation: subscription has BOOKED PT appointments not matched to this quota.',
          );
        }

        const confirmedOrphanCount =
          quota.reserved - activeBookedBookings.length;
        if (confirmedOrphanCount <= 0) {
          throw new ConflictException(
            'Refusing release: reserved PT balance is fully backed by active BOOKED appointment(s).',
          );
        }

        if (
          options.expectedReleaseCount !== undefined &&
          options.expectedReleaseCount !== confirmedOrphanCount
        ) {
          throw new ConflictException(
            `Confirmed orphan count (${confirmedOrphanCount}) does not match expectedReleaseCount (${options.expectedReleaseCount}).`,
          );
        }

        const quotaTxs = await tx.quotaTransaction.findMany({
          where: { quotaId: quota.id },
        });
        const netLedgerReservedDelta = quotaTxs.reduce(
          (sum, row) => sum + row.reservedDelta,
          0,
        );
        const anomalyCause: PtOrphanReservationAnomalyCause =
          netLedgerReservedDelta > 0
            ? 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT'
            : 'UNBACKED_INITIAL_RESERVED_BALANCE';

        const previousReserved = quota.reserved;
        const newReserved = previousReserved - confirmedOrphanCount;

        await tx.subscriptionQuota.update({
          where: { id: quota.id },
          data: { reserved: newReserved },
        });

        if (mirroredPurchase) {
          let nextPurchaseStatus = mirroredPurchase.status;
          if (
            mirroredPurchase.cutoverEligible === true &&
            mirroredPurchase.paymentStatus === DbPaymentStatus.PAID &&
            mirroredPurchase.allocated !== null &&
            newReserved === 0 &&
            mirroredPurchase.used === mirroredPurchase.allocated
          ) {
            nextPurchaseStatus = DbPtPurchaseStatus.EXHAUSTED;
          }

          await tx.ptPackagePurchase.update({
            where: { id: mirroredPurchase.id },
            data: {
              reserved: newReserved,
              status: nextPurchaseStatus,
            },
          });
        }

        const refundTx = await tx.quotaTransaction.create({
          data: {
            quotaId: quota.id,
            subscriptionId: quota.subscriptionId,
            ptPurchaseId: mirroredPurchase?.id ?? null,
            type: DbQuotaTransactionType.REFUND,
            allocatedDelta: 0,
            reservedDelta: -confirmedOrphanCount,
            usedDelta: 0,
            idempotencyKey,
            referenceType: 'ORPHAN_RESERVATION_RECONCILIATION',
            referenceId: quota.id,
            reason,
            createdBy: actorId,
          },
        });

        const resultSnapshot: StoredReconcileResultSnapshot = {
          quotaId: quota.id,
          subscriptionId: quota.subscriptionId,
          memberId: quota.subscription.memberId,
          ptPurchaseId: mirroredPurchase?.id ?? null,
          releasedCount: confirmedOrphanCount,
          previousReserved,
          newReserved,
          activeBookedCount: activeBookedBookings.length,
          preservedUsed: quota.used,
          anomalyCause,
          quotaTransactionId: refundTx.id,
        };

        const audit = await tx.auditLog.create({
          data: {
            actorId,
            action: 'PT_ORPHAN_RESERVATION_RECONCILED',
            entityType: 'SUBSCRIPTION_QUOTA',
            entityId: quota.id,
            metadata: {
              subscriptionId: quota.subscriptionId,
              memberId: quota.subscription.memberId,
              ptPurchaseId: mirroredPurchase?.id ?? null,
              quotaTransactionId: refundTx.id,
              idempotencyKey,
              requestHash: reconcileRequestHash,
              requestPayload: {
                quotaId,
                actorId,
                reason,
                expectedReleaseCount: options.expectedReleaseCount ?? null,
              },
              resultSnapshot,
              anomalyCause,
              previousReserved,
              newReserved,
              releasedCount: confirmedOrphanCount,
              activeBookedCount: activeBookedBookings.length,
              preservedUsed: quota.used,
              reason,
            } as Prisma.InputJsonValue,
          },
        });

        if (options.injectFailureBeforeCommit) {
          throw new ConflictException(
            'INJECTED_ORPHAN_RECONCILE_ROLLBACK_FAILURE',
          );
        }

        return {
          ...resultSnapshot,
          idempotencyKey,
          idempotentReplay: false,
          auditLogId: audit.id,
        };
      },
      { timeout: 15000 },
    );
  }

  /**
   * Read-only post-cutover verification of converted legacy PT purchases, bookings,
   * transactions, orphan reservation candidates, and payment totals.
   */
  async verifyCutoverState(): Promise<PtCutoverVerificationReport> {
    return this.db.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );

      const [
        ptQuotas,
        legacyPurchases,
        standalonePurchasesCount,
        unlinkedLegacyPtBookingsCount,
        unlinkedLegacyPtTransactionsCount,
        payments,
        conversionAudits,
        residualBundledPtPlanEntitlementsCount,
      ] = await Promise.all([
        tx.subscriptionQuota.findMany({
          where: { serviceType: { code: ServiceTypeCode.PT } },
          include: {
            subscription: true,
            ptBookings: true,
            transactions: true,
          },
          orderBy: [{ subscription: { createdAt: 'asc' } }, { id: 'asc' }],
        }),
        tx.ptPackagePurchase.findMany({
          where: { origin: DbPtPurchaseOrigin.LEGACY_BUNDLED },
        }),
        tx.ptPackagePurchase.count({
          where: { origin: DbPtPurchaseOrigin.STANDALONE },
        }),
        tx.ptBooking.count({
          where: { quotaId: { not: null }, ptPurchaseId: null },
        }),
        tx.quotaTransaction.count({
          where: {
            quotaId: { not: null },
            quota: { serviceType: { code: ServiceTypeCode.PT } },
            ptPurchaseId: null,
          },
        }),
        tx.paymentRecord.findMany({
          select: {
            subscriptionId: true,
            ptPurchaseId: true,
            amount: true,
            status: true,
            method: true,
          },
        }),
        tx.auditLog.findMany({
          where: { action: 'PT_LEGACY_CONVERSION_EXECUTED' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        tx.planEntitlement.count({
          where: { serviceType: { code: ServiceTypeCode.PT } },
        }),
      ]);

      const issues: string[] = [];
      const cutoverActive =
        legacyPurchases.length > 0 || conversionAudits.length > 0;

      const distinctCutoverTimestamps = new Set<string>();
      for (const p of legacyPurchases) {
        if (p.cutoverAt) {
          distinctCutoverTimestamps.add(p.cutoverAt.toISOString());
        } else {
          issues.push(
            `Legacy PT purchase ${p.id} is missing cutoverAt checkpoint.`,
          );
        }
      }
      for (const audit of conversionAudits) {
        const meta = audit.metadata;
        if (isJsonObject(meta) && typeof meta.cutoverAt === 'string') {
          distinctCutoverTimestamps.add(meta.cutoverAt);
        }
      }

      if (distinctCutoverTimestamps.size > 1) {
        issues.push(
          `Multiple cutoverAt checkpoints detected: ${[...distinctCutoverTimestamps].join(', ')}`,
        );
      }

      const recordedCutoverAt: string | null =
        distinctCutoverTimestamps.size === 1
          ? ([...distinctCutoverTimestamps][0] ?? null)
          : null;

      const purchaseByQuotaId = new Map<
        string,
        (typeof legacyPurchases)[number]
      >();
      for (const p of legacyPurchases) {
        if (p.legacyQuotaId) {
          purchaseByQuotaId.set(p.legacyQuotaId, p);
        } else {
          issues.push(`Legacy PT purchase ${p.id} is missing legacyQuotaId.`);
        }
      }

      let unconvertedLegacyQuotasCount = 0;
      let driftedLegacyPurchasesCount = 0;
      const orphanReservationCandidates: PtOrphanReservationDiagnostic[] = [];

      for (const quota of ptQuotas) {
        const mapped = purchaseByQuotaId.get(quota.id) ?? null;
        if (!mapped) {
          unconvertedLegacyQuotasCount += 1;
        } else if (
          mapped.memberId !== quota.subscription.memberId ||
          mapped.sourceSubscriptionId !== quota.subscriptionId ||
          mapped.allocated !== quota.allocated ||
          mapped.reserved !== quota.reserved ||
          mapped.used !== quota.used ||
          mapped.agreedPrice !== null ||
          mapped.currency !== null
        ) {
          driftedLegacyPurchasesCount += 1;
          issues.push(
            `Balance or ownership drift between PT quota ${quota.id} and purchase ${mapped.id}.`,
          );
        }

        if (quota.allocated !== null) {
          const activeBookedCount = quota.ptBookings.filter(
            (b) => b.status === BookingStatus.BOOKED,
          ).length;
          if (quota.reserved > activeBookedCount) {
            const netLedgerReservedDelta = quota.transactions.reduce(
              (sum, row) => sum + row.reservedDelta,
              0,
            );
            orphanReservationCandidates.push({
              quotaId: quota.id,
              subscriptionId: quota.subscriptionId,
              memberId: quota.subscription.memberId,
              ptPurchaseId: mapped?.id ?? null,
              allocated: quota.allocated,
              reservedInQuota: quota.reserved,
              usedInQuota: quota.used,
              activeBookedCount,
              confirmedOrphanCount: quota.reserved - activeBookedCount,
              netLedgerReservedDelta,
              anomalyCause:
                netLedgerReservedDelta > 0
                  ? 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT'
                  : 'UNBACKED_INITIAL_RESERVED_BALANCE',
              suggestedIdempotencyKey: buildOrphanPtReservedReconcileKey(
                quota.id,
              ),
            });
          }
        }
      }

      if (!cutoverActive) {
        issues.push('Legacy PT conversion has not been executed yet.');
      }
      if (unconvertedLegacyQuotasCount > 0) {
        issues.push(
          `${unconvertedLegacyQuotasCount} legacy PT quota(s) are not converted.`,
        );
      }
      if (unlinkedLegacyPtBookingsCount > 0) {
        issues.push(
          `${unlinkedLegacyPtBookingsCount} legacy PT booking(s) have null ptPurchaseId.`,
        );
      }
      if (unlinkedLegacyPtTransactionsCount > 0) {
        issues.push(
          `${unlinkedLegacyPtTransactionsCount} legacy PT transaction(s) have null ptPurchaseId.`,
        );
      }
      if (cutoverActive && residualBundledPtPlanEntitlementsCount > 0) {
        issues.push(
          `${residualBundledPtPlanEntitlementsCount} membership plan(s) still contain bundled PT entitlement(s).`,
        );
      }

      return {
        verifiedAt: new Date().toISOString(),
        cutoverActive,
        recordedCutoverAt,
        totalLegacyPtQuotas: ptQuotas.length,
        totalLegacyPurchases: legacyPurchases.length,
        totalStandalonePurchases: standalonePurchasesCount,
        unconvertedLegacyQuotasCount,
        unlinkedLegacyPtBookingsCount,
        unlinkedLegacyPtTransactionsCount,
        driftedLegacyPurchasesCount,
        orphanReservationCandidates,
        paymentTotals: summarizePayments(payments),
        readyForRuntime: cutoverActive && issues.length === 0,
        issues,
      };
    });
  }
}
