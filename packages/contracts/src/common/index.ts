export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum ServiceTypeCode {
  GYM_ACCESS = 'GYM_ACCESS',
  CLASS = 'CLASS',
  PT = 'PT',
}

export enum QuotaTransactionType {
  RESERVE = 'RESERVE',
  USE = 'USE',
  REFUND = 'REFUND',
  ADJUST = 'ADJUST',
}

export interface HealthResponse {
  status: 'ok';
}
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  code?: string;
  conflicts?: import('../members').MemberFaceConflict[];
}

/** allocated=null means unlimited; never use a magic negative number. */
export interface QuotaSummary {
  allocated: number | null;
  reserved: number;
  used: number;
}

export function remainingQuota(quota: QuotaSummary): number | null {
  return quota.allocated === null
    ? null
    : quota.allocated - quota.reserved - quota.used;
}

export interface SubscriptionQuotaDetail {
  id: string;
  subscriptionId: string;
  service: string;
  serviceName: string;
  unlimited: boolean;
  allocated: number | null;
  reserved: number;
  used: number;
  remaining: number | null;
  updatedAt: string;
}

export interface QuotaTransactionDetail {
  id: string;
  quotaId: string;
  subscriptionId: string;
  type: QuotaTransactionType;
  allocatedDelta: number;
  reservedDelta: number;
  usedDelta: number;
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface PaginatedQuotaTransactionsResponse {
  data: QuotaTransactionDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CanUseQuotaResult {
  allowed: boolean;
  reason?: string;
  remaining: number | null;
  unlimited: boolean;
}

export interface AdjustQuotaRequest {
  allocatedDelta?: number;
  reason: string;
}

/**
 * Single Source of Truth for Gym Domain Business Rules & Validation Boundaries
 * Shared across @gym/api and @gym/web so Frontend never hardcodes or guesses limits.
 */
export const GYM_DOMAIN_RULES = {
  CODES: {
    MEMBER_PREFIX: 'MEM-',
    EMPLOYEE_PREFIX: 'EMP-',
    RECEIPT_PREFIX: 'REC-',
  },
  CHECKIN: {
    ANTI_PASSBACK_MINUTES: 5,
    ID_PHOTO_MAX_CHARS: 200_000,
    MEMBER_CAN_SELF_EDIT_PHOTO: false,
  },
  SCHEDULING: {
    CLASS_DURATION_MIN_MINUTES: 30,
    CLASS_DURATION_MAX_MINUTES: 180,
    CLASS_CANCEL_MIN_LEAD_HOURS: 2,
    PT_CANCEL_MIN_LEAD_HOURS: 6,
    OPERATING_START_HOUR: 6,
    OPERATING_END_HOUR: 22,
  },
  FREEZE: {
    MIN_DAYS: 7,
    MAX_DAYS: 60,
    MAX_FREEZES_PER_SUBSCRIPTION: 2,
  },
} as const;
