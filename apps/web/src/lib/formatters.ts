import { ServiceTypeCode, type PlanEntitlementItem } from '@gym/contracts';

/**
 * Formats a number as Vietnamese Dong currency (e.g., 1500000 -> "1.500.000đ").
 */
export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '0đ';
  }
  return `${Math.round(amount).toLocaleString('vi-VN')}đ`;
}

/**
 * Formats plan duration in days into human-readable Vietnamese (e.g., 30 -> "1 tháng").
 */
export function formatDurationVi(days: number): string {
  if (days === 30) return '1 tháng';
  if (days === 60) return '2 tháng';
  if (days === 90) return '3 tháng';
  if (days === 180) return '6 tháng';
  if (days === 365) return '12 tháng';
  if (days > 0 && days % 30 === 0) return `${days / 30} tháng`;
  return `${days} ngày`;
}

/**
 * Formats a 10-digit Vietnamese phone number (e.g., "0901234567" -> "0901 234 567").
 */
export function formatPhoneVi(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw.trim() || '—';
}

/**
 * Formats an ISO date string or Date into "dd/mm/yyyy" (vi-VN).
 */
export function formatDateVi(iso?: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Formats an ISO date string or Date into "HH:mm" (vi-VN).
 */
export function formatTimeVi(iso?: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a start and end ISO timestamp into "HH:mm – HH:mm".
 */
export function formatTimeRangeVi(startIso: string, endIso: string): string {
  return `${formatTimeVi(startIso)} – ${formatTimeVi(endIso)}`;
}

/**
 * Formats an ISO date string into "HH:mm • dd/mm/yyyy".
 */
export function formatDateTimeVi(iso?: string | Date | null): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${formatTimeVi(d)} • ${formatDateVi(d)}`;
}

/**
 * Extracts 2-letter uppercase initials from a Vietnamese full name.
 */
export function getInitials(fullName?: string | null, fallback = 'HV'): string {
  if (!fullName) return fallback;
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || fallback
  );
}

/**
 * Formats a PlanEntitlementItem from @gym/contracts into a standardized Vietnamese label.
 */
export function formatEntitlementLabel(ent: PlanEntitlementItem): string {
  const isUnlimited = ent.limitType === 'UNLIMITED' || ent.limitValue === null;
  if (ent.service === ServiceTypeCode.GYM_ACCESS) {
    return isUnlimited
      ? 'Check-in Full Gym & Tủ đồ không giới hạn'
      : `${ent.limitValue} lượt Check-in Full Gym`;
  }
  if (ent.service === ServiceTypeCode.CLASS) {
    return isUnlimited
      ? 'Tham gia Group Class không giới hạn'
      : `${ent.limitValue} buổi Group Class`;
  }
  if (ent.service === ServiceTypeCode.PT) {
    return isUnlimited
      ? 'Tập kèm riêng PT 1-1 không giới hạn'
      : `${ent.limitValue} buổi kèm riêng PT 1-1`;
  }
  return isUnlimited
    ? `${ent.serviceName ?? ent.service}: Không giới hạn`
    : `${ent.limitValue} buổi ${ent.serviceName ?? ent.service}`;
}

/**
 * Formats an official receipt number matching Backend PaymentsService.getReceipt:
 * REC-YYYYMMDD-XXXXXXXX (first 8 uppercase chars of payment UUID).
 */
export function formatReceiptNumber(
  paymentId: string,
  confirmedOrCreatedAt: string | Date,
): string {
  const iso =
    typeof confirmedOrCreatedAt === 'string'
      ? confirmedOrCreatedAt
      : confirmedOrCreatedAt.toISOString();
  const dateStr = iso.slice(0, 10).replace(/-/g, '');
  const shortId = paymentId.slice(0, 8).toUpperCase();
  return `REC-${dateStr}-${shortId}`;
}

/**
 * Generates a unique idempotency key for Quota/Booking/Payment mutations.
 */
export function generateIdempotencyKey(prefix = 'tx'): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
