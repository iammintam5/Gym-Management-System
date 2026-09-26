const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Subscription Freezes & Retention Integration Tests', async (t) => {
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

  // ========================================================
  // 1. Authenticate Actors
  // ========================================================
  const adminRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@gym.com',
      password: 'Admin@123456',
    }),
  });
  assert.equal(adminRes.status, 200);
  const adminToken = (await adminRes.json()).tokens.accessToken;

  const staffRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'staff@gym.com',
      password: 'Staff@123456',
    }),
  });
  assert.equal(staffRes.status, 200);
  const staffToken = (await staffRes.json()).tokens.accessToken;

  // ========================================================
  // 2. Setup Test Members & Plan
  // ========================================================
  const member1Email = `freeze.m1.${Date.now()}@gym.local`;
  const m1Res = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: member1Email,
      password: 'Password@123456',
      fullName: 'Freeze Test Member One',
      phone: `090${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(m1Res.status, 201);
  const m1Data = await m1Res.json();
  const member1Id = m1Data.id;

  const m1LoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: member1Email,
      password: 'Password@123456',
    }),
  });
  assert.equal(m1LoginRes.status, 200);
  const member1Token = (await m1LoginRes.json()).tokens.accessToken;

  const member2Email = `freeze.m2.${Date.now()}@gym.local`;
  const m2Res = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: member2Email,
      password: 'Password@123456',
      fullName: 'Freeze Test Member Two',
      phone: `091${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(m2Res.status, 201);
  const m2Data = await m2Res.json();
  const member2Id = m2Data.id;

  const m2LoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: member2Email,
      password: 'Password@123456',
    }),
  });
  assert.equal(m2LoginRes.status, 200);
  const member2Token = (await m2LoginRes.json()).tokens.accessToken;

  // Membership Plan
  const planRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Freeze Test Plan ${Date.now()}`,
      durationDays: 30,
      price: 1000000,
      isActive: true,
      entitlements: [{ service: 'GYM_ACCESS', limitType: 'UNLIMITED' }],
    }),
  });
  assert.equal(planRes.status, 201);
  const planId = (await planRes.json()).id;

  // Create Subscriptions
  const sub1Res = await request('subscriptions', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      memberId: member1Id,
      planId,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(sub1Res.status, 201);
  const sub1 = await sub1Res.json();
  const sub1Id = sub1.id;

  const sub2Res = await request('subscriptions', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      memberId: member2Id,
      planId,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(sub2Res.status, 201);
  const sub2Id = (await sub2Res.json()).id;

  let testFreeze1Id = null;

  // ========================================================
  // Test 1: Member creates freeze request (REQUESTED status)
  // ========================================================
  await t.test('POST /api/subscriptions/:id/freezes - Member requests 14-day freeze', async () => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 2);
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + 14);

    const res = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: member1Token,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Đi công tác xa 2 tuần',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.subscriptionId, sub1Id);
    assert.equal(data.status, 'REQUESTED');
    assert.equal(data.freezeDays, 14);
    assert.equal(data.reason, 'Đi công tác xa 2 tuần');
    assert.equal(data.approvedBy, null);
    testFreeze1Id = data.id;
  });

  // ========================================================
  // Test 2: Policy validation: Min 7 days & Max 60 days
  // ========================================================
  await t.test('POST /api/subscriptions/:id/freezes - Rejects out-of-policy duration (< 7 or > 60)', async () => {
    const now = new Date();
    // 5 days
    const endsShort = new Date(now);
    endsShort.setDate(endsShort.getDate() + 5);

    const resShort = await request(`subscriptions/${sub2Id}/freezes`, {
      method: 'POST',
      token: member2Token,
      body: JSON.stringify({
        startsAt: now.toISOString(),
        endsAt: endsShort.toISOString(),
        reason: 'Nghỉ ngắn 5 ngày',
      }),
    });
    assert.equal(resShort.status, 400);

    // 70 days
    const endsLong = new Date(now);
    endsLong.setDate(endsLong.getDate() + 70);

    const resLong = await request(`subscriptions/${sub2Id}/freezes`, {
      method: 'POST',
      token: member2Token,
      body: JSON.stringify({
        startsAt: now.toISOString(),
        endsAt: endsLong.toISOString(),
        reason: 'Nghỉ dài 70 ngày',
      }),
    });
    assert.equal(resLong.status, 400);
  });

  // ========================================================
  // Test 3: Concurrency & Overlap Guard
  // ========================================================
  await t.test('POST /api/subscriptions/:id/freezes - Rejects duplicate/overlapping freeze while pending', async () => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 5);
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + 10);

    const res = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: member1Token,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Yêu cầu thứ 2 khi cái 1 chưa duyệt',
      }),
    });
    assert.equal(res.status, 409);
  });

  // ========================================================
  // Test 4: RBAC & Security Enforcement
  // ========================================================
  await t.test('RBAC - Member cannot freeze others subscriptions or approve freezes', async () => {
    // Member 2 tries to freeze Member 1's sub
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + 10);

    const freezeOtherRes = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: member2Token,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Hacking others freeze',
      }),
    });
    assert.equal(freezeOtherRes.status, 403);

    // Member 1 tries to approve their own freeze
    const approveRes = await request(`freezes/${testFreeze1Id}/approve`, {
      method: 'POST',
      token: member1Token,
    });
    assert.equal(approveRes.status, 403);
  });

  // ========================================================
  // Test 5: Rejection Workflow
  // ========================================================
  await t.test('POST /api/freezes/:id/reject - Admin rejects freeze request', async () => {
    const rejectRes = await request(`freezes/${testFreeze1Id}/reject`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        reason: 'Chưa nộp minh chứng công tác hợp lệ',
      }),
    });
    assert.equal(rejectRes.status, 200);
    const data = await rejectRes.json();
    assert.equal(data.status, 'REJECTED');
    assert.equal(data.reason, 'Chưa nộp minh chứng công tác hợp lệ');
  });

  // ========================================================
  // Test 6: Immediate Approval & Checkin Gate Suspension
  // ========================================================
  let activeFreezeId = null;
  let chainedChildId = null;
  await t.test('POST /api/subscriptions/:id/freezes & Check-in - Suspension Gate Enforcement', async () => {
    // 1. Add an UPCOMING chained renewal to sub1 while it is ACTIVE
    const renewRes = await request(`subscriptions/${sub1Id}/renew`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        planId,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
      }),
    });
    assert.equal(renewRes.status, 201);
    const chainedChild = await renewRes.json();
    assert.equal(chainedChild.storedStatus, 'UPCOMING');
    chainedChildId = chainedChild.id;

    // 2. Member 1 submits a freeze starting today for 14 days
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + 14);

    const createRes = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: member1Token,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Chấn thương cần bảo lưu khẩn cấp',
      }),
    });
    assert.equal(createRes.status, 201);
    activeFreezeId = (await createRes.json()).id;

    // Staff approves the freeze
    const approveRes = await request(`freezes/${activeFreezeId}/approve`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(approveRes.status, 200);
    const approvedData = await approveRes.json();
    assert.equal(approvedData.status, 'APPROVED');

    // Verify subscription status is now SUSPENDED
    const subCheck = await db.client.subscription.findUnique({
      where: { id: sub1Id },
    });
    assert.equal(subCheck.status, 'SUSPENDED');

    // Attempt check-in -> Must be rejected with SUSPENDED reason (POST /api/checkins returns 200)
    const checkinRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: member1Id,
      }),
    });
    assert.equal(checkinRes.status, 200);
    const checkinData = await checkinRes.json();
    assert.equal(checkinData.status, 'REJECTED');
    assert.equal(
      checkinData.rejectionReason,
      'Gói tập đang trong thời gian bảo lưu (SUSPENDED)',
    );
  });

  // ========================================================
  // Test 7: Unfreeze & EndDate Extension (with chained renewal shifting)
  // ========================================================
  await t.test('POST /api/freezes/:id/unfreeze - Restores ACTIVE, extends endDate & shifts chained renewals', async () => {
    const sub1Before = await db.client.subscription.findUnique({
      where: { id: sub1Id },
    });
    const oldEndDateMs = new Date(sub1Before.endDate).getTime();

    // 1. Perform Unfreeze
    const unfreezeRes = await request(`freezes/${activeFreezeId}/unfreeze`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(unfreezeRes.status, 200);
    const unfreezeData = await unfreezeRes.json();
    assert.equal(unfreezeData.status, 'COMPLETED');
    assert.ok(unfreezeData.restoredAt);

    // 2. Verify sub1 endDate extended by 14 days and status is ACTIVE
    const sub1After = await db.client.subscription.findUnique({
      where: { id: sub1Id },
    });
    assert.equal(sub1After.status, 'ACTIVE');
    const newEndDateMs = new Date(sub1After.endDate).getTime();
    const expectedDiffMs = 14 * 24 * 60 * 60 * 1000;
    assert.equal(newEndDateMs - oldEndDateMs, expectedDiffMs);

    // 3. Verify chained child sub's startDate shifted to match parent's newEndDate
    const childAfter = await db.client.subscription.findUnique({
      where: { id: chainedChildId },
    });
    assert.equal(
      new Date(childAfter.startDate).getTime(),
      new Date(sub1After.endDate).getTime(),
    );
  });

  // ========================================================
  // Test 8: Idempotency Protection (prevent double unfreeze)
  // ========================================================
  await t.test('POST /api/freezes/:id/unfreeze - Prevents double extension (409 Conflict)', async () => {
    const doubleRes = await request(`freezes/${activeFreezeId}/unfreeze`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(doubleRes.status, 409);
  });

  // ========================================================
  // Test 9: Max 2 Freezes Limit per Subscription
  // ========================================================
  await t.test('Policy - Enforces maximum 2 freezes per subscription', async () => {
    // Create 2nd freeze (Staff creates & auto-approves)
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setDate(endsAt.getDate() + 7);

    const freeze2Res = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Bảo lưu lần 2',
      }),
    });
    assert.equal(freeze2Res.status, 201);
    const freeze2 = await freeze2Res.json();
    assert.equal(freeze2.status, 'APPROVED');

    // Unfreeze 2nd freeze
    const unfreeze2Res = await request(`freezes/${freeze2.id}/unfreeze`, {
      method: 'POST',
      token: adminToken,
    });
    assert.equal(unfreeze2Res.status, 200);

    // Attempt 3rd freeze -> Should be rejected (exceeds max 2)
    const freeze3Res = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'POST',
      token: member1Token,
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: 'Bảo lưu lần 3 (vượt chính sách)',
      }),
    });
    assert.equal(freeze3Res.status, 400);
  });

  // ========================================================
  // Test 10: Freeze History & Query Endpoints
  // ========================================================
  await t.test('GET /api/subscriptions/:id/freezes & /api/freezes - Querying history', async () => {
    // Subscription history
    const historyRes = await request(`subscriptions/${sub1Id}/freezes`, {
      method: 'GET',
      token: member1Token,
    });
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json();
    assert.ok(Array.isArray(history));
    assert.ok(history.length >= 3); // 1 rejected + 2 completed

    // Staff lists all freezes
    const allRes = await request('freezes?limit=5', {
      method: 'GET',
      token: staffToken,
    });
    assert.equal(allRes.status, 200);
    const allData = await allRes.json();
    assert.ok(Array.isArray(allData.data));
    assert.ok(allData.meta.total >= 3);

    // Detail lookup
    const detailRes = await request(`freezes/${testFreeze1Id}`, {
      method: 'GET',
      token: member1Token,
    });
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.id, testFreeze1Id);
    assert.equal(detail.status, 'REJECTED');
  });
});
