const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Class Bookings & Attendance Integration Tests', async (t) => {
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

  // 2. Setup Test Coach (PT)
  const coachEmail = `coach.b.${Date.now()}@gym.local`;
  const coachRes = await request('employees', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: coachEmail,
      fullName: 'Coach Sarah Yoga',
      role: 'PT',
      phone: `098${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(coachRes.status, 201);
  const coach = await coachRes.json();

  const coachLoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: coachEmail,
      password: 'CoachPassword@123',
    }),
  });
  assert.equal(coachLoginRes.status, 200);
  const coachToken = (await coachLoginRes.json()).tokens.accessToken;

  // 3. Setup Test Members A and B
  const memberAEmail = `member.a.${Date.now()}@gym.local`;
  const memberARes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberAEmail,
      password: 'Password@123456',
      fullName: 'Alice Member Class',
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

  const memberBEmail = `member.b.${Date.now()}@gym.local`;
  const memberBRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberBEmail,
      password: 'Password@123456',
      fullName: 'Bob Member Class',
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

  // 4. Setup Membership Plan with CLASS entitlement (5 sessions)
  const classPlanRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Class 5-Sessions Plan ${Date.now()}`,
      durationDays: 30,
      price: 600000,
      isActive: true,
      entitlements: [
        { service: 'CLASS', limitType: 'COUNT', limitValue: 5 },
      ],
    }),
  });
  assert.equal(classPlanRes.status, 201);
  const classPlanId = (await classPlanRes.json()).id;

  // Subscribe Member A to the Class Plan (ACTIVE immediately)
  const subARes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: memberAProfile.id,
      planId: classPlanId,
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(subARes.status, 201);
  const subA = await subARes.json();

  // Subscribe Member B to the Class Plan
  const subBRes = await request('subscriptions', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      memberId: memberBProfile.id,
      planId: classPlanId,
      paymentStatus: 'PAID',
    }),
  });
  assert.equal(subBRes.status, 201);

  // 5. Setup Gym Class & Schedule (starts tomorrow at 10:00)
  const classRes = await request('classes', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Vinyasa Yoga Flow ${Date.now()}`,
      description: 'Morning yoga session',
    }),
  });
  assert.equal(classRes.status, 201);
  const gymClassId = (await classRes.json()).id;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2); // 2 days in future (> 2 hours)
  tomorrow.setHours(10, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 0, 0, 0);

  const scheduleRes = await request('class-schedules', {
    method: 'POST',
    token: staffToken,
    body: JSON.stringify({
      classId: gymClassId,
      trainerId: coach.id,
      startsAt: tomorrow.toISOString(),
      endsAt: tomorrowEnd.toISOString(),
      capacity: 5,
    }),
  });
  assert.equal(scheduleRes.status, 201);
  const scheduleId = (await scheduleRes.json()).id;

  let memberABookingId = '';

  // ========================================================
  // Test 1: Successful Class Slot Booking & Quota Reservation
  // ========================================================
  await t.test('POST /api/class-bookings - Member reserves class slot', async () => {
    const bookRes = await request('class-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ scheduleId }),
    });
    assert.equal(bookRes.status, 201);
    const booking = await bookRes.json();
    assert.equal(booking.scheduleId, scheduleId);
    assert.equal(booking.memberId, memberAProfile.id);
    assert.equal(booking.status, 'BOOKED');
    assert.equal(booking.attendance, 'PENDING');
    memberABookingId = booking.id;

    // Verify Quota: reserved incremented from 0 to 1, used is 0
    const quota = await db.client.subscriptionQuota.findUnique({
      where: { id: booking.quotaId },
    });
    assert.equal(quota.reserved, 1);
    assert.equal(quota.used, 0);

    // Verify QuotaTransaction (type: RESERVE, reservedDelta: 1)
    const txLog = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: booking.quotaId,
        type: 'RESERVE',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(txLog);
    assert.equal(txLog.reservedDelta, 1);
  });

  // ========================================================
  // Test 2: Duplicate Booking Prevention
  // ========================================================
  await t.test('POST /api/class-bookings - Reject duplicate booking', async () => {
    const dupRes = await request('class-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ scheduleId }),
    });
    assert.equal(dupRes.status, 409);
  });

  // ========================================================
  // Test 3: No Active Subscription Rejection
  // ========================================================
  await t.test('POST /api/class-bookings - Reject member without class quota', async () => {
    // Member C without subscription
    const memberCEmail = `member.c.${Date.now()}@gym.local`;
    const memberCRes = await request('members', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        email: memberCEmail,
        password: 'Password@123456',
        fullName: 'Charlie No Sub',
        phone: `093${Math.floor(1000000 + Math.random() * 9000000)}`,
      }),
    });
    assert.equal(memberCRes.status, 201);

    const memberCLogin = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: memberCEmail,
        password: 'Password@123456',
      }),
    });
    assert.equal(memberCLogin.status, 200);
    const memberCToken = (await memberCLogin.json()).tokens.accessToken;

    const noSubRes = await request('class-bookings', {
      method: 'POST',
      token: memberCToken,
      body: JSON.stringify({ scheduleId }),
    });
    assert.equal(noSubRes.status, 400);
  });

  // ========================================================
  // Test 4: Concurrency & Capacity Constraint
  // ========================================================
  await t.test('POST /api/class-bookings - Fully booked schedule rejects over-booking', async () => {
    // Create schedule with capacity = 1
    const singleSlotStart = new Date(tomorrow.getTime() + 2 * 3600 * 1000);
    const singleSlotEnd = new Date(singleSlotStart.getTime() + 3600 * 1000);

    const singleSlotSchedRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: gymClassId,
        trainerId: coach.id,
        startsAt: singleSlotStart.toISOString(),
        endsAt: singleSlotEnd.toISOString(),
        capacity: 5, // minimum is 5, but we can test reaching capacity by reducing or booking
      }),
    });
    assert.equal(singleSlotSchedRes.status, 201);
    const singleSched = await singleSlotSchedRes.json();

    // Set schedule capacity to 1 to test full capacity enforcement
    await db.client.classSchedule.update({
      where: { id: singleSched.id },
      data: { capacity: 1 },
    });

    // Member B books the 1st and only slot -> 201 Created
    const book1 = await request('class-bookings', {
      method: 'POST',
      token: memberBToken,
      body: JSON.stringify({ scheduleId: singleSched.id }),
    });
    assert.equal(book1.status, 201);
    const book1Data = await book1.json();

    // Member A attempts to book 2nd slot on full schedule -> 409 Conflict
    const book2 = await request('class-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ scheduleId: singleSched.id }),
    });
    assert.equal(book2.status, 409);

    // Clean up Member B's booking to refund quota
    await request(`class-bookings/${book1Data.id}/cancel`, {
      method: 'POST',
      token: memberBToken,
    });
  });

  // ========================================================
  // Test 5: Cancellation Policy & Quota Refund
  // ========================================================
  await t.test('POST /api/class-bookings/:id/cancel - Valid cancellation (> 2 hours) refunds quota', async () => {
    const cancelRes = await request(`class-bookings/${memberABookingId}/cancel`, {
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

  await t.test('POST /api/class-bookings/:id/cancel - Cutoff < 2 hours rejects Member self-cancellation', async () => {
    // Create schedule starting in 1 hour
    const nearStart = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
    const nearEnd = new Date(nearStart.getTime() + 60 * 60 * 1000);

    const nearSchedRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: gymClassId,
        trainerId: coach.id,
        startsAt: nearStart.toISOString(),
        endsAt: nearEnd.toISOString(),
        capacity: 10,
      }),
    });
    assert.equal(nearSchedRes.status, 201);
    const nearSched = await nearSchedRes.json();

    // Member A books slot
    const bookNearRes = await request('class-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ scheduleId: nearSched.id }),
    });
    assert.equal(bookNearRes.status, 201);
    const nearBooking = await bookNearRes.json();

    // Member tries to cancel within 2 hours -> 400 Bad Request
    const memberCutoffRes = await request(`class-bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      token: memberAToken,
    });
    assert.equal(memberCutoffRes.status, 400);

    // Staff cancels as management override -> 200 OK
    const staffOverrideRes = await request(`class-bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(staffOverrideRes.status, 200);
  });

  // ========================================================
  // Test 6: Attendance Tracking (PRESENT & ABSENT)
  // ========================================================
  let bookingForAttendanceId = '';

  await t.test('POST /api/class-bookings/:id/attendance - Mark PRESENT consumes quota', async () => {
    // Rebook Member A for the original schedule
    const rebookRes = await request('class-bookings', {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ scheduleId }),
    });
    assert.equal(rebookRes.status, 201);
    const rebooked = await rebookRes.json();
    bookingForAttendanceId = rebooked.id;

    // Member cannot take attendance -> 403 Forbidden
    const memberAttAttempt = await request(`class-bookings/${bookingForAttendanceId}/attendance`, {
      method: 'POST',
      token: memberAToken,
      body: JSON.stringify({ attendance: 'PRESENT' }),
    });
    assert.equal(memberAttAttempt.status, 403);

    // Coach marks attendance PRESENT -> 200 OK
    const coachAttRes = await request(`class-bookings/${bookingForAttendanceId}/attendance`, {
      method: 'POST',
      token: coachToken,
      body: JSON.stringify({ attendance: 'PRESENT' }),
    });
    assert.equal(coachAttRes.status, 200);
    const attended = await coachAttRes.json();
    assert.equal(attended.attendance, 'PRESENT');
    assert.equal(attended.status, 'COMPLETED');
    assert.ok(attended.attendedAt);

    // Verify Quota: reserved decremented by 1, used incremented to 1
    const quota = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: subA.id },
    });
    assert.equal(quota.reserved, 0);
    assert.equal(quota.used, 1);

    // Verify QuotaTransaction (type: USE, reservedDelta: -1, usedDelta: 1)
    const useTx = await db.client.quotaTransaction.findFirst({
      where: {
        quotaId: quota.id,
        type: 'USE',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(useTx);
    assert.equal(useTx.reservedDelta, -1);
    assert.equal(useTx.usedDelta, 1);
  });

  await t.test('POST /api/class-bookings/:id/attendance - Mark ABSENT forfeits quota as NO_SHOW', async () => {
    // Member B books slot
    const bookBRes = await request('class-bookings', {
      method: 'POST',
      token: memberBToken,
      body: JSON.stringify({ scheduleId }),
    });
    assert.equal(bookBRes.status, 201);
    const bookingB = await bookBRes.json();

    // Staff marks attendance ABSENT -> 200 OK
    const absentRes = await request(`class-bookings/${bookingB.id}/attendance`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({ attendance: 'ABSENT' }),
    });
    assert.equal(absentRes.status, 200);
    const absentData = await absentRes.json();
    assert.equal(absentData.attendance, 'ABSENT');
    assert.equal(absentData.status, 'NO_SHOW');

    // Verify Quota: reserved decreases by 1, used increases by 1 (penalty)
    const quotaB = await db.client.subscriptionQuota.findFirst({
      where: { subscriptionId: bookingB.subscriptionId },
    });
    assert.equal(quotaB.reserved, 0);
    assert.equal(quotaB.used, 1);
  });

  // ========================================================
  // Test 7: Queries (findMyBookings & findBySchedule)
  // ========================================================
  await t.test('GET /api/class-bookings/my & GET /api/class-schedules/:id/bookings', async () => {
    // Member A views own bookings
    const myRes = await request('class-bookings/my', {
      method: 'GET',
      token: memberAToken,
    });
    assert.equal(myRes.status, 200);
    const myBookings = await myRes.json();
    assert.ok(myBookings.data.length >= 1);
    assert.ok(myBookings.meta.total >= 1);

    // Coach views roster for schedule
    const rosterRes = await request(`class-schedules/${scheduleId}/bookings`, {
      method: 'GET',
      token: coachToken,
    });
    assert.equal(rosterRes.status, 200);
    const roster = await rosterRes.json();
    assert.ok(Array.isArray(roster));
    assert.ok(roster.length >= 1);
  });
});
