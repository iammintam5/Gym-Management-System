const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Phase 8 - Subscription Renewal Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const db = app.get(DatabaseService);

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
  const ptToken = ptData.tokens.accessToken;

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

  // Create initial Membership Plans
  const basicPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Renewal Basic Plan ${Date.now()}`,
      description: 'Basic plan for renewal tests',
      durationDays: 30,
      price: 500000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 5 },
      ],
    }),
  });
  assert.equal(basicPlanRes.status, 201);
  const basicPlan = await basicPlanRes.json();

  const premiumPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Renewal Premium Plan ${Date.now()}`,
      description: 'Premium plan for upgrade renewal tests',
      durationDays: 60,
      price: 1200000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 20 },
      ],
    }),
  });
  assert.equal(premiumPlanRes.status, 201);
  const premiumPlan = await premiumPlanRes.json();

  const inactivePlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Renewal Inactive Plan ${Date.now()}`,
      durationDays: 30,
      price: 300000,
      isActive: false,
    }),
  });
  assert.equal(inactivePlanRes.status, 201);
  const inactivePlan = await inactivePlanRes.json();

  // Create test member
  const newMemberRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: `renewal.member.${Date.now()}@test.com`,
      fullName: 'Renewal Test Member',
      phone: `097${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(newMemberRes.status, 201);
  const newMember = await newMemberRes.json();
  const testMemberId = newMember.id;

  let activeSubId = '';
  let renewedSubId = '';

  // 1. RBAC on Renewal Endpoint
  await t.test(
    'POST /api/subscriptions/:id/renew - RBAC enforcement',
    async () => {
      // First create a baseline subscription for testing
      const createSubRes = await request('subscriptions', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          memberId: testMemberId,
          planId: basicPlan.id,
          paymentMethod: 'CASH',
        }),
      });
      assert.equal(createSubRes.status, 201);
      const sub = await createSubRes.json();
      activeSubId = sub.id;

      // PT Forbidden
      const ptRenewRes = await request(`subscriptions/${activeSubId}/renew`, {
        method: 'POST',
        token: ptToken,
        body: JSON.stringify({}),
      });
      assert.equal(ptRenewRes.status, 403);

      // Member Forbidden
      const memberRenewRes = await request(
        `subscriptions/${activeSubId}/renew`,
        {
          method: 'POST',
          token: memberToken,
          body: JSON.stringify({}),
        },
      );
      assert.equal(memberRenewRes.status, 403);

      // Unauthenticated Unauthorized
      const unauthRenewRes = await request(
        `subscriptions/${activeSubId}/renew`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      assert.equal(unauthRenewRes.status, 401);
    },
  );

  // 2. Renew Active Subscription (Same Plan, Omit planId)
  await t.test(
    'POST /api/subscriptions/:id/renew - Active subscription renewal (Same Plan, Queued UPCOMING)',
    async () => {
      const res = await request(`subscriptions/${activeSubId}/renew`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          paymentMethod: 'TRANSFER',
          note: 'Renewed for 1 additional month',
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data.id);
      renewedSubId = data.id;

      // Check relationship and queued status
      assert.equal(data.previousSubscriptionId, activeSubId);
      assert.equal(data.memberId, testMemberId);
      assert.equal(data.planId, basicPlan.id);
      assert.equal(data.storedStatus, 'UPCOMING');
      assert.equal(data.effectiveStatus, 'UPCOMING');
      assert.equal(data.agreedPrice, 500000);
      assert.equal(data.activatedAt, null);

      // Date calculations: starts exactly when active subscription ends
      const oldSubRes = await request(`subscriptions/${activeSubId}`, {
        token: adminToken,
      });
      const oldSub = await oldSubRes.json();
      assert.equal(data.startDate, oldSub.endDate);

      // Quotas: fresh snapshot, used=0, reserved=0
      assert.ok(Array.isArray(data.quotas));
      assert.equal(data.quotas.length, 2);
      const classQuota = data.quotas.find((q) => q.service === 'CLASS');
      assert.ok(classQuota);
      assert.equal(classQuota.allocated, 5);
      assert.equal(classQuota.used, 0);
      assert.equal(classQuota.reserved, 0);

      // Payment record created
      assert.ok(Array.isArray(data.payments));
      assert.equal(data.payments.length, 1);
      assert.equal(data.payments[0].amount, 500000);
      assert.equal(data.payments[0].status, 'PAID');
      assert.equal(data.payments[0].method, 'TRANSFER');

      // Verify old subscription is completely untouched (immutability)
      assert.equal(oldSub.id, activeSubId);
      assert.equal(oldSub.storedStatus, 'ACTIVE');
      assert.equal(oldSub.planId, basicPlan.id);
      assert.equal(oldSub.agreedPrice, 500000);
    },
  );

  // 3. Reject duplicate renewal when UPCOMING renewal already exists
  await t.test(
    'POST /api/subscriptions/:id/renew - Reject if UPCOMING renewal already exists',
    async () => {
      const res = await request(`subscriptions/${activeSubId}/renew`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 409);
      const err = await res.json();
      assert.ok(
        err.message.includes('upcoming subscription renewal queued') ||
          err.message.includes('chain') ||
          err.message.includes('superseded'),
      );
    },
  );

  // 4. Reject renewal from older subscription in chain
  await t.test(
    'POST /api/subscriptions/:id/renew - Reject renewing non-latest subscription',
    async () => {
      // Attempting to renew activeSubId when renewedSubId exists
      const res = await request(`subscriptions/${activeSubId}/renew`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 409);
    },
  );

  // 5. Reject renewing an UPCOMING subscription directly
  await t.test(
    'POST /api/subscriptions/:id/renew - Reject renewing UPCOMING source',
    async () => {
      const res = await request(`subscriptions/${renewedSubId}/renew`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 409);
      const err = await res.json();
      assert.ok(err.message.includes('Cannot renew an upcoming subscription'));
    },
  );

  // 6. Renew with different plan (Upgrade from Basic to Premium)
  await t.test(
    'POST /api/subscriptions/:id/renew - Renew with different plan (Price & Quota snapshot)',
    async () => {
      // Create new member with an active Basic subscription
      const upgradeMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `upgrade.member.${Date.now()}@test.com`,
          fullName: 'Upgrade Test Member',
          phone: `094${Date.now().toString().slice(-7)}`,
        }),
      });
      assert.equal(upgradeMemberRes.status, 201);
      const upgradeMember = await upgradeMemberRes.json();

      const basicSubRes = await request('subscriptions', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          memberId: upgradeMember.id,
          planId: basicPlan.id,
          paymentMethod: 'CASH',
        }),
      });
      assert.equal(basicSubRes.status, 201);
      const initialBasicSub = await basicSubRes.json();

      const cardRejected = await request(
        `subscriptions/${initialBasicSub.id}/renew`,
        {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({
            planId: premiumPlan.id,
            paymentMethod: 'CARD',
          }),
        },
      );
      assert.equal(cardRejected.status, 400);

      // Renew to Premium Plan
      const renewPremiumRes = await request(
        `subscriptions/${initialBasicSub.id}/renew`,
        {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({
            planId: premiumPlan.id,
            paymentMethod: 'TRANSFER',
          }),
        },
      );
      assert.equal(renewPremiumRes.status, 201);
      const premiumSub = await renewPremiumRes.json();

      assert.equal(premiumSub.planId, premiumPlan.id);
      assert.equal(premiumSub.agreedPrice, 1200000);
      assert.equal(premiumSub.previousSubscriptionId, initialBasicSub.id);
      assert.equal(premiumSub.storedStatus, 'UPCOMING');

      // Verify Premium quotas (Gym and Class) with fresh reset
      assert.equal(premiumSub.quotas.length, 2);
      const ptQuota = premiumSub.quotas.find((q) => q.service === 'PT');
      assert.equal(ptQuota, undefined);

      const classQuota = premiumSub.quotas.find((q) => q.service === 'CLASS');
      assert.ok(classQuota);
      assert.equal(classQuota.allocated, 20);
      assert.equal(classQuota.used, 0);

      // Verify initial Basic sub unchanged
      const basicSubCheck = await (
        await request(`subscriptions/${initialBasicSub.id}`, {
          token: adminToken,
        })
      ).json();
      assert.equal(basicSubCheck.agreedPrice, 500000);
      assert.equal(basicSubCheck.planId, basicPlan.id);
    },
  );

  // 7. Renew into Inactive Plan -> 409 Conflict
  await t.test(
    'POST /api/subscriptions/:id/renew - Reject renewing into inactive plan',
    async () => {
      // Create new member with active sub to test inactive plan
      const inactMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `inact.member.${Date.now()}@test.com`,
          fullName: 'Inactive Plan Test Member',
          phone: `093${Date.now().toString().slice(-7)}`,
        }),
      });
      assert.equal(inactMemberRes.status, 201);
      const inactMember = await inactMemberRes.json();

      const activeSubRes = await request('subscriptions', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          memberId: inactMember.id,
          planId: basicPlan.id,
        }),
      });
      assert.equal(activeSubRes.status, 201);
      const targetSub = await activeSubRes.json();

      const res = await request(`subscriptions/${targetSub.id}/renew`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          planId: inactivePlan.id,
        }),
      });
      assert.equal(res.status, 409);
      const err = await res.json();
      assert.ok(err.message.includes('inactive or discontinued'));
    },
  );

  // 8. Renew Expired Subscription -> ACTIVE status immediately (if PAID)
  await t.test(
    'POST /api/subscriptions/:id/renew - Expired subscription renewal starts immediately as ACTIVE',
    async () => {
      const expMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `expired.member.${Date.now()}@test.com`,
          fullName: 'Expired Sub Member',
          phone: `096${Date.now().toString().slice(-7)}`,
        }),
      });
      assert.equal(expMemberRes.status, 201);
      const expMember = await expMemberRes.json();

      const pastStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const pastEnd = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const expiredSub = await db.client.subscription.create({
        data: {
          memberId: expMember.id,
          planId: basicPlan.id,
          startDate: pastStart,
          endDate: pastEnd,
          status: 'ACTIVE',
          paymentStatus: 'PAID',
          agreedPrice: 500000,
          activatedAt: pastStart,
        },
      });

      // Verify it derives EXPIRED on details query
      const checkExpRes = await request(`subscriptions/${expiredSub.id}`, {
        token: adminToken,
      });
      assert.equal(checkExpRes.status, 200);
      const checkExpData = await checkExpRes.json();
      assert.equal(checkExpData.effectiveStatus, 'EXPIRED');

      // Renew the expired subscription
      const renewExpRes = await request(
        `subscriptions/${expiredSub.id}/renew`,
        {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({
            paymentMethod: 'CASH',
            paymentStatus: 'PAID',
          }),
        },
      );

      assert.equal(renewExpRes.status, 201);
      const renewedExpData = await renewExpRes.json();
      assert.equal(renewedExpData.previousSubscriptionId, expiredSub.id);
      assert.equal(renewedExpData.storedStatus, 'ACTIVE');
      assert.equal(renewedExpData.effectiveStatus, 'ACTIVE');
      assert.ok(renewedExpData.activatedAt);

      // Verify startDate is today (approx now)
      const subStartDate = new Date(renewedExpData.startDate).getTime();
      assert.ok(Math.abs(subStartDate - Date.now()) < 10000);
    },
  );

  // 9. Subscription History displays complete renewal chain
  await t.test(
    'GET /api/members/:memberId/subscriptions - History displays full chain',
    async () => {
      const historyRes = await request(
        `members/${testMemberId}/subscriptions`,
        {
          token: staffToken,
        },
      );
      assert.equal(historyRes.status, 200);
      const history = await historyRes.json();
      assert.ok(history.length >= 2);
      // Chain linkages are present
      assert.ok(history.some((s) => s.id === activeSubId));
    },
  );

  // 10. Concurrency - Simultaneous renewal calls on same subscription
  await t.test(
    'POST /api/subscriptions/:id/renew - Concurrency race protection',
    async () => {
      // Create fresh member and active subscription for concurrency test
      const concMemberRes = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: `concurrency.member.${Date.now()}@test.com`,
          fullName: 'Concurrency Member',
          phone: `095${Date.now().toString().slice(-7)}`,
        }),
      });
      assert.equal(concMemberRes.status, 201);
      const concMember = await concMemberRes.json();

      const initialSubRes = await request('subscriptions', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          memberId: concMember.id,
          planId: basicPlan.id,
        }),
      });
      assert.equal(initialSubRes.status, 201);
      const initialSub = await initialSubRes.json();

      // Fire 2 renewals simultaneously
      const [res1, res2] = await Promise.all([
        request(`subscriptions/${initialSub.id}/renew`, {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({ paymentMethod: 'CASH' }),
        }),
        request(`subscriptions/${initialSub.id}/renew`, {
          method: 'POST',
          token: staffToken,
          body: JSON.stringify({ paymentMethod: 'TRANSFER' }),
        }),
      ]);

      const statuses = [res1.status, res2.status];
      // Exactly one should succeed (201) and the other should be rejected with 409 Conflict
      assert.ok(statuses.includes(201), 'One request must succeed with 201');
      assert.ok(
        statuses.includes(409),
        'The concurrent duplicate request must fail with 409',
      );
    },
  );

  // 9. Allow renewal if previous queued renewal was CANCELLED (Fix Renewal Chain Lock)
  await t.test(
    'POST /api/subscriptions/:id/renew - Allow renewal if previous renewal was CANCELLED',
    async () => {
      // Cancel the renewed subscription (renewedSubId)
      const cancelRes = await request(`subscriptions/${renewedSubId}/cancel`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          reason: 'Member decided to cancel queued renewal',
        }),
      });
      assert.equal(cancelRes.status, 200);

      // Now renew from activeSubId again -> must succeed (201)
      const reRenewRes = await request(`subscriptions/${activeSubId}/renew`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          paymentMethod: 'CASH',
          note: 'Re-renewed after previous renewal cancellation',
        }),
      });
      assert.equal(reRenewRes.status, 201);
      const reRenewedData = await reRenewRes.json();
      assert.ok(reRenewedData.id);
      assert.equal(reRenewedData.previousSubscriptionId, activeSubId);
      assert.equal(reRenewedData.storedStatus, 'UPCOMING');
    },
  );
});
