export enum SubscriptionStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** EXPIRED is a read-model state. Persist ACTIVE until another lifecycle event occurs. */
export function effectiveSubscriptionStatus(
  status: SubscriptionStatus,
  endDate: string | Date,
  now = new Date(),
): SubscriptionStatus {
  return status === SubscriptionStatus.ACTIVE &&
    now.getTime() > new Date(endDate).getTime()
    ? SubscriptionStatus.EXPIRED
    : status;
}
export interface SubscriptionSummary {
  id: string;
  memberId: string;
  planId: string;
  startDate: string;
  endDate: string;
  status: SubscriptionStatus;
}
