const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');

test('Phase 6 - Membership Plan & Entitlements Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

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

  // Login tokens
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

  let createdPlanId = '';
  const testPlanName = `Test Plan VIP ${Date.now()}`;

  // 1. Service Types listing
  await t.test('GET /api/membership-plans/service-types - Admin & Staff access', async () => {
    const res = await request('membership-plans/service-types', {
      token: adminToken,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    const codes = data.map((s) => s.code);
    assert.ok(codes.includes('GYM_ACCESS'));
    assert.ok(codes.includes('CLASS'));
    assert.ok(codes.includes('PT'));

    // Staff can also view service types
    const staffCheck = await request('membership-plans/service-types', {
      token: staffToken,
    });
    assert.equal(staffCheck.status, 200);
  });

  // 2. Create Membership Plan RBAC
  await t.test('POST /api/membership-plans - RBAC enforcement', async () => {
    const payload = {
      name: 'Unauthorized Plan',
      durationDays: 30,
      price: 500000,
    };

    // Staff forbidden
    const staffRes = await request('membership-plans', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify(payload),
    });
    assert.equal(staffRes.status, 403);

    // PT forbidden
    const ptRes = await request('membership-plans', {
      method: 'POST',
      token: ptToken,
      body: JSON.stringify(payload),
    });
    assert.equal(ptRes.status, 403);

    // Member forbidden
    const memberRes = await request('membership-plans', {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify(payload),
    });
    assert.equal(memberRes.status, 403);

    // Unauthenticated unauthorized
    const unauthRes = await request('membership-plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(unauthRes.status, 401);
  });

  // 3. Create Membership Plan Validations
  await t.test('POST /api/membership-plans - Validation rules', async () => {
    // Empty name
    const res1 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: '   ',
        durationDays: 30,
        price: 500000,
      }),
    });
    assert.equal(res1.status, 400);

    // Duration <= 0
    const res2 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Zero Duration',
        durationDays: 0,
        price: 500000,
      }),
    });
    assert.equal(res2.status, 400);

    const res3 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Negative Duration',
        durationDays: -10,
        price: 500000,
      }),
    });
    assert.equal(res3.status, 400);

    // Price < 0
    const res4 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Negative Price',
        durationDays: 30,
        price: -100,
      }),
    });
    assert.equal(res4.status, 400);

    // Unknown service type
    const res5 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Unknown Service',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'INVALID_SERVICE', limitType: 'UNLIMITED' },
        ],
      }),
    });
    assert.equal(res5.status, 400);

    // Duplicate service entitlement
    const res6 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Duplicate Service',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'CLASS', limitType: 'COUNT', limitValue: 10 },
          { service: 'CLASS', limitType: 'COUNT', limitValue: 20 },
        ],
      }),
    });
    assert.equal(res6.status, 400);

    // COUNT without limitValue
    const res7 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Count No Limit',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'CLASS', limitType: 'COUNT' },
        ],
      }),
    });
    assert.equal(res7.status, 400);

    // COUNT with limitValue = 0
    const res8 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Count Zero Limit',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'CLASS', limitType: 'COUNT', limitValue: 0 },
        ],
      }),
    });
    assert.equal(res8.status, 400);

    // UNLIMITED with limitValue
    const res9 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test Unlimited With Value',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'GYM_ACCESS', limitType: 'UNLIMITED', limitValue: 10 },
        ],
      }),
    });
    assert.equal(res9.status, 400);

    // NONE with limitValue
    const res10 = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Test None With Value',
        durationDays: 30,
        price: 500000,
        entitlements: [
          { service: 'PT', limitType: 'NONE', limitValue: 5 },
        ],
      }),
    });
    assert.equal(res10.status, 400);
  });

  // 4. Admin Create Plan with Entitlements Successfully
  await t.test('POST /api/membership-plans - Admin creates plan + entitlements atomically', async () => {
    const payload = {
      name: testPlanName,
      description: 'Comprehensive VIP fitness package with full access and coaching',
      durationDays: 90,
      price: 1800000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 12 },
        { service: 'PT', limitType: 'COUNT', limitValue: 4 },
      ],
    };

    const res = await request('membership-plans', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.name, testPlanName);
    assert.equal(data.durationDays, 90);
    assert.equal(data.price, 1800000);
    assert.equal(data.isActive, true);
    assert.equal(typeof data.createdAt, 'string');
    assert.equal(typeof data.updatedAt, 'string');
    assert.equal(data.entitlements.length, 3);

    const gymEnt = data.entitlements.find((e) => e.service === 'GYM_ACCESS');
    assert.ok(gymEnt);
    assert.equal(gymEnt.limitType, 'UNLIMITED');
    assert.equal(gymEnt.limitValue, null);

    const classEnt = data.entitlements.find((e) => e.service === 'CLASS');
    assert.ok(classEnt);
    assert.equal(classEnt.limitType, 'COUNT');
    assert.equal(classEnt.limitValue, 12);

    const ptEnt = data.entitlements.find((e) => e.service === 'PT');
    assert.ok(ptEnt);
    assert.equal(ptEnt.limitType, 'COUNT');
    assert.equal(ptEnt.limitValue, 4);

    createdPlanId = data.id;
  });

  // 5. Admin & Staff List Plans with Search, Filter, Pagination
  await t.test('GET /api/membership-plans - List, search, filter, sorting', async () => {
    // Admin list
    const adminRes = await request('membership-plans?page=1&limit=10', {
      token: adminToken,
    });
    assert.equal(adminRes.status, 200);
    const adminList = await adminRes.json();
    assert.ok(Array.isArray(adminList.data));
    assert.ok(adminList.meta);
    assert.equal(adminList.meta.page, 1);
    assert.equal(adminList.meta.limit, 10);
    assert.ok(adminList.meta.total >= 1);

    // Staff list
    const staffRes = await request('membership-plans', {
      token: staffToken,
    });
    assert.equal(staffRes.status, 200);

    // Member & PT forbidden
    const memberRes = await request('membership-plans', {
      token: memberToken,
    });
    assert.equal(memberRes.status, 403);

    const ptRes = await request('membership-plans', {
      token: ptToken,
    });
    assert.equal(ptRes.status, 403);

    // Search by name
    const searchRes = await request(`membership-plans?search=${encodeURIComponent(testPlanName)}`, {
      token: adminToken,
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(searchData.data.some((p) => p.id === createdPlanId));

    // Filter by service
    const serviceFilterRes = await request('membership-plans?service=PT', {
      token: adminToken,
    });
    assert.equal(serviceFilterRes.status, 200);
    const serviceFilterData = await serviceFilterRes.json();
    assert.ok(serviceFilterData.data.some((p) => p.id === createdPlanId));
  });

  // 6. Public Active Plans List
  await t.test('GET /api/public/membership-plans - Unauthenticated access returns active plans only', async () => {
    const res1 = await request('public/membership-plans');
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.ok(Array.isArray(data1));
    assert.ok(data1.some((p) => p.id === createdPlanId));

    // Also check alias route /membership-plans/public
    const res2 = await request('membership-plans/public');
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.ok(Array.isArray(data2));
    assert.ok(data2.some((p) => p.id === createdPlanId));
  });

  // 7. Get Plan Detail by ID
  await t.test('GET /api/membership-plans/:id - Get detail by ID', async () => {
    // Admin access
    const res = await request(`membership-plans/${createdPlanId}`, {
      token: adminToken,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, createdPlanId);
    assert.equal(data.name, testPlanName);
    assert.equal(data.entitlements.length, 3);

    // Staff access
    const staffDetail = await request(`membership-plans/${createdPlanId}`, {
      token: staffToken,
    });
    assert.equal(staffDetail.status, 200);

    // Member access forbidden
    const memberDetail = await request(`membership-plans/${createdPlanId}`, {
      token: memberToken,
    });
    assert.equal(memberDetail.status, 403);

    // Non-existent ID -> 404
    const notFound = await request('membership-plans/00000000-0000-0000-0000-000000000000', {
      token: adminToken,
    });
    assert.equal(notFound.status, 404);
  });

  // 8. Update Plan Metadata
  await t.test('PATCH /api/membership-plans/:id - Update metadata', async () => {
    const updatedName = `${testPlanName} (Updated)`;
    const res = await request(`membership-plans/${createdPlanId}`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({
        name: updatedName,
        price: 2000000,
        durationDays: 120,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, updatedName);
    assert.equal(data.price, 2000000);
    assert.equal(data.durationDays, 120);

    // Staff forbidden to update
    const staffRes = await request(`membership-plans/${createdPlanId}`, {
      method: 'PATCH',
      token: staffToken,
      body: JSON.stringify({ name: 'Hacked Name' }),
    });
    assert.equal(staffRes.status, 403);
  });

  // 9. Update Plan Entitlements Atomically
  await t.test('PUT /api/membership-plans/:id/entitlements - Atomic replacement', async () => {
    const res = await request(`membership-plans/${createdPlanId}/entitlements`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({
        entitlements: [
          { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
          { service: 'CLASS', limitType: 'COUNT', limitValue: 20 },
          { service: 'PT', limitType: 'NONE' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // PT was set to NONE so only GYM_ACCESS and CLASS should remain in DB
    assert.equal(data.entitlements.length, 2);

    const classEnt = data.entitlements.find((e) => e.service === 'CLASS');
    assert.ok(classEnt);
    assert.equal(classEnt.limitValue, 20);

    const ptEnt = data.entitlements.find((e) => e.service === 'PT');
    assert.equal(ptEnt, undefined);

    // Staff forbidden to update entitlements
    const staffRes = await request(`membership-plans/${createdPlanId}/entitlements`, {
      method: 'PUT',
      token: staffToken,
      body: JSON.stringify({ entitlements: [] }),
    });
    assert.equal(staffRes.status, 403);
  });

  // 10. Status / Deactivate & Reactivate Plan
  await t.test('PATCH /api/membership-plans/:id/status - Deactivate & Reactivate', async () => {
    // Deactivate
    const deactRes = await request(`membership-plans/${createdPlanId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(deactRes.status, 200);
    const deactData = await deactRes.json();
    assert.equal(deactData.isActive, false);

    // Verify Admin can still view the inactive plan
    const adminView = await request(`membership-plans/${createdPlanId}`, {
      token: adminToken,
    });
    assert.equal(adminView.status, 200);
    assert.equal((await adminView.json()).isActive, false);

    // Verify Public list hides inactive plan
    const publicList = await request('public/membership-plans');
    assert.equal(publicList.status, 200);
    const publicData = await publicList.json();
    assert.ok(!publicData.some((p) => p.id === createdPlanId));

    // Reactivate
    const reactRes = await request(`membership-plans/${createdPlanId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(reactRes.status, 200);
    const reactData = await reactRes.json();
    assert.equal(reactData.isActive, true);

    // Verify Public list includes plan again
    const publicListAfter = await request('public/membership-plans');
    const publicDataAfter = await publicListAfter.json();
    assert.ok(publicDataAfter.some((p) => p.id === createdPlanId));
  });
});
