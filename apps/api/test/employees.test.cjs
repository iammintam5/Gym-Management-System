const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');

test('Phase 5 - Employee Management Integration Tests', async (t) => {
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

  let createdStaffId = '';
  let createdStaffCode = '';
  let createdPtId = '';
  let createdPtCode = '';

  const testStaffEmail = `test.staff.${Date.now()}@gym.local`;
  const testPtEmail = `test.pt.${Date.now()}@gym.local`;

  await t.test('1. POST /api/employees (Creation, RBAC, Validation & Password)', async (createTest) => {
    await createTest.test('STAFF, PT, and MEMBER cannot create employees -> 403 Forbidden', async () => {
      const staffAttempt = await request('employees', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          email: 'unauth.emp1@gym.local',
          fullName: 'Unauth Staff',
          role: 'STAFF',
        }),
      });
      assert.equal(staffAttempt.status, 403);

      const ptAttempt = await request('employees', {
        method: 'POST',
        token: ptToken,
        body: JSON.stringify({
          email: 'unauth.emp2@gym.local',
          fullName: 'Unauth PT',
          role: 'PT',
        }),
      });
      assert.equal(ptAttempt.status, 403);

      const memberAttempt = await request('employees', {
        method: 'POST',
        token: memberToken,
        body: JSON.stringify({
          email: 'unauth.emp3@gym.local',
          fullName: 'Unauth Member',
          role: 'STAFF',
        }),
      });
      assert.equal(memberAttempt.status, 403);
    });

    await createTest.test('Invalid roles (ADMIN, MEMBER) rejected -> 400 Bad Request', async () => {
      const adminRoleRes = await request('employees', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: 'invalid.role1@gym.local',
          fullName: 'Invalid Admin Role',
          role: 'ADMIN',
        }),
      });
      assert.equal(adminRoleRes.status, 400);

      const memberRoleRes = await request('employees', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: 'invalid.role2@gym.local',
          fullName: 'Invalid Member Role',
          role: 'MEMBER',
        }),
      });
      assert.equal(memberRoleRes.status, 400);
    });

    await createTest.test('ADMIN creates STAFF -> 201/200 success with sanitized profile & employeeCode', async () => {
      const res = await request('employees', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: testStaffEmail,
          fullName: 'Tran Van Staff Test',
          role: 'STAFF',
          phone: '0911223344',
          specialization: 'Customer Reception',
          hiredAt: '2024-05-01',
          password: 'StaffSecret@123',
        }),
      });
      assert.ok(res.status === 201 || res.status === 200);
      const data = await res.json();

      assert.ok(data.id);
      assert.ok(data.userId);
      assert.ok(data.employeeCode);
      assert.ok(data.employeeCode.startsWith('EMP-'));
      assert.equal(data.email, testStaffEmail);
      assert.equal(data.fullName, 'Tran Van Staff Test');
      assert.equal(data.phone, '0911223344');
      assert.equal(data.specialization, 'Customer Reception');
      assert.equal(data.hiredAt, '2024-05-01');
      assert.equal(data.isActive, true);
      assert.deepEqual(data.roles, ['STAFF']);

      // Sensitive fields must never be exposed
      assert.equal(data.passwordHash, undefined);
      assert.equal(data.refreshTokenHash, undefined);

      createdStaffId = data.id;
      createdStaffCode = data.employeeCode;

      // Verify created staff can login
      const loginRes = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: testStaffEmail,
          password: 'StaffSecret@123',
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.ok(loginData.tokens.accessToken);
    });

    await createTest.test('ADMIN creates PT -> 201/200 success', async () => {
      const res = await request('employees', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: testPtEmail,
          fullName: 'Coach Nguyen PT',
          role: 'PT',
          phone: '0933445566',
          specialization: 'Bodybuilding & Fitness',
          hiredAt: '2024-04-15',
          password: 'PtSecret@123456',
        }),
      });
      assert.ok(res.status === 201 || res.status === 200);
      const data = await res.json();

      assert.equal(data.email, testPtEmail);
      assert.equal(data.fullName, 'Coach Nguyen PT');
      assert.equal(data.specialization, 'Bodybuilding & Fitness');
      assert.deepEqual(data.roles, ['PT']);

      createdPtId = data.id;
      createdPtCode = data.employeeCode;
    });

    await createTest.test('Duplicate email returns 409 Conflict', async () => {
      const res = await request('employees', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: testStaffEmail,
          fullName: 'Duplicate Staff',
          role: 'STAFF',
        }),
      });
      assert.equal(res.status, 409);
    });
  });

  await t.test('2. GET /api/employees (Listing, RBAC, Search, Filter, Sort)', async (listTest) => {
    await listTest.test('STAFF, PT, and MEMBER cannot list employees -> 403 Forbidden', async () => {
      const staffAttempt = await request('employees', { token: staffToken });
      assert.equal(staffAttempt.status, 403);

      const ptAttempt = await request('employees', { token: ptToken });
      assert.equal(ptAttempt.status, 403);

      const memberAttempt = await request('employees', { token: memberToken });
      assert.equal(memberAttempt.status, 403);
    });

    await listTest.test('ADMIN lists employees -> 200 with pagination meta', async () => {
      const res = await request('employees?page=1&limit=10', {
        token: adminToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.data));
      assert.ok(data.meta);
      assert.equal(data.meta.page, 1);
      assert.equal(data.meta.limit, 10);
      assert.ok(data.meta.total >= 2);
    });

    await listTest.test('Search by full name, email, specialization works', async () => {
      const searchNameRes = await request('employees?search=Coach+Nguyen+PT', {
        token: adminToken,
      });
      assert.equal(searchNameRes.status, 200);
      const searchNameData = await searchNameRes.json();
      assert.ok(searchNameData.data.some((e) => e.email === testPtEmail));

      const searchSpecRes = await request('employees?search=Bodybuilding', {
        token: adminToken,
      });
      assert.equal(searchSpecRes.status, 200);
      const searchSpecData = await searchSpecRes.json();
      assert.ok(searchSpecData.data.some((e) => e.email === testPtEmail));
    });

    await listTest.test('Filter by role (STAFF / PT) works', async () => {
      const ptFilterRes = await request('employees?role=PT', {
        token: adminToken,
      });
      assert.equal(ptFilterRes.status, 200);
      const ptFilterData = await ptFilterRes.json();
      assert.ok(ptFilterData.data.every((e) => e.roles.includes('PT')));

      const staffFilterRes = await request('employees?role=STAFF', {
        token: adminToken,
      });
      assert.equal(staffFilterRes.status, 200);
      const staffFilterData = await staffFilterRes.json();
      assert.ok(staffFilterData.data.every((e) => e.roles.includes('STAFF')));
    });

    await listTest.test('Filter by isActive works', async () => {
      const activeRes = await request('employees?isActive=true', {
        token: adminToken,
      });
      assert.equal(activeRes.status, 200);
      const activeData = await activeRes.json();
      assert.ok(activeData.data.every((e) => e.isActive === true));
    });

    await listTest.test('Sorting by fullName works', async () => {
      const sortRes = await request('employees?sortBy=fullName&sortOrder=asc', {
        token: adminToken,
      });
      assert.equal(sortRes.status, 200);
      const sortData = await sortRes.json();
      assert.ok(sortData.data.length > 0);
    });
  });

  await t.test('3. GET /api/employees/:id & /api/employees/code/:employeeCode', async (detailTest) => {
    await detailTest.test('ADMIN gets employee by ID -> 200', async () => {
      const res = await request(`employees/${createdStaffId}`, {
        token: adminToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdStaffId);
      assert.equal(data.email, testStaffEmail);
      assert.equal(data.passwordHash, undefined);
    });

    await detailTest.test('ADMIN gets employee by employeeCode -> 200', async () => {
      const staffCodeRes = await request(`employees/code/${createdStaffCode}`, {
        token: adminToken,
      });
      assert.equal(staffCodeRes.status, 200);
      const staffCodeData = await staffCodeRes.json();
      assert.equal(staffCodeData.id, createdStaffId);
      assert.equal(staffCodeData.employeeCode, createdStaffCode);

      const ptCodeRes = await request(`employees/code/${createdPtCode}`, {
        token: adminToken,
      });
      assert.equal(ptCodeRes.status, 200);
      const ptCodeData = await ptCodeRes.json();
      assert.equal(ptCodeData.id, createdPtId);
      assert.equal(ptCodeData.employeeCode, createdPtCode);
    });

    await detailTest.test('Non-existent employee ID returns 404', async () => {
      const res = await request('employees/00000000-0000-0000-0000-000000000000', {
        token: adminToken,
      });
      assert.equal(res.status, 404);
    });
  });

  await t.test('4. PATCH /api/employees/:id (Admin Update)', async (updateTest) => {
    await updateTest.test('ADMIN updates employee fullName, phone, specialization -> 200', async () => {
      const res = await request(`employees/${createdStaffId}`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({
          fullName: 'Tran Van Staff Updated',
          phone: '0999998888',
          specialization: 'Senior Reception Specialist',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.fullName, 'Tran Van Staff Updated');
      assert.equal(data.phone, '0999998888');
      assert.equal(data.specialization, 'Senior Reception Specialist');
    });

    await updateTest.test('STAFF / PT cannot call PATCH /api/employees/:id -> 403 Forbidden', async () => {
      const staffAttempt = await request(`employees/${createdStaffId}`, {
        method: 'PATCH',
        token: staffToken,
        body: JSON.stringify({
          fullName: 'Hacked Staff',
        }),
      });
      assert.equal(staffAttempt.status, 403);

      const ptAttempt = await request(`employees/${createdStaffId}`, {
        method: 'PATCH',
        token: ptToken,
        body: JSON.stringify({
          fullName: 'Hacked Staff by PT',
        }),
      });
      assert.equal(ptAttempt.status, 403);
    });
  });

  await t.test('5. GET /api/employees/me & PATCH /api/employees/me (Self-service & Security)', async (selfTest) => {
    // Login as the created staff
    const loginStaffRes = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testStaffEmail,
        password: 'StaffSecret@123',
      }),
    });
    assert.equal(loginStaffRes.status, 200);
    const newStaffToken = (await loginStaffRes.json()).tokens.accessToken;

    // Login as the created PT
    const loginPtRes = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testPtEmail,
        password: 'PtSecret@123456',
      }),
    });
    assert.equal(loginPtRes.status, 200);
    const newPtToken = (await loginPtRes.json()).tokens.accessToken;

    await selfTest.test('STAFF calls GET /employees/me -> 200 returns own profile', async () => {
      const res = await request('employees/me', {
        token: newStaffToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdStaffId);
      assert.equal(data.email, testStaffEmail);
    });

    await selfTest.test('PT calls GET /employees/me -> 200 returns own profile', async () => {
      const res = await request('employees/me', {
        token: newPtToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdPtId);
      assert.equal(data.email, testPtEmail);
    });

    await selfTest.test('MEMBER calling GET /employees/me -> 403 Forbidden', async () => {
      const res = await request('employees/me', {
        token: memberToken,
      });
      assert.equal(res.status, 403);
    });

    await selfTest.test('STAFF cannot pass disallowed fields -> 400 Bad Request (Mass Assignment Protection)', async () => {
      const res = await request('employees/me', {
        method: 'PATCH',
        token: newStaffToken,
        body: JSON.stringify({
          fullName: 'Staff Hack',
          isActive: false,
          roles: ['ADMIN'],
          employeeCode: 'EMP-HACKED',
        }),
      });
      assert.equal(res.status, 400);
    });

    await selfTest.test('PT calls PATCH /employees/me with valid fields -> 200 updates profile', async () => {
      const res = await request('employees/me', {
        method: 'PATCH',
        token: newPtToken,
        body: JSON.stringify({
          fullName: 'Coach Nguyen PT Self Updated',
          phone: '0977889900',
          specialization: 'Advanced Powerlifting & Conditioning',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.fullName, 'Coach Nguyen PT Self Updated');
      assert.equal(data.phone, '0977889900');
      assert.equal(data.specialization, 'Advanced Powerlifting & Conditioning');
      assert.equal(data.isActive, true);
      assert.deepEqual(data.roles, ['PT']);
      assert.equal(data.employeeCode, createdPtCode);
    });
  });
});
