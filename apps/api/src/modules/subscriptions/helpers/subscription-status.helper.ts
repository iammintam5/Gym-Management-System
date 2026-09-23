import { SubscriptionStatus } from '@gym/contracts';

/**
 * Derives effective subscription status based on stored state, start/end dates, and reference time.
 * Pure function - never mutates database state.
 */
export function resolveEffectiveStatus(
  subscription: {
    status: SubscriptionStatus | string;
    startDate: Date | string;
    endDate: Date | string;
  },
  now: Date = new Date(),
): SubscriptionStatus {
  const stored = subscription.status as SubscriptionStatus;
  const end = new Date(subscription.endDate).getTime();
  const current = now.getTime();

  if (stored === SubscriptionStatus.CANCELLED) {
    return SubscriptionStatus.CANCELLED;
  }

  if (stored === SubscriptionStatus.SUSPENDED) {
    return SubscriptionStatus.SUSPENDED;
  }

  if (stored === SubscriptionStatus.ACTIVE) {
    if (current > end) {
      return SubscriptionStatus.EXPIRED;
    }
    return SubscriptionStatus.ACTIVE;
  }

  if (stored === SubscriptionStatus.UPCOMING) {
    if (current > end) {
      return SubscriptionStatus.EXPIRED;
    }
    return SubscriptionStatus.UPCOMING;
  }

  return stored;
}
