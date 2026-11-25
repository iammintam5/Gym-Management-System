import {
  GYM_DOMAIN_RULES,
  PaymentStatus,
  QuotaSummary,
  ServiceTypeCode,
} from '../common';
import { FreezeStatus } from '../freezes';
import { SubscriptionStatus } from '../subscriptions';

export enum PtPurchaseOrigin {
  STANDALONE = 'STANDALONE',
  LEGACY_BUNDLED = 'LEGACY_BUNDLED',
}

export enum PtPurchaseStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ACTIVE = 'ACTIVE',
  EXHAUSTED = 'EXHAUSTED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export const PT_PACKAGE_SAMPLE_CODES = ['PT1', 'PT5', 'PT10', 'PT20'] as const;
export type DefaultPtPackageCode = (typeof PT_PACKAGE_SAMPLE_CODES)[number];

export interface PtPackagePlanSeedSpec {
  code: DefaultPtPackageCode;
  name: string;
  description: string;
  sessionCount: number;
  sessionMinutes: 60;
  price: number;
}

export const DEFAULT_PT_PACKAGE_PLANS: readonly PtPackagePlanSeedSpec[] = [
  {
    code: 'PT1',
    name: 'Gói PT 1 buổi',
    description: 'Gói tập PT 1-1 gồm 1 buổi, thời lượng 60 phút mỗi buổi.',
    sessionCount: 1,
    sessionMinutes: 60,
    price: 500_000,
  },
  {
    code: 'PT5',
    name: 'Gói PT 5 buổi',
    description: 'Gói tập PT 1-1 gồm 5 buổi, thời lượng 60 phút mỗi buổi.',
    sessionCount: 5,
    sessionMinutes: 60,
    price: 2_250_000,
  },
  {
    code: 'PT10',
    name: 'Gói PT 10 buổi',
    description: 'Gói tập PT 1-1 gồm 10 buổi, thời lượng 60 phút mỗi buổi.',
    sessionCount: 10,
    sessionMinutes: 60,
    price: 4_000_000,
  },
  {
    code: 'PT20',
    name: 'Gói PT 20 buổi',
    description: 'Gói tập PT 1-1 gồm 20 buổi, thời lượng 60 phút mỗi buổi.',
    sessionCount: 20,
    sessionMinutes: 60,
    price: 7_000_000,
  },
] as const;

export interface PtPackagePlanSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sessionCount: number;
  sessionMinutes: number;
  price: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PtPackagePlanDetail = PtPackagePlanSummary;

export interface CreatePtPackagePlanInput {
  code: string;
  name: string;
  description?: string;
  sessionCount: number;
  price: number;
  isActive?: boolean;
}

export type UpdatePtPackagePlanInput = Partial<CreatePtPackagePlanInput>;

export interface PurchasePtPackageInput {
  memberId: string;
  ptPlanId: string;
  idempotencyKey: string;
  paymentMethod: 'CASH' | 'TRANSFER';
  expectedPrice: number;
  expectedPlanUpdatedAt: string;
  note?: string;
}

export interface PtPackageSaleResult {
  purchase: PtPackagePurchaseDetail;
  paymentId: string;
}

export interface PtPackagePurchaseHistoryItem extends PtPackagePurchaseDetail {
  paymentId: string | null;
}

