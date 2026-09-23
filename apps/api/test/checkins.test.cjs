const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Phase 10 - Check-ins & Gym Access Control Integration Tests', async (t) => {
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

  // 1. Authenticate Actors
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

  const memberRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'member@gym.com',
      password: 'Member@123456',
    }),
  });
  assert.equal(memberRes.status, 200);
  const memberToken = (await memberRes.json()).tokens.accessToken;

  // 2. Setup Membership Plans
  // Plan A: Unlimited Gym Access
  const unlimitedPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Unlimited Gym Plan ${Date.now()}`,
      durationDays: 30,
      price: 500000,
      isActive: true,
      entitlements: [{ service: 'GYM_ACCESS', limitType: 'UNLIMITED' }],
    }),
  });
  assert.equal(unlimitedPlanRes.status, 201);
  const unlimitedPlanId = (await unlimitedPlanRes.json()).id;

  // Plan B: Finite Count Gym Access (3 sessions)
  const countPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `3-Sessions Gym Plan ${Date.now()}`,
      durationDays: 30,
      price: 200000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'COUNT', limitValue: 3 },
      ],
    }),
  });
  assert.equal(countPlanRes.status, 201);
  const countPlanId = (await countPlanRes.json()).id;

  // Plan C: Class-Only Plan (No GYM_ACCESS)
  const classOnlyPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Class Only Plan ${Date.now()}`,
      durationDays: 30,
      price: 300000,
      isActive: true,
      entitlements: [{ service: 'CLASS', limitType: 'COUNT', limitValue: 10 }],
    }),
  });
  assert.equal(classOnlyPlanRes.status, 201);
  const classOnlyPlanId = (await classOnlyPlanRes.json()).id;

  // 3. Create Test Members
  const memberARes = await request('members', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      email: `checkin.a.${Date.now()}@test.com`,
      fullName: 'Checkin Member A (Unlimited)',
      phone: `091${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(memberARes.status, 201);
  const memberA = await memberARes.json();

  const memberBRes = await request('members', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      email: `checkin.b.${Date.now()}@test.com`,
      fullName: 'Checkin Member B (Count)',
      phone: `092${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(memberBRes.status, 201);
  const memberB = await memberBRes.json();

  const memberCRes = await request('members', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      email: `checkin.c.${Date.now()}@test.com`,
      fullName: 'Checkin Member C (No sub)',
      phone: `093${Date.now().toString().slice(-7)}`,
    }),
  });
  assert.equal(memberCRes.status, 201);
  const memberC = await memberCRes.json();

  // Test 1: RBAC Protection
  await t.test('POST /api/checkins - RBAC enforcement', async () => {
    // Member cannot process check-ins
    const memberAttempt = await request('checkins', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({ memberId: memberA.id }),
    });
    assert.equal(memberAttempt.status, 403);

    // Unauthenticated request is rejected
    const unauthAttempt = await request('checkins', {
      method: 'POST',
      body: JSON.stringify({ memberId: memberA.id }),
    });
    assert.equal(unauthAttempt.status, 401);
  });

  // Test 2: Validation
  await t.test('POST /api/checkins - Input validation', async () => {
    // Missing both memberId and memberCode
    const missingInput = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({}),
    });
    assert.equal(missingInput.status, 400);

    // Non-existent memberId
    const notFoundRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: '00000000-0000-0000-0000-000000000000',
      }),
    });
    assert.equal(notFoundRes.status, 404);
  });

  // Test 3: Checkin with UNLIMITED GYM_ACCESS
  await t.test('POST /api/checkins - Unlimited GYM_ACCESS acceptance', async () => {
    // Purchase unlimited subscription for Member A
    const subRes = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: memberA.id,
        planId: unlimitedPlanId,
        paymentStatus: 'PAID',
      }),
    });
    assert.equal(subRes.status, 201);
    const sub = await subRes.json();
    assert.equal(sub.storedStatus, 'ACTIVE');

    // Checkin by memberCode
    const checkinRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberCode: memberA.memberCode }),
    });
    assert.equal(checkinRes.status, 200);
    const checkin = await checkinRes.json();
    assert.equal(checkin.status, 'ACCEPTED');
    assert.equal(checkin.memberId, memberA.id);
    assert.equal(checkin.subscriptionId, sub.id);
    assert.equal(checkin.rejectionReason, null);

    // Verify DB quota: used is still 0 (unlimited entitlement)
    const quota = await db.client.subscriptionQuota.findUnique({
      where: { id: checkin.quotaId },
    });
    assert.equal(quota.used, 0);
  });

  // Test 4: Anti-Passback Protection (< 5 minutes)
  await t.test('POST /api/checkins - Anti-passback rejection', async () => {
    // Member A just checked in seconds ago -> immediately scan again
    const passbackRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: memberA.id }),
    });
    assert.equal(passbackRes.status, 200);
    const passbackData = await passbackRes.json();
    assert.equal(passbackData.status, 'REJECTED');
    assert.ok(passbackData.rejectionReason.includes('Anti-passback'));
  });

  // Test 5: Checkin with COUNT GYM_ACCESS and Quota Consumption
  await t.test('POST /api/checkins - Count-based quota deduction', async () => {
    // Purchase 3-session subscription for Member B
    const subRes = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: memberB.id,
        planId: countPlanId,
        paymentStatus: 'PAID',
      }),
    });
    assert.equal(subRes.status, 201);
    const _sub = await subRes.json();

    // Check in Member B
    const checkinRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: memberB.id }),
    });
    assert.equal(checkinRes.status, 200);
    const checkin = await checkinRes.json();
    assert.equal(checkin.status, 'ACCEPTED');

    // Verify quota in DB: used incremented from 0 to 1
    const quota = await db.client.subscriptionQuota.findUnique({
      where: { id: checkin.quotaId },
    });
    assert.equal(quota.used, 1);
    assert.equal(quota.allocated, 3);

    // Verify QuotaTransaction created
    const tx = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: checkin.quotaId,
        type: 'USE',
        referenceId: checkin.id,
      },
    });
    assert.ok(tx);
    assert.equal(tx.usedDelta, 1);
  });

  // Test 6: Quota Exhaustion Rejection
  await t.test('POST /api/checkins - Quota exhausted rejection', async () => {
    // Fast-forward quota for Member B to fully used (3/3)
    const sub = await db.client.subscription.findFirst({
      where: { memberId: memberB.id, status: 'ACTIVE' },
      include: { quotas: true },
    });
    const quotaId = sub.quotas[0].id;
    await db.client.subscriptionQuota.update({
      where: { id: quotaId },
      data: { used: 3 },
    });

    // Delete recent checkin for Member B to bypass anti-passback
    await db.client.checkin.deleteMany({
      where: { memberId: memberB.id },
    });

    // Attempt check-in with exhausted quota
    const exhaustedRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: memberB.id }),
    });
    assert.equal(exhaustedRes.status, 200);
    const exhaustedData = await exhaustedRes.json();
    assert.equal(exhaustedData.status, 'REJECTED');
    assert.ok(exhaustedData.rejectionReason.includes('hết số lượt'));
  });

  // Test 7: Rejection when plan has NO GYM_ACCESS
  await t.test('POST /api/checkins - No GYM_ACCESS entitlement rejection', async () => {
    // Purchase Class-only plan for Member C
    await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: memberC.id,
        planId: classOnlyPlanId,
        paymentStatus: 'PAID',
      }),
    });

    const noAccessRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: memberC.id }),
    });
    assert.equal(noAccessRes.status, 200);
    const noAccessData = await noAccessRes.json();
    assert.equal(noAccessData.status, 'REJECTED');
    assert.ok(noAccessData.rejectionReason.includes('GYM_ACCESS'));
  });

  // Test 8: Rejection when Member has NO active subscription
  await t.test('POST /api/checkins - No active subscription rejection', async () => {
    // Create new member without any subscription
    const freshMemberRes = await request('members', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        email: `no.sub.${Date.now()}@test.com`,
        fullName: 'No Sub Member',
        phone: `094${Date.now().toString().slice(-7)}`,
      }),
    });
    const freshMember = await freshMemberRes.json();

    const noSubCheckin = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: freshMember.id }),
    });
    assert.equal(noSubCheckin.status, 200);
    const data = await noSubCheckin.json();
    assert.equal(data.status, 'REJECTED');
    assert.ok(data.rejectionReason.includes('không có gói tập'));
  });

  // Test 9: JIT Activation on Checkin
  await t.test('POST /api/checkins - JIT activation of UPCOMING subscription', async () => {
    // Create new member
    const jitMemberRes = await request('members', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        email: `jit.checkin.${Date.now()}@test.com`,
        fullName: 'JIT Checkin Member',
        phone: `095${Date.now().toString().slice(-7)}`,
      }),
    });
    const jitMember = await jitMemberRes.json();

    // Create UPCOMING subscription directly in DB with past startDate (e.g. 1 hour ago)
    const jitSub = await db.client.subscription.create({
      data: {
        memberId: jitMember.id,
        planId: unlimitedPlanId,
        startDate: new Date(Date.now() - 3600000),
        endDate: new Date(Date.now() + 86400000 * 30),
        status: 'UPCOMING',
        paymentStatus: 'PAID',
        agreedPrice: 500000,
        activatedAt: null,
      },
    });
    // Create quota
    const serviceType = await db.client.serviceType.findUnique({
      where: { code: 'GYM_ACCESS' },
    });
    await db.client.subscriptionQuota.create({
      data: {
        subscriptionId: jitSub.id,
        serviceTypeId: serviceType.id,
        allocated: null,
      },
    });

    // Check in -> Should trigger JIT promotion to ACTIVE and ACCEPT
    const checkinRes = await request('checkins', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ memberId: jitMember.id }),
    });
    assert.equal(checkinRes.status, 200);
    const checkinData = await checkinRes.json();
    assert.equal(checkinData.status, 'ACCEPTED');

    // Verify subscription status in DB is now ACTIVE with activatedAt
    const updatedSub = await db.client.subscription.findUnique({
      where: { id: jitSub.id },
    });
    assert.equal(updatedSub.status, 'ACTIVE');
    assert.ok(updatedSub.activatedAt);
  });

  // Test 10: Query Checkins and Today Stats
  await t.test('GET /api/checkins & /api/checkins/today-stats', async () => {
    // Query all checkins
    const listRes = await request('checkins', { token: staffToken });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(Array.isArray(list.data));
    assert.ok(list.data.length > 0);
    assert.ok(list.meta.total > 0);

    // Query stats today
    const statsRes = await request('checkins/today-stats', {
      token: staffToken,
    });
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.ok(stats.total > 0);
    assert.equal(stats.total, stats.accepted + stats.rejected);

    // Member self check-in history
    const myHistoryRes = await request('checkins/me', { token: memberToken });
    assert.equal(myHistoryRes.status, 200);
    const myHistory = await myHistoryRes.json();
    assert.ok(Array.isArray(myHistory));
  });
});
