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

export interface HealthResponse {
  status: 'ok';
}
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
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