export interface PaginatedPtPackagePurchasesResponse {
  data: PtPackagePurchaseHistoryItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface PtPackagePurchaseDetail {
  id: string;
  memberId: string;
  origin: PtPurchaseOrigin;
  ptPlanId: string | null;
  sourceSubscriptionId: string | null;
  legacyQuotaId: string | null;
  packageCodeSnapshot: string | null;
  packageNameSnapshot: string;
  sessionCountSnapshot: number | null;
  sessionMinutesSnapshot: number;
  unlimited: boolean;
  allocated: number | null;
  reserved: number;
  used: number;
  remaining: number | null;
  agreedPrice: number | null;
  currency: string | null;
  paymentStatus: PaymentStatus;
  storedStatus: PtPurchaseStatus;
  effectiveStatus: PtPurchaseStatus;
  originalStartDate: string | null;
  originalEndDate: string | null;
  cutoverAt: string | null;
  cutoverEligible: boolean | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LegacyPtHistoricalReason =
  | 'REFUNDED_BEFORE_CUTOVER'
  | 'CANCELLED_BEFORE_CUTOVER'
  | 'EXPIRED_BEFORE_CUTOVER'
  | 'ZERO_ALLOCATION';

export interface LegacyPtQuotaClassificationInput {
  cutoverAt: Date | string;
  subscriptionStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  startDate: Date | string;
  endDate: Date | string;
  allocated: number | null;
  reserved: number;
  used: number;
}

export interface LegacyPtQuotaClassificationResult {
  cutoverAt: string;
  cutoverEligible: boolean;
  status: PtPurchaseStatus;
  historicalReason: LegacyPtHistoricalReason | null;
  unlimited: boolean;
}

export interface GymCoverageFreezeWindow {
  id?: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status: FreezeStatus | string;
  restoredAt: Date | string | null;
}

export interface GymCoverageSubscriptionCandidate {
  id: string;
  memberId: string;
  status: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  startDate: Date | string;
  endDate: Date | string;
  freezes?: readonly GymCoverageFreezeWindow[];
}

export type GymCoverageFailureReason =
  | 'MEMBER_INACTIVE'
  | 'NO_PAID_SUBSCRIPTION_FOR_INTERVAL'
  | 'FROZEN_DURING_INTERVAL'
  | 'SUSPENDED_WITHOUT_RESTORE_WINDOW';

export interface GymCoverageEvaluationResult {
  covered: boolean;
  coveringSubscriptionId: string | null;
  coveringSubscriptionStatus: SubscriptionStatus | null;
  reason: GymCoverageFailureReason | null;
}

export interface PtCreditSourceSubscriptionState {
  id: string;
  memberId: string;
  status: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  startDate: Date | string;
  endDate: Date | string;
  agreedPrice?: number;
  confirmedPaidAmount?: number;
  freezes?: readonly GymCoverageFreezeWindow[];
}

export interface PtCreditSourceCandidate {
  id: string;
  memberId: string;
  origin: PtPurchaseOrigin;
  storedStatus: PtPurchaseStatus;
  paymentStatus: PaymentStatus;
  allocated: number | null;
  reserved: number;
  used: number;
  cutoverEligible: boolean | null;
  createdAt: Date | string;
  sourceSubscription?: PtCreditSourceSubscriptionState | null;
}

export type PtCreditSelectionReason =
  'SELECTED' | 'NO_ELIGIBLE_PT_CREDIT_SOURCE';

export interface PtCreditSourceSelectionResult {
  selectedPurchaseId: string | null;
  selectedOrigin: PtPurchaseOrigin | null;
  reason: PtCreditSelectionReason;
  eligiblePurchaseIds: string[];
}

export type PtOrphanReservationAnomalyCause =
  | 'UNBACKED_INITIAL_RESERVED_BALANCE'
  | 'DANGLING_LEDGER_RESERVE_WITHOUT_BOOKED_APPOINTMENT';

export interface PtOrphanReservationDiagnostic {
  quotaId: string;
  subscriptionId: string;
  memberId: string;
  ptPurchaseId: string | null;
  allocated: number | null;
  reservedInQuota: number;
  usedInQuota: number;
  activeBookedCount: number;
  confirmedOrphanCount: number;
  netLedgerReservedDelta: number;
  anomalyCause: PtOrphanReservationAnomalyCause;
  suggestedIdempotencyKey: string;
}

export interface PtHistoricalLedgerGapDiagnostic {
  quotaId: string;
  subscriptionId: string;
  memberId: string;
  allocated: number | null;
  reservedInQuota: number;
  usedInQuota: number;
  recordedBookingCount: number;
  ledgerTransactionCount: number;
  netLedgerUsedDelta: number;
  preservedOpeningUsed: number;
}

export interface PtConversionRowReconciliation {
  quotaId: string;
  subscriptionId: string;
  memberId: string;
  ptPurchaseId: string | null;
  action:
    | 'WOULD_CREATE'
    | 'CREATED'
    | 'WOULD_SYNC_STATUS'
    | 'SYNCED_STATUS'
    | 'UNCHANGED';
  status: PtPurchaseStatus;
  cutoverEligible: boolean;
  historicalReason: LegacyPtHistoricalReason | null;
  unlimited: boolean;
  allocated: number | null;
  reserved: number;
  used: number;
  agreedPrice: null;
  linkedBookingsCount: number;
  linkedTransactionsCount: number;
}

export interface PtPaymentTotalsSnapshot {
  totalCount: number;
  subscriptionLinkedCount: number;
  ptPurchaseLinkedCount: number;
  paidTotalAmount: number;
  pendingTotalAmount: number;
  refundedTotalAmount: number;
  cancelledTotalAmount: number;
  paidByMethod: {
    CASH: number;
    TRANSFER: number;
    CARD: number;
    OTHER: number;
  };
}

export interface PtLegacyConversionReport {
  dryRun: boolean;
  cutoverAt: string;
  idempotentNoOp: boolean;
  totalLegacyQuotas: number;
  createdPurchasesCount: number;
  syncedPurchasesCount: number;
  unchangedPurchasesCount: number;
  linkedBookingsCount: number;
  linkedTransactionsCount: number;
  orphanReservationCandidates: PtOrphanReservationDiagnostic[];
  historicalLedgerGaps: PtHistoricalLedgerGapDiagnostic[];
  paymentTotalsBefore: PtPaymentTotalsSnapshot;
  paymentTotalsAfter: PtPaymentTotalsSnapshot;
  rows: PtConversionRowReconciliation[];
}

export interface PtOrphanReservationReconcileResult {
  quotaId: string;
  subscriptionId: string;
  memberId: string;
  ptPurchaseId: string | null;
  idempotencyKey: string;
  idempotentReplay: boolean;
  releasedCount: number;
  previousReserved: number;
  newReserved: number;
  activeBookedCount: number;
  preservedUsed: number;
  anomalyCause: PtOrphanReservationAnomalyCause | null;
  quotaTransactionId: string;
  auditLogId: string | null;
}

export interface PtCatalogInitializationResult {
  dryRun: boolean;
  createdCodes: DefaultPtPackageCode[];
  existingCodes: DefaultPtPackageCode[];
  plans: PtPackagePlanDetail[];
}

export interface SpendableQuotaLike extends QuotaSummary {
  id: string;
  subscriptionId: string;
  service: string;
}

export interface SpendablePtPurchaseLike {
  id: string;
  memberId?: string;
  origin: PtPurchaseOrigin;
  legacyQuotaId: string | null;
  storedStatus: PtPurchaseStatus;
  paymentStatus: PaymentStatus;
  allocated: number | null;
  reserved: number;
  used: number;
  cutoverEligible: boolean | null;
  sourceSubscription?: PtCreditSourceSubscriptionState | null;
}

export interface SpendablePtCreditsSummary {
  scope: 'PT_CREDIT_BALANCE_ONLY';
  requiresSeparateGymCoverage: true;
  hasUnlimited: boolean;
  finiteRemaining: number;
  finiteReserved: number;
  finiteUsed: number;
  eligiblePurchaseIds: string[];
  unmirroredLegacyQuotaIds: string[];
}

export type PtCreditSourceBalanceKind =
  'PT_PURCHASE' | 'UNMIRRORED_LEGACY_QUOTA';

export interface PtCreditSourceBalanceItem {
  id: string;
  kind: PtCreditSourceBalanceKind;
  origin: PtPurchaseOrigin;
  ptPurchaseId: string | null;
  legacyQuotaId: string | null;
  sourceSubscriptionId: string | null;
  packageCode: string | null;
  packageName: string;
  sessionMinutes: number;
  unlimited: boolean;
  allocated: number | null;
  reserved: number;
  used: number;
  remaining: number | null;
  paymentStatus: PaymentStatus;
  effectiveStatus: PtPurchaseStatus;
  cutoverEligible: boolean | null;
  currentlySpendable: boolean;
  originalStartDate: string | null;
  originalEndDate: string | null;
}

export interface MemberPtCreditBalanceResponse {
  memberId: string;
  asOf: string;
  cutoverActive: boolean;
  hasActiveGymCoverageNow: boolean;
  coveringSubscriptionIdNow: string | null;
  finiteAllocatedTotal: number;
  summary: SpendablePtCreditsSummary;
  sources: PtCreditSourceBalanceItem[];
}

export interface PtCutoverVerificationReport {
  verifiedAt: string;
  cutoverActive: boolean;
  recordedCutoverAt: string | null;
  totalLegacyPtQuotas: number;
  totalLegacyPurchases: number;
  totalStandalonePurchases: number;
  unconvertedLegacyQuotasCount: number;
  unlinkedLegacyPtBookingsCount: number;
  unlinkedLegacyPtTransactionsCount: number;
  driftedLegacyPurchasesCount: number;
  orphanReservationCandidates: PtOrphanReservationDiagnostic[];
  paymentTotals: PtPaymentTotalsSnapshot;
  readyForRuntime: boolean;
  issues: string[];
}

function parseValidDate(value: Date | string, fieldName: string): Date {
  const parsed =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date for ${fieldName}`);
  }
  return parsed;
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function hasActiveFreezeForInterval(
  freezes: readonly GymCoverageFreezeWindow[] | undefined,
  slotStartMs: number,
  slotEndMs: number,
  subscriptionStatus: SubscriptionStatus,
): 'OK' | 'FROZEN_OVERLAP' | 'SUSPENDED_NO_ACTIVE_FREEZE' {
  const activeFreezes = (freezes ?? []).filter(
    (freeze) => freeze.status === FreezeStatus.APPROVED && !freeze.restoredAt,
  );
  for (const freeze of activeFreezes) {
    const freezeStartMs = parseValidDate(
      freeze.startsAt,
      'freeze.startsAt',
    ).getTime();
    const freezeEndMs = parseValidDate(
      freeze.endsAt,
      'freeze.endsAt',
    ).getTime();
    if (freezeEndMs <= freezeStartMs) {
      throw new Error('freeze.endsAt must be after freeze.startsAt');
    }
    if (freezeStartMs < slotEndMs && freezeEndMs > slotStartMs) {
      return 'FROZEN_OVERLAP';
    }
  }
  if (
    subscriptionStatus === SubscriptionStatus.SUSPENDED &&
    activeFreezes.length === 0
  ) {
    return 'SUSPENDED_NO_ACTIVE_FREEZE';
  }
  return 'OK';
}

function resolveSourcePaymentStatus(
  source: Pick<
    PtCreditSourceSubscriptionState,
    'paymentStatus' | 'agreedPrice' | 'confirmedPaidAmount'
  >,
): PaymentStatus {
  if (
    source.paymentStatus === PaymentStatus.PAID &&
    typeof source.agreedPrice === 'number' &&
    typeof source.confirmedPaidAmount === 'number' &&
    source.confirmedPaidAmount < source.agreedPrice
  ) {
    return PaymentStatus.PENDING;
  }
  return source.paymentStatus;
}

export function buildOrphanPtReservedReconcileKey(quotaId: string): string {
  const normalized = quotaId.trim().toLowerCase();
  if (!normalized) {
    throw new Error('quotaId is required to build an orphan reconcile key');
  }
  return `${GYM_DOMAIN_RULES.PT_PACKAGES.ORPHAN_RECONCILE_KEY_PREFIX}${normalized}`;
}

export function isStandalonePtPurchaseOpen(status: PtPurchaseStatus): boolean {
  return (
    status === PtPurchaseStatus.PENDING_PAYMENT ||
    status === PtPurchaseStatus.ACTIVE
  );
}

export function deriveStandalonePtPurchaseStatus(params: {
  paymentStatus: PaymentStatus;
  allocated: number;
  reserved: number;
  used: number;
  cancelled?: boolean;
}): PtPurchaseStatus {
  if (!Number.isInteger(params.allocated) || params.allocated <= 0) {
    throw new Error(
      'Standalone PT allocated sessions must be a positive integer',
    );
  }
  assertNonNegativeInteger(params.reserved, 'reserved');
  assertNonNegativeInteger(params.used, 'used');
  if (params.reserved + params.used > params.allocated) {
    throw new Error('reserved + used cannot exceed allocated sessions');
  }

  if (params.paymentStatus === PaymentStatus.REFUNDED) {
    if (params.reserved !== 0) {
      throw new Error(
        'Cannot refund standalone PT purchase while reserved > 0',
      );
    }
    if (params.used !== 0) {
      throw new Error('Cannot refund standalone PT purchase while used > 0');
    }
    return PtPurchaseStatus.REFUNDED;
  }

  if (params.cancelled || params.paymentStatus === PaymentStatus.CANCELLED) {
    if (params.reserved !== 0) {
      throw new Error(
        'Cannot cancel standalone PT purchase while reserved > 0',
      );
    }
    return PtPurchaseStatus.CANCELLED;
  }

  if (params.paymentStatus === PaymentStatus.PENDING) {
    if (params.reserved !== 0 || params.used !== 0) {
      throw new Error(
        'Pending-payment standalone PT purchase cannot have reserved or used sessions',
      );
    }
    return PtPurchaseStatus.PENDING_PAYMENT;
  }

  if (params.reserved === 0 && params.used === params.allocated) {
    return PtPurchaseStatus.EXHAUSTED;
  }

  return PtPurchaseStatus.ACTIVE;
}

export function classifyLegacyPtQuotaAtCutover(
  input: LegacyPtQuotaClassificationInput,
): LegacyPtQuotaClassificationResult {
  const cutoverDate = parseValidDate(input.cutoverAt, 'cutoverAt');
  const startDate = parseValidDate(input.startDate, 'startDate');
  const endDate = parseValidDate(input.endDate, 'endDate');
  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error('Legacy subscription endDate must be after startDate');
  }

  assertNonNegativeInteger(input.reserved, 'reserved');
  assertNonNegativeInteger(input.used, 'used');
  if (input.allocated !== null) {
    assertNonNegativeInteger(input.allocated, 'allocated');
    if (input.reserved + input.used > input.allocated) {
      throw new Error('Legacy quota reserved + used cannot exceed allocated');
    }
  }

  const unlimited = input.allocated === null;
  const cutoverAtIso = cutoverDate.toISOString();

  if (input.paymentStatus === PaymentStatus.REFUNDED) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: false,
      status: PtPurchaseStatus.REFUNDED,
      historicalReason: 'REFUNDED_BEFORE_CUTOVER',
      unlimited,
    };
  }

  if (
    input.subscriptionStatus === SubscriptionStatus.CANCELLED ||
    input.paymentStatus === PaymentStatus.CANCELLED
  ) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: false,
      status: PtPurchaseStatus.CANCELLED,
      historicalReason: 'CANCELLED_BEFORE_CUTOVER',
      unlimited,
    };
  }

  if (
    input.subscriptionStatus === SubscriptionStatus.EXPIRED ||
    ((input.subscriptionStatus === SubscriptionStatus.ACTIVE ||
      input.subscriptionStatus === SubscriptionStatus.UPCOMING) &&
      cutoverDate.getTime() > endDate.getTime())
  ) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: false,
      status: PtPurchaseStatus.EXPIRED,
      historicalReason: 'EXPIRED_BEFORE_CUTOVER',
      unlimited,
    };
  }

  if (input.allocated === 0) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: false,
      status: PtPurchaseStatus.EXHAUSTED,
      historicalReason: 'ZERO_ALLOCATION',
      unlimited: false,
    };
  }

  if (input.paymentStatus === PaymentStatus.PENDING) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: true,
      status: PtPurchaseStatus.PENDING_PAYMENT,
      historicalReason: null,
      unlimited,
    };
  }

  if (
    input.allocated !== null &&
    input.reserved === 0 &&
    input.used === input.allocated
  ) {
    return {
      cutoverAt: cutoverAtIso,
      cutoverEligible: true,
      status: PtPurchaseStatus.EXHAUSTED,
      historicalReason: null,
      unlimited: false,
    };
  }

  return {
    cutoverAt: cutoverAtIso,
    cutoverEligible: true,
    status: PtPurchaseStatus.ACTIVE,
    historicalReason: null,
    unlimited,
  };
}

export function effectivePtPurchaseStatus(
  purchase: {
    origin: PtPurchaseOrigin;
    storedStatus: PtPurchaseStatus;
    paymentStatus: PaymentStatus;
    allocated: number | null;
    reserved: number;
    used: number;
    cutoverEligible: boolean | null;
  },
  sourceSubscription?: Pick<
    PtCreditSourceSubscriptionState,
    | 'status'
    | 'paymentStatus'
    | 'endDate'
    | 'agreedPrice'
    | 'confirmedPaidAmount'
  > | null,
  now: Date = new Date(),
): PtPurchaseStatus {
  if (purchase.origin === PtPurchaseOrigin.STANDALONE) {
    if (
      purchase.paymentStatus === PaymentStatus.REFUNDED ||
      purchase.storedStatus === PtPurchaseStatus.REFUNDED
    ) {
      return PtPurchaseStatus.REFUNDED;
    }
    if (
      purchase.paymentStatus === PaymentStatus.CANCELLED ||
      purchase.storedStatus === PtPurchaseStatus.CANCELLED
    ) {
      return PtPurchaseStatus.CANCELLED;
    }
    if (purchase.paymentStatus === PaymentStatus.PENDING) {
      return PtPurchaseStatus.PENDING_PAYMENT;
    }
    if (
      purchase.allocated !== null &&
      purchase.reserved === 0 &&
      purchase.used === purchase.allocated
    ) {
      return PtPurchaseStatus.EXHAUSTED;
    }
    return PtPurchaseStatus.ACTIVE;
  }

  if (
    sourceSubscription?.paymentStatus === PaymentStatus.REFUNDED ||
    purchase.storedStatus === PtPurchaseStatus.REFUNDED
  ) {
    return PtPurchaseStatus.REFUNDED;
  }

  if (!purchase.cutoverEligible) {
    return purchase.storedStatus;
  }

  if (
    purchase.storedStatus === PtPurchaseStatus.CANCELLED ||
    sourceSubscription?.status === SubscriptionStatus.CANCELLED ||
    sourceSubscription?.paymentStatus === PaymentStatus.CANCELLED
  ) {
    return PtPurchaseStatus.CANCELLED;
  }

  if (purchase.storedStatus === PtPurchaseStatus.EXPIRED) {
    return PtPurchaseStatus.EXPIRED;
  }

  if (sourceSubscription) {
    if (purchase.allocated === null) {
      const endMs = parseValidDate(
        sourceSubscription.endDate,
        'sourceSubscription.endDate',
      ).getTime();
      if (
        sourceSubscription.status === SubscriptionStatus.EXPIRED ||
        ((sourceSubscription.status === SubscriptionStatus.ACTIVE ||
          sourceSubscription.status === SubscriptionStatus.UPCOMING) &&
          now.getTime() > endMs)
      ) {
        return PtPurchaseStatus.EXPIRED;
      }
    }

    const livePaymentStatus = resolveSourcePaymentStatus(sourceSubscription);
    if (livePaymentStatus === PaymentStatus.PENDING) {
      return PtPurchaseStatus.PENDING_PAYMENT;
    }

    if (
      purchase.allocated !== null &&
      purchase.reserved === 0 &&
      purchase.used === purchase.allocated
    ) {
      return PtPurchaseStatus.EXHAUSTED;
    }

    return PtPurchaseStatus.ACTIVE;
  }

  if (purchase.paymentStatus === PaymentStatus.REFUNDED) {
    return PtPurchaseStatus.REFUNDED;
  }
  if (purchase.paymentStatus === PaymentStatus.CANCELLED) {
    return PtPurchaseStatus.CANCELLED;
  }
  if (purchase.paymentStatus === PaymentStatus.PENDING) {
    return PtPurchaseStatus.PENDING_PAYMENT;
  }

  if (
    purchase.allocated !== null &&
    purchase.reserved === 0 &&
    purchase.used === purchase.allocated
  ) {
    return PtPurchaseStatus.EXHAUSTED;
  }

  return purchase.storedStatus === PtPurchaseStatus.PENDING_PAYMENT
    ? PtPurchaseStatus.ACTIVE
    : purchase.storedStatus;
}

export function evaluateGymCoverageForSlot(
  subscriptions: readonly GymCoverageSubscriptionCandidate[],
  slotStartsAt: Date | string,
  slotEndsAt: Date | string,
  options?: {
    memberIsActive?: boolean;
    referenceNow?: Date | string;
  },
): GymCoverageEvaluationResult {
  const slotStart = parseValidDate(slotStartsAt, 'slotStartsAt');
  const slotEnd = parseValidDate(slotEndsAt, 'slotEndsAt');
  if (slotEnd.getTime() <= slotStart.getTime()) {
    throw new Error('slotEndsAt must be after slotStartsAt');
  }

  if (options?.memberIsActive === false) {
    return {
      covered: false,
      coveringSubscriptionId: null,
      coveringSubscriptionStatus: null,
      reason: 'MEMBER_INACTIVE',
    };
  }

  const referenceNow = options?.referenceNow
    ? parseValidDate(options.referenceNow, 'referenceNow')
    : new Date();

  const slotStartMs = slotStart.getTime();
  const slotEndMs = slotEnd.getTime();
  const refNowMs = referenceNow.getTime();

  let sawFrozenOverlap = false;
  let sawSuspendedWithoutRestore = false;

  const eligible: Array<{
    sub: GymCoverageSubscriptionCandidate;
    priority: number;
    startMs: number;
    endMs: number;
  }> = [];

  for (const sub of subscriptions) {
    if (sub.paymentStatus !== PaymentStatus.PAID) {
      continue;
    }
    if (
      sub.status === SubscriptionStatus.CANCELLED ||
      sub.status === SubscriptionStatus.EXPIRED
    ) {
      continue;
    }

    const startMs = parseValidDate(sub.startDate, 'sub.startDate').getTime();
    const endMs = parseValidDate(sub.endDate, 'sub.endDate').getTime();

    if (
      (sub.status === SubscriptionStatus.ACTIVE ||
        sub.status === SubscriptionStatus.UPCOMING) &&
      refNowMs > endMs
    ) {
      continue;
    }

    if (startMs > slotStartMs || endMs < slotEndMs) {
      continue;
    }

    const freezeCheck = hasActiveFreezeForInterval(
      sub.freezes,
      slotStartMs,
      slotEndMs,
      sub.status,
    );
    if (freezeCheck === 'FROZEN_OVERLAP') {
      sawFrozenOverlap = true;
      continue;
    }
    if (freezeCheck === 'SUSPENDED_NO_ACTIVE_FREEZE') {
      sawSuspendedWithoutRestore = true;
      continue;
    }

    const priority =
      sub.status === SubscriptionStatus.ACTIVE
        ? 0
        : sub.status === SubscriptionStatus.SUSPENDED
          ? 1
          : 2;

    eligible.push({ sub, priority, startMs, endMs });
  }

  eligible.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.endMs - right.endMs ||
      left.startMs - right.startMs ||
      left.sub.id.localeCompare(right.sub.id),
  );

  const selected = eligible[0];
  if (selected) {
    return {
      covered: true,
      coveringSubscriptionId: selected.sub.id,
      coveringSubscriptionStatus: selected.sub.status,
      reason: null,
    };
  }

  return {
    covered: false,
    coveringSubscriptionId: null,
    coveringSubscriptionStatus: null,
    reason: sawFrozenOverlap
      ? 'FROZEN_DURING_INTERVAL'
      : sawSuspendedWithoutRestore
        ? 'SUSPENDED_WITHOUT_RESTORE_WINDOW'
        : 'NO_PAID_SUBSCRIPTION_FOR_INTERVAL',
  };
}

export function selectPtCreditSourceForSlot(
  purchases: readonly PtCreditSourceCandidate[],
  slotStartsAt: Date | string,
  slotEndsAt: Date | string,
  options?: {
    referenceNow?: Date | string;
  },
): PtCreditSourceSelectionResult {
  const slotStart = parseValidDate(slotStartsAt, 'slotStartsAt');
  const slotEnd = parseValidDate(slotEndsAt, 'slotEndsAt');
  if (slotEnd.getTime() <= slotStart.getTime()) {
    throw new Error('slotEndsAt must be after slotStartsAt');
  }

  const referenceNow = options?.referenceNow
    ? parseValidDate(options.referenceNow, 'referenceNow')
    : new Date();

  const slotStartMs = slotStart.getTime();
  const slotEndMs = slotEnd.getTime();
  const refNowMs = referenceNow.getTime();

  const ranked: Array<{
    purchase: PtCreditSourceCandidate;
    tier: number;
    deadlineMs: number;
    sourceStartMs: number;
    createdAtMs: number;
  }> = [];

  for (const purchase of purchases) {
    const effectiveStatus = effectivePtPurchaseStatus(
      purchase,
      purchase.sourceSubscription,
      referenceNow,
    );
    if (effectiveStatus !== PtPurchaseStatus.ACTIVE) {
      continue;
    }

    if (
      purchase.allocated !== null &&
      purchase.allocated - purchase.reserved - purchase.used < 1
    ) {
      continue;
    }

    const createdAtMs = parseValidDate(
      purchase.createdAt,
      'purchase.createdAt',
    ).getTime();

    if (purchase.origin === PtPurchaseOrigin.LEGACY_BUNDLED) {
      if (!purchase.cutoverEligible || !purchase.sourceSubscription) {
        continue;
      }

      const sub = purchase.sourceSubscription;
      if (sub.memberId !== purchase.memberId) {
        continue;
      }

      const sourceStartMs = parseValidDate(
        sub.startDate,
        'sourceSubscription.startDate',
      ).getTime();
      const sourceEndMs = parseValidDate(
        sub.endDate,
        'sourceSubscription.endDate',
      ).getTime();

      // Upcoming legacy PT rights must only become usable starting in their original period.
      if (slotStartMs < sourceStartMs) {
        continue;
      }

      const freezeCheck = hasActiveFreezeForInterval(
        sub.freezes,
        slotStartMs,
        slotEndMs,
        sub.status,
      );
      if (freezeCheck !== 'OK') {
        continue;
      }

      if (purchase.allocated === null) {
        if (
          sub.status === SubscriptionStatus.EXPIRED ||
          ((sub.status === SubscriptionStatus.ACTIVE ||
            sub.status === SubscriptionStatus.UPCOMING) &&
            refNowMs > sourceEndMs)
        ) {
          continue;
        }
        if (slotEndMs > sourceEndMs) {
          continue;
        }

        ranked.push({
          purchase,
          tier: 0,
          deadlineMs: sourceEndMs,
          sourceStartMs,
          createdAtMs,
        });
      } else {
        ranked.push({
          purchase,
          tier: 1,
          deadlineMs: sourceEndMs,
          sourceStartMs,
          createdAtMs,
        });
      }
      continue;
    }

    if (purchase.allocated === null || purchase.allocated <= 0) {
      continue;
    }

    ranked.push({
      purchase,
      tier: 2,
      deadlineMs: Number.POSITIVE_INFINITY,
      sourceStartMs: Number.POSITIVE_INFINITY,
      createdAtMs,
    });
  }

  ranked.sort(
    (left, right) =>
      left.tier - right.tier ||
      left.deadlineMs - right.deadlineMs ||
      left.sourceStartMs - right.sourceStartMs ||
      left.createdAtMs - right.createdAtMs ||
      left.purchase.id.localeCompare(right.purchase.id),
  );

  const eligiblePurchaseIds = ranked.map((item) => item.purchase.id);
  const selected = ranked[0]?.purchase ?? null;

  return {
    selectedPurchaseId: selected?.id ?? null,
    selectedOrigin: selected?.origin ?? null,
    reason: selected ? 'SELECTED' : 'NO_ELIGIBLE_PT_CREDIT_SOURCE',
    eligiblePurchaseIds,
  };
}

export function filterUnmirroredSubscriptionQuotas<
  TQuota extends Pick<SpendableQuotaLike, 'id' | 'service'>,
>(
  quotas: readonly TQuota[],
  ptPurchases: readonly Pick<
    SpendablePtPurchaseLike,
    'origin' | 'legacyQuotaId'
  >[],
): TQuota[] {
  const mirroredQuotaIds = new Set<string>();
  for (const purchase of ptPurchases) {
    if (
      purchase.origin === PtPurchaseOrigin.LEGACY_BUNDLED &&
      purchase.legacyQuotaId
    ) {
      mirroredQuotaIds.add(purchase.legacyQuotaId);
    }
  }

  return quotas.filter(
    (quota) =>
      !(quota.service === ServiceTypeCode.PT && mirroredQuotaIds.has(quota.id)),
  );
}

/**
 * Summarizes currently spendable PT credit sources at `now` (credit balance only).
 * Entrance / appointment Gym coverage authorization is kept separate and must be
 * evaluated independently via `evaluateGymCoverageForSlot`.
 */
export function summarizeSpendablePtCredits(
  quotas: readonly SpendableQuotaLike[],
  ptPurchases: readonly SpendablePtPurchaseLike[],
  options?: {
    now?: Date | string;
    activeUnmirroredSubscriptionIds?: ReadonlySet<string>;
  },
): SpendablePtCreditsSummary {
  const now = options?.now
    ? parseValidDate(options.now, 'options.now')
    : new Date();
  const nowMs = now.getTime();
  let hasUnlimited = false;
  let finiteRemaining = 0;
  let finiteReserved = 0;
  let finiteUsed = 0;
  const eligiblePurchaseIds: string[] = [];

  for (const purchase of ptPurchases) {
    const effectiveStatus = effectivePtPurchaseStatus(
      purchase,
      purchase.sourceSubscription,
      now,
    );
    if (effectiveStatus !== PtPurchaseStatus.ACTIVE) {
      continue;
    }

    if (
      purchase.allocated !== null &&
      purchase.allocated - purchase.reserved - purchase.used < 1 &&
      purchase.reserved === 0
    ) {
      continue;
    }

    if (purchase.origin === PtPurchaseOrigin.LEGACY_BUNDLED) {
      if (!purchase.cutoverEligible || !purchase.sourceSubscription) {
        continue;
      }

      const sub = purchase.sourceSubscription;
      if (purchase.memberId && sub.memberId !== purchase.memberId) {
        continue;
      }

      const sourceStartMs = parseValidDate(
        sub.startDate,
        'sourceSubscription.startDate',
      ).getTime();
      if (nowMs < sourceStartMs) {
        continue;
      }

      const freezeCheck = hasActiveFreezeForInterval(
        sub.freezes,
        nowMs,
        nowMs + 1,
        sub.status,
      );
      if (freezeCheck !== 'OK') {
        continue;
      }
    } else if (purchase.allocated === null || purchase.allocated <= 0) {
      continue;
    }

    eligiblePurchaseIds.push(purchase.id);
    if (purchase.allocated === null) {
      hasUnlimited = true;
    } else {
      finiteReserved += purchase.reserved;
      finiteUsed += purchase.used;
      finiteRemaining += Math.max(
        0,
        purchase.allocated - purchase.reserved - purchase.used,
      );
    }
  }

  const unmirroredLegacyPtQuotas = filterUnmirroredSubscriptionQuotas(
    quotas,
    ptPurchases,
  ).filter((quota) => quota.service === ServiceTypeCode.PT);

  const unmirroredLegacyQuotaIds = unmirroredLegacyPtQuotas.map(
    (quota) => quota.id,
  );

  for (const quota of unmirroredLegacyPtQuotas) {
    if (!options?.activeUnmirroredSubscriptionIds?.has(quota.subscriptionId)) {
      continue;
    }

    if (
      quota.allocated !== null &&
      quota.allocated - quota.reserved - quota.used < 1 &&
      quota.reserved === 0
    ) {
      continue;
    }

    if (quota.allocated === null) {
      hasUnlimited = true;
    } else {
      finiteReserved += quota.reserved;
      finiteUsed += quota.used;
      finiteRemaining += Math.max(
        0,
        quota.allocated - quota.reserved - quota.used,
      );
    }
  }

  return {
    scope: 'PT_CREDIT_BALANCE_ONLY',
    requiresSeparateGymCoverage: true,
    hasUnlimited,
    finiteRemaining,
    finiteReserved,
    finiteUsed,
    eligiblePurchaseIds,
    unmirroredLegacyQuotaIds,
  };
}
