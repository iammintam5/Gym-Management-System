const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Phase 7 - Subscription Core Integration Tests', async (t) => {
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

  // Retrieve existing seeded member profile ID
  const memberMeRes = await request('members/me', { token: memberToken });
  assert.equal(memberMeRes.status, 200);
  const memberProfile = await memberMeRes.json();
  const testMemberId = memberProfile.id;

  // Create an active Membership Plan for testing
  const planPayload = {
    name: `Sub Test Plan ${Date.now()}`,
    description: 'Plan for subscription integration testing',
    durationDays: 30,
    price: 600000,
    isActive: true,
    entitlements: [
      { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
      { service: 'CLASS', limitType: 'COUNT', limitValue: 8 },
      { service: 'PT', limitType: 'COUNT', limitValue: 2 },
    ],
  };
  const planCreateRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify(planPayload),
  });
  assert.equal(planCreateRes.status, 201);
  const testPlan = await planCreateRes.json();
  const testPlanId = testPlan.id;

  // Create an inactive Membership Plan for testing
  const inactivePlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Inactive Plan ${Date.now()}`,
      durationDays: 30,
      price: 400000,
      isActive: false,
    }),
  });
  assert.equal(inactivePlanRes.status, 201);
  const inactivePlanId = (await inactivePlanRes.json()).id;

  // Create a separate test member for queueing tests
  const newMemberRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: `sub.member.${Date.now()}@test.com`,
      fullName: 'Subscription Test Member',
      phone: `098${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(newMemberRes.status, 201);
  const newMember = await newMemberRes.json();
  const queueTestMemberId = newMember.id;

  let firstSubId = '';
  let secondSubId = '';

  // 1. RBAC on Subscription Creation
  await t.test('POST /api/subscriptions - RBAC enforcement', async () => {
    const payload = {
      memberId: testMemberId,
      planId: testPlanId,
    };

    // PT forbidden
    const ptRes = await request('subscriptions', {
      method: 'POST',
      token: ptToken,
      body: JSON.stringify(payload),
    });
    assert.equal(ptRes.status, 403);

    // Member forbidden
    const memberRes = await request('subscriptions', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify(payload),
    });
    assert.equal(memberRes.status, 403);

    // Unauthenticated unauthorized
    const unauthRes = await request('subscriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(unauthRes.status, 401);
  });

  // 2. Validations on Subscription Creation
  await t.test('POST /api/subscriptions - Validation rules', async () => {
    // Non-existent member
    const res1 = await request('subscriptions', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        memberId: '00000000-0000-0000-0000-000000000000',
        planId: testPlanId,
      }),
    });
    assert.equal(res1.status, 404);

    // Non-existent plan
    const res2 = await request('subscriptions', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        memberId: queueTestMemberId,
        planId: '00000000-0000-0000-0000-000000000000',
      }),
    });
    assert.equal(res2.status, 404);

    // Inactive plan rejected
    const res3 = await request('subscriptions', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        memberId: queueTestMemberId,
        planId: inactivePlanId,
      }),
    });
    assert.equal(res3.status, 409);

    // Invalid UUID
    const res4 = await request('subscriptions', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        memberId: 'not-a-uuid',
        planId: testPlanId,
      }),
    });
    assert.equal(res4.status, 400);
  });

  // 3. Admin / Staff Create First Subscription (ACTIVE)
  await t.test('POST /api/subscriptions - Create first subscription (ACTIVE + Quotas + Payment)', async () => {
    const payload = {
      memberId: queueTestMemberId,
      planId: testPlanId,
      paymentMethod: 'CASH',
      note: 'In-person counter purchase',
    };

    const res = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.memberId, queueTestMemberId);
    assert.equal(data.planId, testPlanId);
    assert.equal(data.storedStatus, 'ACTIVE');
    assert.equal(data.effectiveStatus, 'ACTIVE');
    assert.equal(data.paymentStatus, 'PAID');
    assert.equal(data.agreedPrice, 600000);
    assert.ok(data.activatedAt);
    assert.equal(data.previousSubscriptionId, null);

    // Verify snapshot quotas
    assert.ok(Array.isArray(data.quotas));
    assert.equal(data.quotas.length, 3);
    const gymQuota = data.quotas.find((q) => q.service === 'GYM_ACCESS');
    assert.ok(gymQuota);
    assert.equal(gymQuota.allocated, null);

    const classQuota = data.quotas.find((q) => q.service === 'CLASS');
    assert.ok(classQuota);
    assert.equal(classQuota.allocated, 8);

    const ptQuota = data.quotas.find((q) => q.service === 'PT');
    assert.ok(ptQuota);
    assert.equal(ptQuota.allocated, 2);

    // Verify payments record
    assert.ok(Array.isArray(data.payments));
    assert.equal(data.payments.length, 1);
    assert.equal(data.payments[0].amount, 600000);
    assert.equal(data.payments[0].status, 'PAID');
    assert.equal(data.payments[0].method, 'CASH');

    firstSubId = data.id;
  });

  // 4. Create Second Subscription for Same Member (Queued as UPCOMING)
  await t.test('POST /api/subscriptions - Second subscription queued as UPCOMING after first', async () => {
    const payload = {
      memberId: queueTestMemberId,
      planId: testPlanId,
      paymentMethod: 'TRANSFER',
    };

    const res = await request('subscriptions', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.storedStatus, 'UPCOMING');
    assert.equal(data.effectiveStatus, 'UPCOMING');
    assert.equal(data.previousSubscriptionId, firstSubId);

    // Fetch first subscription to verify its endDate matches second subscription's startDate
    const firstSubDetail = await (
      await request(`subscriptions/${firstSubId}`, { token: adminToken })
    ).json();
    assert.equal(data.startDate, firstSubDetail.endDate);

    secondSubId = data.id;
  });

  // 5. Admin & Staff List Subscriptions with Search, Filter & Pagination
  await t.test('GET /api/subscriptions - List, search, filter, pagination', async () => {
    // Admin listing
    const resAdmin = await request('subscriptions?page=1&limit=10', {
      token: adminToken,
    });
    assert.equal(resAdmin.status, 200);
    const listAdmin = await resAdmin.json();
    assert.ok(Array.isArray(listAdmin.data));
    assert.ok(listAdmin.meta);
    assert.equal(listAdmin.meta.page, 1);
    assert.equal(listAdmin.meta.limit, 10);
    assert.ok(listAdmin.meta.total >= 2);

    // Staff listing
    const resStaff = await request('subscriptions', { token: staffToken });
    assert.equal(resStaff.status, 200);

    // Member & PT forbidden
    const resMember = await request('subscriptions', { token: memberToken });
    assert.equal(resMember.status, 403);

    const resPT = await request('subscriptions', { token: ptToken });
    assert.equal(resPT.status, 403);

    // Filter by memberId
    const resFilterMember = await request(`subscriptions?memberId=${queueTestMemberId}`, {
      token: adminToken,
    });
    assert.equal(resFilterMember.status, 200);
    const dataMemberSubs = await resFilterMember.json();
    assert.equal(dataMemberSubs.data.length, 2);

    // Filter by status UPCOMING
    const resFilterUpcoming = await request('subscriptions?status=UPCOMING', {
      token: adminToken,
    });
    assert.equal(resFilterUpcoming.status, 200);
    const dataUpcoming = await resFilterUpcoming.json();
    assert.ok(dataUpcoming.data.some((s) => s.id === secondSubId));
  });

  // 6. Get Subscription Details by ID
  await t.test('GET /api/subscriptions/:id - Details lookup', async () => {
    const res = await request(`subscriptions/${firstSubId}`, {
      token: adminToken,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, firstSubId);
    assert.equal(data.memberId, queueTestMemberId);
    assert.equal(data.storedStatus, 'ACTIVE');
    assert.equal(data.effectiveStatus, 'ACTIVE');

    // Non-existent ID -> 404
    const notFoundRes = await request('subscriptions/00000000-0000-0000-0000-000000000000', {
      token: adminToken,
    });
    assert.equal(notFoundRes.status, 404);
  });

  // 7. Member History & Current Subscription (Admin/Staff routes)
  await t.test('GET /api/members/:memberId/subscriptions & current', async () => {
    // All history for member
    const historyRes = await request(`members/${queueTestMemberId}/subscriptions`, {
      token: staffToken,
    });
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json();
    assert.equal(history.length, 2);

    // Current active subscription for member
    const currentRes = await request(`members/${queueTestMemberId}/subscriptions/current`, {
      token: staffToken,
    });
    assert.equal(currentRes.status, 200);
    const currentSub = await currentRes.json();
    assert.equal(currentSub.id, firstSubId);
    assert.equal(currentSub.storedStatus, 'ACTIVE');
  });

  // 8. Member Self-Service Subscriptions
  await t.test('GET /api/subscriptions/me & /api/subscriptions/me/current (Self-service)', async () => {
    // Authenticated member checks own subscriptions
    const meRes = await request('subscriptions/me', { token: memberToken });
    assert.equal(meRes.status, 200);
    const meSubs = await meRes.json();
    assert.ok(Array.isArray(meSubs));

    // Staff cannot call /me (role is STAFF, not MEMBER)
    const staffMeRes = await request('subscriptions/me', { token: staffToken });
    assert.equal(staffMeRes.status, 403);
  });

  // 9. Cancel Subscription (Admin/Staff)
  await t.test('POST /api/subscriptions/:id/cancel - Cancellation lifecycle', async () => {
    // Member cannot cancel
    const memberCancelRes = await request(`subscriptions/${secondSubId}/cancel`, {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({ reason: 'Member request' }),
    });
    assert.equal(memberCancelRes.status, 403);

    // Cancel without reason -> 400
    const noReasonRes = await request(`subscriptions/${secondSubId}/cancel`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ reason: '   ' }),
    });
    assert.equal(noReasonRes.status, 400);

    // Staff cancels the queued UPCOMING subscription
    const cancelRes = await request(`subscriptions/${secondSubId}/cancel`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ reason: 'Customer changed mind before start' }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelledData = await cancelRes.json();
    assert.equal(cancelledData.storedStatus, 'CANCELLED');
    assert.equal(cancelledData.effectiveStatus, 'CANCELLED');
    assert.ok(cancelledData.cancelledAt);
    assert.equal(cancelledData.cancelReason, 'Customer changed mind before start');

    // Cancelling already cancelled subscription -> 409 Conflict
    const alreadyCancelledRes = await request(`subscriptions/${secondSubId}/cancel`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ reason: 'Try cancel again' }),
    });
    assert.equal(alreadyCancelledRes.status, 409);
  });

  // 10. JIT Promotion: UPCOMING subscription automatically promotes to ACTIVE when startDate is reached
  await t.test('JIT Promotion - UPCOMING subscription auto-promotes to ACTIVE on current query', async () => {
    // Directly update an upcoming subscription in DB to have startDate in the past
    const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
    const futureEndDate = new Date(Date.now() + 86400000 * 30);
    
    // Create new test member
    const jitMemberRes = await request('members', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        email: `jit.test.${Date.now()}@test.com`,
        fullName: 'JIT Test Member',
        phone: `092${Date.now().toString().slice(-7)}`,
      }),
    });
    const jitMember = await jitMemberRes.json();

    // Create UPCOMING subscription directly in DB with past startDate
    const jitSub = await db.client.subscription.create({
      data: {
        memberId: jitMember.id,
        planId: testPlanId,
        startDate: pastDate,
        endDate: futureEndDate,
        status: 'UPCOMING',
        paymentStatus: 'PAID',
        agreedPrice: 500000,
        activatedAt: null,
      },
    });
    assert.equal(jitSub.status, 'UPCOMING');

    // Query current subscription via API
    const currentRes = await request(`members/${jitMember.id}/subscriptions/current`, {
      token: adminToken,
    });
    assert.equal(currentRes.status, 200);
    const currentData = await currentRes.json();
    assert.equal(currentData.id, jitSub.id);
    assert.equal(currentData.storedStatus, 'ACTIVE');
    assert.equal(currentData.effectiveStatus, 'ACTIVE');
    assert.ok(currentData.activatedAt);

    // Verify database record has been updated
    const updatedDbSub = await db.client.subscription.findUnique({
      where: { id: jitSub.id },
    });
    assert.equal(updatedDbSub.status, 'ACTIVE');
    assert.ok(updatedDbSub.activatedAt);
  });

  await t.test('Early Activation: activateNow transforms UPCOMING subscription to ACTIVE immediately', async () => {
    // 1. Create a fresh member
    const earlyMemberRes = await request('members', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        email: `early.sub.${Date.now()}@test.com`,
        fullName: 'Early Activation Member',
        phone: `093${Date.now().toString().slice(-7)}`,
      }),
    });
    const earlyMember = await earlyMemberRes.json();

    // 2. Create subscription with future startDate (e.g. 15 days in future)
    const futureStartDate = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    const subRes = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: earlyMember.id,
        planId: testPlanId,
        startDate: futureStartDate,
        paymentStatus: 'PAID',
      }),
    });
    assert.equal(subRes.status, 201);
    const sub = await subRes.json();
    assert.equal(sub.storedStatus, 'UPCOMING');
    assert.equal(sub.effectiveStatus, 'UPCOMING');
    assert.equal(sub.activatedAt, null);

    // 3. Call activateNow
    const activateRes = await request(`subscriptions/${sub.id}/activate-now`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(activateRes.status, 200);
    const activatedSub = await activateRes.json();
    assert.equal(activatedSub.id, sub.id);
    assert.equal(activatedSub.storedStatus, 'ACTIVE');
    assert.equal(activatedSub.effectiveStatus, 'ACTIVE');
    assert.ok(activatedSub.activatedAt);

    // Verify startDate was shifted to today
    const activatedStartDate = new Date(activatedSub.startDate);
    const now = new Date();
    assert.ok(Math.abs(activatedStartDate.getTime() - now.getTime()) < 60000);

    // 4. Calling activateNow again returns 409 Conflict
    const reActivateRes = await request(`subscriptions/${sub.id}/activate-now`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(reActivateRes.status, 409);
  });
});

