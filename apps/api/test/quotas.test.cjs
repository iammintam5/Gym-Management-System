const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');
const { QuotasService } = require('../dist/modules/quotas/quotas.service');

test('Phase 9 - Quota Engine Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const db = app.get(DatabaseService);
  const quotasService = app.get(QuotasService);
  const base = await app.getUrl();

  const request = (path, options = {}) =>
    fetch(`${base}/api/${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...options,
    });

  // 1. Authenticate actors
  const adminRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@gym.com',
      password: 'Admin@123456',
    }),
  });
  assert.equal(adminRes.status, 200);
  const adminData = await adminRes.json();
  const adminToken = adminData.tokens.accessToken;
  const adminId = adminData.user.id;

  const staffRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'staff@gym.com',
      password: 'Staff@123456',
    }),
  });
  assert.equal(staffRes.status, 200);
  const staffData = await staffRes.json();
  const staffToken = staffData.tokens.accessToken;

  const ptRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'pt@gym.com',
      password: 'Pt@123456',
    }),
  });
  assert.equal(ptRes.status, 200);
  const ptData = await ptRes.json();
  const _ptToken = ptData.tokens.accessToken;

  const memberRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'member@gym.com',
      password: 'Member@123456',
    }),
  });
  assert.equal(memberRes.status, 200);
  const memberData = await memberRes.json();
  const memberToken = memberData.tokens.accessToken;

  // Create test Membership Plan with finite CLASS (10) and unlimited GYM_ACCESS
  const planCreateRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Quota Engine Test Plan ${Date.now()}`,
      description: 'Plan for quota engine tests',
      durationDays: 30,
      price: 800000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 10 },
      ],
    }),
  });
  assert.equal(planCreateRes.status, 201);
  const testPlan = await planCreateRes.json();

  // Create a separate Member for Quota Engine tests
  const newMemberRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: `quota.member.${Date.now()}@test.com`,
      fullName: 'Quota Engine Test Member',
      phone: `093${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(newMemberRes.status, 201);
  const newMember = await newMemberRes.json();

  // Purchase subscription for test member
  const subCreateRes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: newMember.id,
      planId: testPlan.id,
      paymentMethod: 'CASH',
    }),
  });
  assert.equal(subCreateRes.status, 201);
  const activeSub = await subCreateRes.json();
  const activeSubId = activeSub.id;

  let classQuotaId = '';
  let gymQuotaId = '';

  // 1. canUse tests
  await t.test(
    'QuotasService.canUse() - Finite, Unlimited, Non-entitled & Invalid amount',
    async () => {
      // Finite CLASS within limit
      const res1 = await quotasService.canUse(activeSubId, 'CLASS', 1);
      assert.equal(res1.allowed, true);
      assert.equal(res1.remaining, 10);
      assert.equal(res1.unlimited, false);

      // Exact limit
      const res2 = await quotasService.canUse(activeSubId, 'CLASS', 10);
      assert.equal(res2.allowed, true);
      assert.equal(res2.remaining, 10);

      // Over limit
      const res3 = await quotasService.canUse(activeSubId, 'CLASS', 11);
      assert.equal(res3.allowed, false);
      assert.equal(res3.reason, 'INSUFFICIENT_QUOTA');
      assert.equal(res3.remaining, 10);

      // Unlimited GYM_ACCESS
      const res4 = await quotasService.canUse(activeSubId, 'GYM_ACCESS', 50);
      assert.equal(res4.allowed, true);
      assert.equal(res4.remaining, null);
      assert.equal(res4.unlimited, true);

      // Non-existent service code
      const res5 = await quotasService.canUse(activeSubId, 'SWIMMING', 1);
      assert.equal(res5.allowed, false);
      assert.equal(res5.reason, 'SERVICE_NOT_ENTITLED');

      // Invalid zero/negative amount
      const res6 = await quotasService.canUse(activeSubId, 'CLASS', 0);
      assert.equal(res6.allowed, false);
      assert.equal(res6.reason, 'INVALID_QUOTA_AMOUNT');

      const res7 = await quotasService.canUse(activeSubId, 'CLASS', -2);
      assert.equal(res7.allowed, false);
      assert.equal(res7.reason, 'INVALID_QUOTA_AMOUNT');
    },
  );

  // 2. Reserve quota & Over-reserve rejection
  await t.test(
    'QuotasService.reserve() - Reserve finite quota & reject over-reserving',
    async () => {
      const q1 = await quotasService.reserve(activeSubId, 'CLASS', {
        amount: 2,
        reason: 'Booked Spin class',
        actorId: adminId,
      });
      assert.equal(q1.service, 'CLASS');
      assert.equal(q1.allocated, 10);
      assert.equal(q1.used, 0);
      assert.equal(q1.reserved, 2);
      assert.equal(q1.remaining, 8);
      classQuotaId = q1.id;

      // Reserve 6 more
      const q2 = await quotasService.reserve(activeSubId, 'CLASS', {
        amount: 6,
        reason: 'Booked 6 Yoga sessions',
      });
      assert.equal(q2.reserved, 8);
      assert.equal(q2.remaining, 2);

      // Try to reserve 3 when only 2 remain -> 409 Conflict
      await assert.rejects(
        async () => {
          await quotasService.reserve(activeSubId, 'CLASS', { amount: 3 });
        },
        {
          name: 'ConflictException',
        },
      );

      // Verify state unchanged
      const checkQuota = await quotasService.getQuota(activeSubId, 'CLASS');
      assert.equal(checkQuota.reserved, 8);
      assert.equal(checkQuota.used, 0);
      assert.equal(checkQuota.remaining, 2);
    },
  );

  // 3. Consume reserved quota (Attendance confirmation)
  await t.test(
    'QuotasService.consumeReserved() - Transfer reserved to used on attendance',
    async () => {
      // Before: allocated=10, used=0, reserved=8, remaining=2
      const q = await quotasService.consumeReserved(activeSubId, 'CLASS', {
        amount: 3,
        reason: 'Attended 3 classes',
      });
      assert.equal(q.used, 3);
      assert.equal(q.reserved, 5);
      assert.equal(q.remaining, 2); // 10 - 3 - 5 = 2

      // Over-consuming reserved (try consuming 6 when reserved=5) -> 409
      await assert.rejects(
        async () => {
          await quotasService.consumeReserved(activeSubId, 'CLASS', {
            amount: 6,
          });
        },
        {
          name: 'ConflictException',
        },
      );
    },
  );

  // 4. Direct use (without prior reservation, e.g. check-in)
  await t.test(
    'QuotasService.use() - Direct usage increments used without altering reserved',
    async () => {
      // Before: allocated=10, used=3, reserved=5, remaining=2
      const q = await quotasService.use(activeSubId, 'CLASS', {
        amount: 1,
        reason: 'Direct drop-in class',
      });
      assert.equal(q.used, 4);
      assert.equal(q.reserved, 5);
      assert.equal(q.remaining, 1);

      // Direct use on unlimited GYM_ACCESS
      const gymQ = await quotasService.use(activeSubId, 'GYM_ACCESS', {
        amount: 1,
        reason: 'Gym turnstile entry',
      });
      assert.equal(gymQ.unlimited, true);
      assert.equal(gymQ.allocated, null);
      gymQuotaId = gymQ.id;
    },
  );

  // 5. Refund reserved quota (Booking cancellation)
  await t.test(
    'QuotasService.refundReserved() - Releases reserved counter',
    async () => {
      // Before: allocated=10, used=4, reserved=5, remaining=1
      const q = await quotasService.refundReserved(activeSubId, 'CLASS', {
        amount: 2,
        reason: 'Cancelled 2 class bookings',
      });
      assert.equal(q.used, 4);
      assert.equal(q.reserved, 3);
      assert.equal(q.remaining, 3); // 10 - 4 - 3 = 3

      // Over-refund reserved (try refunding 4 when reserved=3) -> 409
      await assert.rejects(
        async () => {
          await quotasService.refundReserved(activeSubId, 'CLASS', {
            amount: 4,
          });
        },
        {
          name: 'ConflictException',
        },
      );
    },
  );

  // 6. Refund used quota (Reversal / compensation)
  await t.test('QuotasService.refundUsed() - Reduces used count', async () => {
    // Before: allocated=10, used=4, reserved=3, remaining=3
    const q = await quotasService.refundUsed(activeSubId, 'CLASS', {
      amount: 1,
      reason: 'Instructor absence refund',
    });
    assert.equal(q.used, 3);
    assert.equal(q.reserved, 3);
    assert.equal(q.remaining, 4);

    // Over-refund used (try refunding 4 when used=3) -> 409
    await assert.rejects(
      async () => {
        await quotasService.refundUsed(activeSubId, 'CLASS', { amount: 4 });
      },
      {
        name: 'ConflictException',
      },
    );
  });

  // 7. Adjust allocation (Admin only & Invariant protection)
  await t.test(
    'POST /api/quotas/:id/adjust - Admin adjustment with invariant enforcement',
    async () => {
      // RBAC: Staff/Member/PT forbidden
      const staffAdjustRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({ allocatedDelta: 2, reason: 'Staff try adjust' }),
      });
      assert.equal(staffAdjustRes.status, 403);

      const memberAdjustRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: memberToken,
        body: JSON.stringify({
          allocatedDelta: 2,
          reason: 'Member try adjust',
        }),
      });
      assert.equal(memberAdjustRes.status, 403);

      // Validation: Missing reason -> 400
      const noReasonRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ allocatedDelta: 2, reason: '' }),
      });
      assert.equal(noReasonRes.status, 400);

      // Admin increases allocated: +3 (10 -> 13). (Current used=3, reserved=3)
      const adminAdjustRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          allocatedDelta: 3,
          reason: 'Customer satisfaction loyalty reward',
        }),
      });
      assert.equal(adminAdjustRes.status, 200);
      const adjustedData = await adminAdjustRes.json();
      assert.equal(adjustedData.allocated, 13);
      assert.equal(adjustedData.remaining, 7); // 13 - 3 - 3 = 7

      // Admin decreases allocated: -2 (13 -> 11) -> Valid
      const reduceAdjustRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          allocatedDelta: -2,
          reason: 'Correction of extra credit',
        }),
      });
      assert.equal(reduceAdjustRes.status, 200);
      const reducedData = await reduceAdjustRes.json();
      assert.equal(reducedData.allocated, 11);
      assert.equal(reducedData.remaining, 5); // 11 - 3 - 3 = 5

      // Invariant check: try reducing below used + reserved (11 - 6 = 5, which is < used(3) + reserved(3) = 6) -> 409
      const invalidReduceRes = await request(`quotas/${classQuotaId}/adjust`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          allocatedDelta: -6,
          reason: 'Try reduce below used+reserved',
        }),
      });
      assert.equal(invalidReduceRes.status, 409);

      // Try adjusting unlimited quota -> 409
      const unlimAdjustRes = await request(`quotas/${gymQuotaId}/adjust`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          allocatedDelta: 5,
          reason: 'Cannot adjust unlimited',
        }),
      });
      assert.equal(unlimAdjustRes.status, 409);
    },
  );

  // 8. Subscription lifecycle guards: CANCELLED, EXPIRED, PENDING
  await t.test(
    'QuotasService - Lifecycle status validation (Reject inactive subscriptions)',
    async () => {
      // Create new member and subscriptions in inactive states
      const statusMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `status.member.${Date.now()}@test.com`,
          fullName: 'Status Check Member',
          phone: `092${Date.now().toString().slice(-7)}`,
        }),
      });
      assert.equal(statusMemberRes.status, 201);
      const statusMember = await statusMemberRes.json();

      // 1. Cancelled Subscription
      const subToCancel = await (
        await request('subscriptions', {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({
            memberId: statusMember.id,
            planId: testPlan.id,
          }),
        })
      ).json();
      await request(`subscriptions/${subToCancel.id}/cancel`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ reason: 'Cancel for lifecycle test' }),
      });

      await assert.rejects(
        async () => {
          await quotasService.reserve(subToCancel.id, 'CLASS', { amount: 1 });
        },
        { name: 'ConflictException' },
      );

      // 2. Expired Subscription (in the past)
      const pastStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const pastEnd = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const expSub = await db.client.subscription.create({
        data: {
          memberId: statusMember.id,
          planId: testPlan.id,
          startDate: pastStart,
          endDate: pastEnd,
          status: 'ACTIVE',
          agreedPrice: 800000,
        },
      });
      const serviceType = await db.client.serviceType.findUniqueOrThrow({
        where: { code: 'CLASS' },
      });
      await db.client.subscriptionQuota.create({
        data: {
          subscriptionId: expSub.id,
          serviceTypeId: serviceType.id,
          allocated: 10,
        },
      });

      await assert.rejects(
        async () => {
          await quotasService.use(expSub.id, 'CLASS', { amount: 1 });
        },
        { name: 'ConflictException' },
      );

      // 3. Pending Subscription (starts in the future)
      const futureStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
      const futureSub = await db.client.subscription.create({
        data: {
          memberId: statusMember.id,
          planId: testPlan.id,
          startDate: futureStart,
          endDate: futureEnd,
          status: 'UPCOMING',
          agreedPrice: 800000,
        },
      });
      await db.client.subscriptionQuota.create({
        data: {
          subscriptionId: futureSub.id,
          serviceTypeId: serviceType.id,
          allocated: 10,
        },
      });

      await assert.rejects(
        async () => {
          await quotasService.reserve(futureSub.id, 'CLASS', { amount: 1 });
        },
        { name: 'ConflictException' },
      );
    },
  );

  // 9. Plan entitlement edits do NOT modify existing subscription quotas (Snapshot Immutability)
  await t.test(
    'Immutability - Modifying MembershipPlan does not alter existing SubscriptionQuota',
    async () => {
      // Current activeSub CLASS quota has allocated=11
      const beforeQuota = await quotasService.getQuota(activeSubId, 'CLASS');
      assert.equal(beforeQuota.allocated, 11);

      // Update Plan entitlement CLASS from 10 to 50
      const updatePlanRes = await request(
        `membership-plans/${testPlan.id}/entitlements`,
        {
          method: 'PUT',
          token: adminToken,
          body: JSON.stringify({
            entitlements: [
              { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
              { service: 'CLASS', limitType: 'COUNT', limitValue: 50 },
            ],
          }),
        },
      );
      assert.equal(updatePlanRes.status, 200);

      // Verify existing subscription quota is unchanged
      const afterQuota = await quotasService.getQuota(activeSubId, 'CLASS');
      assert.equal(afterQuota.allocated, 11);
    },
  );

  // 10. Idempotency test
  await t.test(
    'Idempotency - Repeated call with same idempotencyKey does not double increment',
    async () => {
      const key = `idemp-${Date.now()}`;
      const q1 = await quotasService.reserve(activeSubId, 'CLASS', {
        amount: 1,
        idempotencyKey: key,
      });
      const reservedCount1 = q1.reserved;

      // Repeat identical call
      const q2 = await quotasService.reserve(activeSubId, 'CLASS', {
        amount: 1,
        idempotencyKey: key,
      });
      assert.equal(q2.reserved, reservedCount1);
    },
  );

  // 11. Concurrency test — Parallel reservations with race condition
  await t.test(
    'Concurrency - Simultaneous reserve calls safely serialized',
    async () => {
      // Create new member with finite 1 CLASS quota
      const singlePlanRes = await request('membership-plans', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          name: `Single Class Plan ${Date.now()}`,
          durationDays: 30,
          price: 100000,
          isActive: true,
          entitlements: [
            { service: 'CLASS', limitType: 'COUNT', limitValue: 1 },
          ],
        }),
      });
      const singlePlan = await singlePlanRes.json();

      const concMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `conc.quota.${Date.now()}@test.com`,
          fullName: 'Concurrency Quota Member',
          phone: `091${Date.now().toString().slice(-7)}`,
        }),
      });
      const concMember = await concMemberRes.json();

      const concSub = await (
        await request('subscriptions', {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({
            memberId: concMember.id,
            planId: singlePlan.id,
          }),
        })
      ).json();

      // Fire two simultaneous reserve(1) operations
      const [resA, resB] = await Promise.allSettled([
        quotasService.reserve(concSub.id, 'CLASS', { amount: 1 }),
        quotasService.reserve(concSub.id, 'CLASS', { amount: 1 }),
      ]);

      const successes = [resA, resB].filter((r) => r.status === 'fulfilled');
      const failures = [resA, resB].filter((r) => r.status === 'rejected');

      assert.equal(successes.length, 1, 'Exactly 1 reserve call must succeed');
      assert.equal(
        failures.length,
        1,
        'The competing reserve call must be rejected',
      );

      // Final quota state verification
      const finalQuota = await quotasService.getQuota(concSub.id, 'CLASS');
      assert.equal(finalQuota.reserved, 1);
      assert.equal(finalQuota.remaining, 0);
    },
  );

  // 12. HTTP Read endpoints & Transaction Ledger
  await t.test(
    'GET /api/subscriptions/:id/quotas & GET /api/quotas/:id/transactions',
    async () => {
      // Admin / Staff gets subscription quotas
      const quotasRes = await request(`subscriptions/${activeSubId}/quotas`, {
        token: staffToken,
      });
      assert.equal(quotasRes.status, 200);
      const quotasList = await quotasRes.json();
      assert.ok(Array.isArray(quotasList));
      assert.equal(quotasList.length, 2);

      // Member gets self current quotas
      const selfRes = await request('subscriptions/me/current/quotas', {
        token: memberToken,
      });
      // Note: member@gym.com may have or not have an active sub seeded
      if (selfRes.status === 200) {
        const selfQuotas = await selfRes.json();
        assert.ok(Array.isArray(selfQuotas));
      }

      // Get paginated transaction history
      const txRes = await request(
        `quotas/${classQuotaId}/transactions?page=1&limit=10`,
        {
          token: adminToken,
        },
      );
      assert.equal(txRes.status, 200);
      const txData = await txRes.json();
      assert.ok(Array.isArray(txData.data));
      assert.ok(txData.data.length > 0);
      assert.ok(txData.meta);
      assert.ok(txData.meta.total > 0);
    },
  );
});
