const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('PT Bookings & Trainer Availability Integration Tests', async (t) => {
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

  // 2. Setup Trainer 1 (PT)
  const ptEmail1 = `pt.one.${Date.now()}@gym.local`;
  const ptRes1 = await request('employees', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: ptEmail1,
      fullName: 'Coach David PT',
      role: 'PT',
      phone: `098${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(ptRes1.status, 201);
  const trainer1 = await ptRes1.json();

  const ptLogin1 = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: ptEmail1,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(ptLogin1.status, 200);
  const ptToken1 = (await ptLogin1.json()).tokens.accessToken;

  // 3. Setup Trainer 2 (PT)
  const ptEmail2 = `pt.two.${Date.now()}@gym.local`;
  const ptRes2 = await request('employees', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: ptEmail2,
      fullName: 'Coach Michael PT',
      role: 'PT',
      phone: `097${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(ptRes2.status, 201);
  const trainer2 = await ptRes2.json();

  const ptLogin2 = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: ptEmail2,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(ptLogin2.status, 200);
  const _ptToken2 = (await ptLogin2.json()).tokens.accessToken;

  // 4. Setup Member A (has PT plan with 5 sessions)
  const memberAEmail = `pt.member.a.${Date.now()}@gym.local`;
  const memberARes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberAEmail,
      password: 'Password@123456',
      fullName: 'Alice PT Member',
      phone: `091${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(memberARes.status, 201);
  const memberAProfile = await memberARes.json();

  const memberALogin = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: memberAEmail,
      password: 'Password@123456',
    }),
  });
  assert.equal(memberALogin.status, 200);
  const memberAToken = (await memberALogin.json()).tokens.accessToken;

  // 5. Setup Member B (has PT plan with 3 sessions)
  const memberBEmail = `pt.member.b.${Date.now()}@gym.local`;
  const memberBRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberBEmail,
      password: 'Password@123456',
      fullName: 'Bob PT Member',
      phone: `092${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(memberBRes.status, 201);
  const memberBProfile = await memberBRes.json();

  const memberBLogin = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: memberBEmail,
      password: 'Password@123456',
    }),
  });
  assert.equal(memberBLogin.status, 200);
  const memberBToken = (await memberBLogin.json()).tokens.accessToken;

  // 6. Setup Member C (has CLASS only plan, NO PT entitlement)
  const memberCEmail = `pt.member.c.${Date.now()}@gym.local`;
  const memberCRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberCEmail,
      password: 'Password@123456',
      fullName: 'Charlie No-PT Member',
      phone: `093${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(memberCRes.status, 201);
  const memberCProfile = await memberCRes.json();

  const memberCLogin = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: memberCEmail,
      password: 'Password@123456',
    }),
  });
  assert.equal(memberCLogin.status, 200);
  const memberCToken = (await memberCLogin.json()).tokens.accessToken;

  // 7. Setup Membership Plans
  // Plan with PT entitlement (5 sessions)
  const ptPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `PT 5-Sessions Plan ${Date.now()}`,
      durationDays: 30,
      price: 1500000,
      isActive: true,
      entitlements: [
        { service: 'PT', limitType: 'COUNT', limitValue: 5 },
      ],
    }),
  });
  assert.equal(ptPlanRes.status, 201);
  const ptPlanId = (await ptPlanRes.json()).id;

  // Plan with CLASS only (NO PT)
  const classPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Class-Only Plan ${Date.now()}`,
      durationDays: 30,
      price: 500000,
      isActive: true,
      entitlements: [
        { service: 'CLASS', limitType: 'COUNT', limitValue: 10 },
      ],
    }),
  });
  assert.equal(classPlanRes.status, 201);
  const classPlanId = (await classPlanRes.json()).id;

  // Subscribe Member A to PT plan
  const subARes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: memberAProfile.id,
      planId: ptPlanId,
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(subARes.status, 201);
  const subA = await subARes.json();

  // Subscribe Member B to PT plan
  const subBRes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: memberBProfile.id,
      planId: ptPlanId,
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(subBRes.status, 201);
  const subB = await subBRes.json();

  // Subscribe Member C to Class-only plan
  const subCRes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: memberCProfile.id,
      planId: classPlanId,
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(subCRes.status, 201);

  // Setup Date times: 2 days in the future (> 6 hours)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 2);
  targetDate.setHours(14, 0, 0, 0);

  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setHours(18, 0, 0, 0);

  let createdAvailabilityId = null;
  let memberABookingId = null;

  // ========================================================
  // Test 1: PT Availability Registration
  // ========================================================
  await t.test('POST /api/trainers/me/availabilities - PT registers availability window', async () => {
    const res = await request('trainers/me/availabilities', {
      method: 'POST',
      token: ptToken1,
      body: JSON.stringify({
        startsAt: targetDate.toISOString(),
        endsAt: targetDateEnd.toISOString(),
        note: 'Afternoon strength & conditioning availability',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.trainerId, trainer1.id);
    assert.equal(data.isAvailable, true);
    createdAvailabilityId = data.id;
  });

  await t.test('POST /api/trainers/me/availabilities - Reject overlapping availability', async () => {
    // Overlapping slot: 15:00 - 17:00 inside the 14:00 - 18:00 window
    const overlapStart = new Date(targetDate);
    overlapStart.setHours(15, 0, 0, 0);
    const overlapEnd = new Date(targetDate);
    overlapEnd.setHours(17, 0, 0, 0);

    const res = await request('trainers/me/availabilities', {
      method: 'POST',
      token: ptToken1,
      body: JSON.stringify({
        startsAt: overlapStart.toISOString(),
        endsAt: overlapEnd.toISOString(),
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('GET /api/trainers/:trainerId/availabilities - Public lookup returns slots', async () => {
    const res = await request(`trainers/${trainer1.id}/availabilities`, {
      method: 'GET',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
    const found = data.find((s) => s.id === createdAvailabilityId);
    assert.ok(found);
  });

  // ========================================================
  // Test 2: Member Books 1-on-1 PT Session
  // ========================================================
  await t.test('POST /api/pt-bookings - Member reserves PT session with quota reservation', async () => {
    // 14:00 - 15:00 session
    const sessionStart = new Date(targetDate);
    sessionStart.setHours(14, 0, 0, 0);
    const sessionEnd = new Date(targetDate);
    sessionEnd.setHours(15, 0, 0, 0);

    const res = await request('pt-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: sessionStart.toISOString(),
        endsAt: sessionEnd.toISOString(),
        availabilityId: createdAvailabilityId,
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.trainerId, trainer1.id);
    assert.equal(data.memberId, memberAProfile.id);
    assert.equal(data.status, 'BOOKED');
    assert.equal(data.attendance, 'PENDING');
    memberABookingId = data.id;

    // Verify SubscriptionQuota: reserved incremented from 0 to 1
    const quota = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: subA.id },
    });
    assert.equal(quota.reserved, 1);
    assert.equal(quota.used, 0);

    // Verify QuotaTransaction (type: RESERVE, reservedDelta: 1)
    const reserveTx = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: quota.id,
        type: 'RESERVE',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(reserveTx);
    assert.equal(reserveTx.reservedDelta, 1);
    assert.equal(reserveTx.referenceType, 'PT_BOOKING');
  });

  // ========================================================
  // Test 3: Rejections (No Quota & Schedule Conflicts)
  // ========================================================
  await t.test('POST /api/pt-bookings - Reject booking for member without PT quota', async () => {
    const sessionStart = new Date(targetDate);
    sessionStart.setHours(16, 0, 0, 0);
    const sessionEnd = new Date(targetDate);
    sessionEnd.setHours(17, 0, 0, 0);

    const res = await request('pt-bookings', {
      method: 'POST',
      token: memberCToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: sessionStart.toISOString(),
        endsAt: sessionEnd.toISOString(),
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('POST /api/pt-bookings - Trainer conflict rejects overlapping booking (409)', async () => {
    // Member B attempts to book trainer1 at 14:30 - 15:30 (overlaps Member A's 14:00 - 15:00)
    const overlapStart = new Date(targetDate);
    overlapStart.setHours(14, 30, 0, 0);
    const overlapEnd = new Date(targetDate);
    overlapEnd.setHours(15, 30, 0, 0);

    const res = await request('pt-bookings', {
      method: 'POST',
      token: memberBToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: overlapStart.toISOString(),
        endsAt: overlapEnd.toISOString(),
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('POST /api/pt-bookings - Member conflict rejects double booking same member (409)', async () => {
    // Member A attempts to book trainer2 at the same time (14:00 - 15:00)
    const sameStart = new Date(targetDate);
    sameStart.setHours(14, 0, 0, 0);
    const sameEnd = new Date(targetDate);
    sameEnd.setHours(15, 0, 0, 0);

    const res = await request('pt-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({
        trainerId: trainer2.id,
        startsAt: sameStart.toISOString(),
        endsAt: sameEnd.toISOString(),
      }),
    });
    assert.equal(res.status, 409);
  });

  // ========================================================
  // Test 4: Cancellation Policy & Quota Refund
  // ========================================================
  await t.test('POST /api/pt-bookings/:id/cancel - Cancellation > 6 hours refunds quota', async () => {
    const cancelRes = await request(`pt-bookings/${memberABookingId}/cancel`, {
      method: 'POST',
      token: memberAToken,
    });
    assert.equal(cancelRes.status, 200);
    const cancelled = await cancelRes.json();
    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(cancelled.cancelledAt);

    // Verify Quota: reserved decremented back to 0
    const quota = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: subA.id },
    });
    assert.equal(quota.reserved, 0);

    // Verify QuotaTransaction (type: REFUND, reservedDelta: -1)
    const refundTx = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: quota.id,
        type: 'REFUND',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(refundTx);
    assert.equal(refundTx.reservedDelta, -1);
  });

  await t.test('POST /api/pt-bookings/:id/cancel - Cutoff < 6 hours rejects member cancellation', async () => {
    // Create a near session starting in 2 hours (< 6 hours cutoff)
    const nearStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 60 * 60 * 1000);

    const bookNearRes = await request('pt-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: nearStart.toISOString(),
        endsAt: nearEnd.toISOString(),
      }),
    });
    assert.equal(bookNearRes.status, 201);
    const nearBooking = await bookNearRes.json();

    // Member attempts self-cancellation < 6 hours -> 400 Bad Request
    const lateCancelRes = await request(`pt-bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      token: memberAToken,
    });
    assert.equal(lateCancelRes.status, 400);

    // Staff override cancellation succeeds -> 200 OK
    const staffCancelRes = await request(`pt-bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(staffCancelRes.status, 200);
    const staffCancelled = await staffCancelRes.json();
    assert.equal(staffCancelled.status, 'CANCELLED');
  });

  // ========================================================
  // Test 5: Session Completion & Quota Consumption
  // ========================================================
  await t.test('POST /api/pt-bookings/:id/complete - Trainer completes session & consumes quota', async () => {
    // Member B books slot with Trainer 1
    const sessionStart = new Date(targetDate);
    sessionStart.setHours(15, 0, 0, 0);
    const sessionEnd = new Date(targetDate);
    sessionEnd.setHours(16, 0, 0, 0);

    const bookBRes = await request('pt-bookings', {
      method: 'POST',
      token: memberBToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: sessionStart.toISOString(),
        endsAt: sessionEnd.toISOString(),
      }),
    });
    assert.equal(bookBRes.status, 201);
    const bookingB = await bookBRes.json();

    // Member attempts to complete session -> 403 Forbidden
    const memberCompleteRes = await request(`pt-bookings/${bookingB.id}/complete`, {
      method: 'POST',
      token: memberBToken,
    });
    assert.equal(memberCompleteRes.status, 403);

    // Trainer completes session -> 200 OK
    const completeRes = await request(`pt-bookings/${bookingB.id}/complete`, {
      method: 'POST',
      token: ptToken1,
    });
    assert.equal(completeRes.status, 200);
    const completedData = await completeRes.json();
    assert.equal(completedData.status, 'COMPLETED');
    assert.equal(completedData.attendance, 'PRESENT');
    assert.ok(completedData.attendedAt);

    // Verify Quota: reserved decreases by 1, used increases by 1
    const quotaB = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: subB.id },
    });
    assert.equal(quotaB.reserved, 0);
    assert.equal(quotaB.used, 1);

    // Verify QuotaTransaction (type: USE, reservedDelta: -1, usedDelta: 1)
    const useTx = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: quotaB.id,
        type: 'USE',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(useTx);
    assert.equal(useTx.reservedDelta, -1);
    assert.equal(useTx.usedDelta, 1);
  });

  // ========================================================
  // Test 6: Mark ABSENT (Forfeits Quota as NO_SHOW)
  // ========================================================
  await t.test('POST /api/pt-bookings/:id/attendance - Mark ABSENT forfeits quota as NO_SHOW', async () => {
    // Member B books second slot
    const sessionStart = new Date(targetDate);
    sessionStart.setHours(16, 0, 0, 0);
    const sessionEnd = new Date(targetDate);
    sessionEnd.setHours(17, 0, 0, 0);

    const bookB2Res = await request('pt-bookings', {
      method: 'POST',
      token: memberBToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: sessionStart.toISOString(),
        endsAt: sessionEnd.toISOString(),
      }),
    });
    assert.equal(bookB2Res.status, 201);
    const bookingB2 = await bookB2Res.json();

    // Trainer marks ABSENT -> 200 OK
    const absentRes = await request(`pt-bookings/${bookingB2.id}/attendance`, {
      method: 'POST',
      token: ptToken1,
      body: JSON.stringify({ attendance: 'ABSENT' }),
    });
    assert.equal(absentRes.status, 200);
    const absentData = await absentRes.json();
    assert.equal(absentData.status, 'NO_SHOW');
    assert.equal(absentData.attendance, 'ABSENT');

    // Verify Quota: used increases to 2, reserved is 0
    const quotaB = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: subB.id },
    });
    assert.equal(quotaB.reserved, 0);
    assert.equal(quotaB.used, 2);
  });

  // ========================================================
  // Test 7: Queries (findMyBookings & findTrainerBookings)
  // ========================================================
  await t.test('GET /api/pt-bookings/my & GET /api/pt-bookings/trainer', async () => {
    // Member B queries own bookings
    const myRes = await request('pt-bookings/my', {
      method: 'GET',
      token: memberBToken,
    });
    assert.equal(myRes.status, 200);
    const myBookings = await myRes.json();
    assert.ok(myBookings.data.length >= 2);
    assert.ok(myBookings.meta.total >= 2);

    // Trainer 1 queries booked sessions
    const trainerRes = await request('pt-bookings/trainer', {
      method: 'GET',
      token: ptToken1,
    });
    assert.equal(trainerRes.status, 200);
    const trainerBookings = await trainerRes.json();
    assert.ok(trainerBookings.data.length >= 2);
    assert.ok(trainerBookings.meta.total >= 2);
  });

  // ========================================================
  // Test 8: Availability Deletion Guards
  // ========================================================
  await t.test('DELETE /api/trainers/me/availabilities/:id - Guard against active booking & clean delete', async () => {
    // 1. Create a fresh availability slot
    const freshStart = new Date(targetDate);
    freshStart.setDate(freshStart.getDate() + 3);
    const freshEnd = new Date(freshStart);
    freshEnd.setHours(freshStart.getHours() + 2);

    const availRes = await request('trainers/me/availabilities', {
      method: 'POST',
      token: ptToken1,
      body: JSON.stringify({
        startsAt: freshStart.toISOString(),
        endsAt: freshEnd.toISOString(),
        note: 'Deletable slot test',
      }),
    });
    assert.equal(availRes.status, 201);
    const avail = await availRes.json();

    // 2. Member A books inside this availability
    const bookRes = await request('pt-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({
        trainerId: trainer1.id,
        startsAt: freshStart.toISOString(),
        endsAt: freshEnd.toISOString(),
        availabilityId: avail.id,
      }),
    });
    assert.equal(bookRes.status, 201);
    const bookedSession = await bookRes.json();

    // 3. PT attempts to delete availability with active booking -> 409 Conflict
    const delConflictRes = await request(`trainers/me/availabilities/${avail.id}`, {
      method: 'DELETE',
      token: ptToken1,
    });
    assert.equal(delConflictRes.status, 409);

    // 4. Cancel the booking first
    const cancelRes = await request(`pt-bookings/${bookedSession.id}/cancel`, {
      method: 'POST',
      token: memberAToken,
    });
    assert.equal(cancelRes.status, 200);

    // 5. Now delete succeeds -> 200 OK
    const delSuccessRes = await request(`trainers/me/availabilities/${avail.id}`, {
      method: 'DELETE',
      token: ptToken1,
    });
    assert.equal(delSuccessRes.status, 200);
  });
});
