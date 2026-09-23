const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  effectiveSubscriptionStatus,
  SubscriptionStatus: S,
  remainingQuota,
} = require('../dist');
test('expiry is derived only for active subscriptions and only after endDate', () => {
  const end = new Date('2026-09-20T00:00:00Z');
  assert.equal(effectiveSubscriptionStatus(S.ACTIVE, end, end), S.ACTIVE);
  assert.equal(
    effectiveSubscriptionStatus(S.ACTIVE, end, new Date(end.getTime() + 1)),
    S.EXPIRED,
  );
  for (const state of [S.UPCOMING, S.SUSPENDED, S.CANCELLED]) {
    assert.equal(
      effectiveSubscriptionStatus(state, end, new Date('2027-01-01')),
      state,
    );
  }
});
test('remaining quota accounts for reservations and supports unlimited access', () => {
  assert.equal(remainingQuota({ allocated: 10, reserved: 2, used: 5 }), 3);
  assert.equal(
    remainingQuota({ allocated: null, reserved: 2, used: 50 }),
    null,
  );
});
