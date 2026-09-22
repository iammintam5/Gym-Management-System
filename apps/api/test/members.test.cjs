const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');

test('Phase 4 - Member Management Integration Tests', async (t) => {
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

  let createdMemberId = '';
  let createdMemberCode = '';
  const testMemberEmail = `test.member.${Date.now()}@gym.local`;
  const testStaffCreatedEmail = `staff.created.${Date.now()}@gym.local`;

  await t.test('1. POST /api/members (Creation, RBAC, Validation & Password)', async (createTest) => {
    await createTest.test('MEMBER and PT cannot create members -> 403 Forbidden', async () => {
      const memberAttempt = await request('members', {
        method: 'POST',
        token: memberToken,
        body: JSON.stringify({
          email: 'unauth1@gym.local',
          fullName: 'Unauth User',
        }),
      });
      assert.equal(memberAttempt.status, 403);

      const ptAttempt = await request('members', {
        method: 'POST',
        token: ptToken,
        body: JSON.stringify({
          email: 'unauth2@gym.local',
          fullName: 'Unauth User',
        }),
      });
      assert.equal(ptAttempt.status, 403);
    });

    await createTest.test('ADMIN creates member -> 201/200 success with sanitized profile & memberCode', async () => {
      const res = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: testMemberEmail,
          fullName: 'Nguyen Thi Member',
          phone: '0987654321',
          dateOfBirth: '1996-08-15',
          password: 'MemberSecret@123',
        }),
      });
      assert.ok(res.status === 201 || res.status === 200);
      const data = await res.json();

      assert.ok(data.id);
      assert.ok(data.userId);
      assert.ok(data.memberCode);
      assert.ok(data.memberCode.startsWith('MEM-'));
      assert.equal(data.email, testMemberEmail);
      assert.equal(data.fullName, 'Nguyen Thi Member');
      assert.equal(data.phone, '0987654321');
      assert.equal(data.dateOfBirth, '1996-08-15');
      assert.equal(data.isActive, true);
      assert.deepEqual(data.roles, ['MEMBER']);

      // Sensitive fields must never be exposed
      assert.equal(data.passwordHash, undefined);
      assert.equal(data.refreshTokenHash, undefined);

      createdMemberId = data.id;
      createdMemberCode = data.memberCode;

      // Verify created member can login with initial password
      const loginRes = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: testMemberEmail,
          password: 'MemberSecret@123',
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.ok(loginData.tokens.accessToken);
    });

    await createTest.test('STAFF creates member -> 201/200 success', async () => {
      const res = await request('members', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          email: testStaffCreatedEmail,
          fullName: 'Tran Van Staff Member',
          phone: '0912345678',
        }),
      });
      assert.ok(res.status === 201 || res.status === 200);
      const data = await res.json();
      assert.equal(data.email, testStaffCreatedEmail);
      assert.equal(data.fullName, 'Tran Van Staff Member');
    });

    await createTest.test('Duplicate email returns 409 Conflict', async () => {
      const res = await request('members', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          email: testMemberEmail,
          fullName: 'Duplicate Email Member',
        }),
      });
      assert.equal(res.status, 409);
    });
  });

  await t.test('2. GET /api/members (Listing, RBAC, Search, Filter, Sort)', async (listTest) => {
    await listTest.test('MEMBER & PT cannot list members -> 403 Forbidden', async () => {
      const memberAttempt = await request('members', { token: memberToken });
      assert.equal(memberAttempt.status, 403);

      const ptAttempt = await request('members', { token: ptToken });
      assert.equal(ptAttempt.status, 403);
    });

    await listTest.test('ADMIN and STAFF list members -> 200 with pagination meta', async () => {
      const adminRes = await request('members?page=1&limit=10', {
        token: adminToken,
      });
      assert.equal(adminRes.status, 200);
      const adminData = await adminRes.json();
      assert.ok(Array.isArray(adminData.data));
      assert.ok(adminData.meta);
      assert.equal(adminData.meta.page, 1);
      assert.equal(adminData.meta.limit, 10);
      assert.ok(adminData.meta.total >= 2);

      const staffRes = await request('members', { token: staffToken });
      assert.equal(staffRes.status, 200);
    });

    await listTest.test('Search by full name and email works', async () => {
      const searchNameRes = await request('members?search=Nguyen+Thi+Member', {
        token: adminToken,
      });
      assert.equal(searchNameRes.status, 200);
      const searchNameData = await searchNameRes.json();
      assert.ok(searchNameData.data.some((m) => m.email === testMemberEmail));

      const searchEmailRes = await request(`members?search=${encodeURIComponent(testMemberEmail)}`, {
        token: adminToken,
      });
      assert.equal(searchEmailRes.status, 200);
      const searchEmailData = await searchEmailRes.json();
      assert.ok(searchEmailData.data.some((m) => m.email === testMemberEmail));
    });

    await listTest.test('Filter by isActive works', async () => {
      const activeRes = await request('members?isActive=true', {
        token: adminToken,
      });
      assert.equal(activeRes.status, 200);
      const activeData = await activeRes.json();
      assert.ok(activeData.data.every((m) => m.isActive === true));
    });

    await listTest.test('Sorting by fullName works', async () => {
      const sortRes = await request('members?sortBy=fullName&sortOrder=asc', {
        token: adminToken,
      });
      assert.equal(sortRes.status, 200);
      const sortData = await sortRes.json();
      assert.ok(sortData.data.length > 0);
    });
  });

  await t.test('3. GET /api/members/:id & /api/members/code/:memberCode', async (getDetailTest) => {
    await getDetailTest.test('ADMIN gets member by ID -> 200', async () => {
      const res = await request(`members/${createdMemberId}`, {
        token: adminToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdMemberId);
      assert.equal(data.email, testMemberEmail);
      assert.equal(data.passwordHash, undefined);
    });

    await getDetailTest.test('ADMIN gets member by memberCode -> 200', async () => {
      const res = await request(`members/code/${createdMemberCode}`, {
        token: adminToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdMemberId);
      assert.equal(data.memberCode, createdMemberCode);
    });

    await getDetailTest.test('Non-existent member ID returns 404', async () => {
      const res = await request('members/00000000-0000-0000-0000-000000000000', {
        token: adminToken,
      });
      assert.equal(res.status, 404);
    });
  });

  await t.test('4. PATCH /api/members/:id (Admin / Staff Update)', async (updateTest) => {
    await updateTest.test('ADMIN updates member fullName & phone -> 200', async () => {
      const res = await request(`members/${createdMemberId}`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({
          fullName: 'Nguyen Thi Member Updated',
          phone: '0988888888',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.fullName, 'Nguyen Thi Member Updated');
      assert.equal(data.phone, '0988888888');
    });

    await updateTest.test('MEMBER cannot call PATCH /api/members/:id -> 403 Forbidden', async () => {
      const res = await request(`members/${createdMemberId}`, {
        method: 'PATCH',
        token: memberToken,
        body: JSON.stringify({
          fullName: 'Hacked Name',
        }),
      });
      assert.equal(res.status, 403);
    });
  });

  await t.test('5. GET /api/members/me & PATCH /api/members/me (Self-service & Security)', async (selfTest) => {
    // Login as the created member
    const loginRes = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testMemberEmail,
        password: 'MemberSecret@123',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    const newMemberToken = loginData.tokens.accessToken;

    await selfTest.test('MEMBER calls GET /api/members/me -> 200 returns own profile', async () => {
      const res = await request('members/me', {
        token: newMemberToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.id, createdMemberId);
      assert.equal(data.email, testMemberEmail);
      assert.equal(data.passwordHash, undefined);
    });

    await selfTest.test('MEMBER cannot pass disallowed fields -> 400 Bad Request (Mass Assignment Protection)', async () => {
      const res = await request('members/me', {
        method: 'PATCH',
        token: newMemberToken,
        body: JSON.stringify({
          fullName: 'Nguyen Thi Hack',
          isActive: false,
          roles: ['ADMIN'],
        }),
      });
      assert.equal(res.status, 400);
    });

    await selfTest.test('MEMBER calls PATCH /api/members/me with valid fields -> 200 updates profile', async () => {
      const res = await request('members/me', {
        method: 'PATCH',
        token: newMemberToken,
        body: JSON.stringify({
          fullName: 'Nguyen Thi Self Updated',
          phone: '0977777777',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.fullName, 'Nguyen Thi Self Updated');
      assert.equal(data.phone, '0977777777');
      assert.equal(data.isActive, true);
      assert.deepEqual(data.roles, ['MEMBER']);
      assert.equal(data.memberCode, createdMemberCode);
    });

    await selfTest.test('Staff account calling GET /members/me -> 403 Forbidden (Only MEMBER role allowed)', async () => {
      const res = await request('members/me', {
        token: staffToken,
      });
      assert.equal(res.status, 403);
    });
  });
});
