const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Classes & Class Schedules Management Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const _db = app.get(DatabaseService);
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

  const ptRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'pt@gym.com',
      password: 'Pt@123456',
    }),
  });
  assert.equal(ptRes.status, 200);
  const _ptToken = (await ptRes.json()).tokens.accessToken;

  const memberRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'member@gym.com',
      password: 'Member@123456',
    }),
  });
  assert.equal(memberRes.status, 200);
  const memberToken = (await memberRes.json()).tokens.accessToken;

  // Create fresh PT Employee Profile to ensure isolated schedule calendar
  const testPtRes = await request('employees', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: `test.pt.${Date.now()}@gym.local`,
      fullName: 'Coach Test Runner',
      role: 'PT',
      phone: `098${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'PtPassword@123',
    }),
  });
  assert.equal(testPtRes.status, 201);
  const ptEmployee = await testPtRes.json();

  let testClassId = '';
  const testClassName = `Zumba Fitness ${Date.now()}`;

  // ==========================================
  // Part 1: GymClass CRUD & RBAC
  // ==========================================
  await t.test('POST /api/classes - RBAC & Creation', async () => {
    // Unauthenticated
    const anonRes = await request('classes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Pilates Core' }),
    });
    assert.equal(anonRes.status, 401);

    // Forbidden for Member
    const memberCreateRes = await request('classes', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({ name: 'Pilates Core' }),
    });
    assert.equal(memberCreateRes.status, 403);

    // Admin creates class
    const createRes = await request('classes', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: testClassName,
        description: 'High energy dance fitness class',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdClass = await createRes.json();
    assert.equal(createdClass.name, testClassName);
    assert.equal(createdClass.isActive, true);
    testClassId = createdClass.id;

    // Duplicate name conflict
    const dupRes = await request('classes', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ name: testClassName.toLowerCase() }),
    });
    assert.equal(dupRes.status, 409);
  });

  await t.test('GET /api/classes - Public Listing & Detail', async () => {
    // Unauthenticated listing
    const listRes = await request(`classes?search=${encodeURIComponent(testClassName)}`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.ok(list.data.length >= 1);
    assert.equal(list.data[0].id, testClassId);

    // Unauthenticated detail
    const detailRes = await request(`classes/${testClassId}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.name, testClassName);
  });

  await t.test('PATCH /api/classes/:id - Update & Status Toggle', async () => {
    // Member cannot update
    const memberUpdateRes = await request(`classes/${testClassId}`, {
      method: 'PATCH',
      token: memberToken,
      body: JSON.stringify({ description: 'Updated' }),
    });
    assert.equal(memberUpdateRes.status, 403);

    // Admin updates metadata
    const updateRes = await request(`classes/${testClassId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ description: 'Updated description' }),
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.description, 'Updated description');

    // Admin deactivates class
    const deactivateRes = await request(`classes/${testClassId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactivateRes.status, 200);
    assert.equal((await deactivateRes.json()).isActive, false);
  });

  // ==========================================
  // Part 2: Class Schedules Validation
  // ==========================================
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(10, 0, 0, 0); // 60 minutes duration

  await t.test('POST /api/class-schedules - Inactive class rejection', async () => {
    // Class is inactive -> 409 Conflict
    const res = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(res.status, 409);

    // Reactivate class
    await request(`classes/${testClassId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ isActive: true }),
    });
  });

  await t.test('POST /api/class-schedules - Timing & Capacity Validation', async () => {
    // 1. startsAt >= endsAt
    const invalidTimingRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrowEnd.toISOString(),
        endsAt: tomorrow.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(invalidTimingRes.status, 400);

    // 2. Duration < 30 minutes
    const tooShortEnd = new Date(tomorrow.getTime() + 15 * 60 * 1000);
    const tooShortRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tooShortEnd.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(tooShortRes.status, 400);

    // 3. Duration > 180 minutes
    const tooLongEnd = new Date(tomorrow.getTime() + 240 * 60 * 1000);
    const tooLongRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tooLongEnd.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(tooLongRes.status, 400);

    // 4. Capacity bounds (< 5 or > 100)
    const badCapacityRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
        capacity: 3,
      }),
    });
    assert.equal(badCapacityRes.status, 400);
  });

  // ==========================================
  // Part 3: Trainer Role & Conflict Prevention
  // ==========================================
  let firstScheduleId = '';

  await t.test('POST /api/class-schedules - Trainer Role Validation', async () => {
    // Create dedicated staff-only employee (without PT role)
    const staffOnlyRes = await request('employees', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        email: `staff.only.${Date.now()}@gym.local`,
        password: 'Password@123',
        fullName: 'Receptionist Only',
        phone: `090${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: 'STAFF',
      }),
    });
    assert.equal(staffOnlyRes.status, 201);
    const staffOnly = await staffOnlyRes.json();

    // Assign employee without PT role -> 400 Bad Request
    const nonPtRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: staffOnly.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(nonPtRes.status, 400);

    // Assign valid PT trainer -> 201 Created
    const validRes = await request('class-schedules', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: tomorrow.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
        capacity: 20,
      }),
    });
    assert.equal(validRes.status, 201);
    const schedule = await validRes.json();
    assert.equal(schedule.classId, testClassId);
    assert.equal(schedule.trainerId, ptEmployee.id);
    assert.equal(schedule.capacity, 20);
    assert.equal(schedule.remainingSlots, 20);
    assert.equal(schedule.bookedCount, 0);
    assert.equal(schedule.status, 'SCHEDULED');
    firstScheduleId = schedule.id;
  });

  await t.test('POST /api/class-schedules - Trainer Schedule Conflict', async () => {
    // 1. Overlapping window: 9:30 - 10:30 (overlaps with 9:00 - 10:00)
    const overlapStart = new Date(tomorrow.getTime() + 30 * 60 * 1000);
    const overlapEnd = new Date(tomorrowEnd.getTime() + 30 * 60 * 1000);

    const overlapRes = await request('class-schedules', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: overlapStart.toISOString(),
        endsAt: overlapEnd.toISOString(),
        capacity: 15,
      }),
    });
    assert.equal(overlapRes.status, 409);

    // 2. Non-overlapping window: 10:30 - 11:30 (starts after first ends) -> 201 Created
    const distinctStart = new Date(tomorrowEnd.getTime() + 30 * 60 * 1000);
    const distinctEnd = new Date(distinctStart.getTime() + 60 * 60 * 1000);

    const distinctRes = await request('class-schedules', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        classId: testClassId,
        trainerId: ptEmployee.id,
        startsAt: distinctStart.toISOString(),
        endsAt: distinctEnd.toISOString(),
        capacity: 15,
      }),
    });
    assert.equal(distinctRes.status, 201);
  });

  // ==========================================
  // Part 4: Query Timetable & remainingSlots
  // ==========================================
  await t.test('GET /api/class-schedules - Timetable Listing & Details', async () => {
    // Public timetable query by classId
    const queryRes = await request(`class-schedules?classId=${testClassId}`);
    assert.equal(queryRes.status, 200);
    const result = await queryRes.json();
    assert.ok(result.data.length >= 2);

    const first = result.data.find((s) => s.id === firstScheduleId);
    assert.ok(first);
    assert.equal(first.className, testClassName);
    assert.equal(first.capacity, 20);
    assert.equal(first.bookedCount, 0);
    assert.equal(first.remainingSlots, 20);

    // Public single detail lookup
    const detailRes = await request(`class-schedules/${firstScheduleId}`);
    assert.equal(detailRes.status, 200);
    const detail = await detailRes.json();
    assert.equal(detail.id, firstScheduleId);
  });

  // ==========================================
  // Part 5: Update Schedule & Capacity Guard
  // ==========================================
  await t.test('PATCH /api/class-schedules/:id - Update and Capacity Guard', async () => {
    // Member forbidden
    const memberPatchRes = await request(`class-schedules/${firstScheduleId}`, {
      method: 'PATCH',
      token: memberToken,
      body: JSON.stringify({ capacity: 25 }),
    });
    assert.equal(memberPatchRes.status, 403);

    // Staff updates capacity to 25
    const patchRes = await request(`class-schedules/${firstScheduleId}`, {
      method: 'PATCH',
      token: staffToken,
      body: JSON.stringify({ capacity: 25 }),
    });
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.capacity, 25);
    assert.equal(updated.remainingSlots, 25);
  });

  // ==========================================
  // Part 6: Cancellation Cascade
  // ==========================================
  await t.test('POST /api/class-schedules/:id/cancel - Cancellation Lifecycle', async () => {
    // Member cannot cancel
    const memberCancelRes = await request(`class-schedules/${firstScheduleId}/cancel`, {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({ reason: 'Member attempt' }),
    });
    assert.equal(memberCancelRes.status, 403);

    // Staff cancels schedule
    const cancelRes = await request(`class-schedules/${firstScheduleId}/cancel`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        reason: 'HLV bận việc đột xuất, trung tâm huỷ ca học',
      }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelled = await cancelRes.json();
    assert.equal(cancelled.status, 'CANCELLED');

    // Cancelling again -> 409 Conflict
    const cancelAgainRes = await request(`class-schedules/${firstScheduleId}/cancel`, {
      method: 'POST',
      token: staffToken,
    });
    assert.equal(cancelAgainRes.status, 409);

    // Updating cancelled schedule -> 409 Conflict
    const updateCancelledRes = await request(`class-schedules/${firstScheduleId}`, {
      method: 'PATCH',
      token: staffToken,
      body: JSON.stringify({ capacity: 30 }),
    });
    assert.equal(updateCancelledRes.status, 409);
  });
});
