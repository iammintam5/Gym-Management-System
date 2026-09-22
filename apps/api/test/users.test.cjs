const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');

test('Phase 3 - User Management Integration Tests', async (t) => {
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

  // Login as Admin
  const adminLoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@gym.com',
      password: 'Admin@123456',
    }),
  });
  assert.equal(adminLoginRes.status, 200);
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.tokens.accessToken;
  const adminId = adminData.user.id;

  // Login as Member
  const memberLoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'member@gym.com',
      password: 'Member@123456',
    }),
  });
  assert.equal(memberLoginRes.status, 200);
  const memberData = await memberLoginRes.json();
  const memberToken = memberData.tokens.accessToken;

  const seededMemberId = memberData.user.id;

  // Create a dedicated user for mutation tests
  const targetEmail = `test.user.target.${Date.now()}@gym.local`;
  const createTargetRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: targetEmail,
      fullName: 'Target Test User',
      password: 'Member@123456',
    }),
  });
  assert.ok(createTargetRes.status === 201 || createTargetRes.status === 200);
  const targetUserData = await createTargetRes.json();
  const targetMemberId = targetUserData.userId;

  // Login as target user
  const targetLoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: targetEmail,
      password: 'Member@123456',
    }),
  });
  assert.equal(targetLoginRes.status, 200);
  const targetToken = (await targetLoginRes.json()).tokens.accessToken;

  await t.test('1. GET /api/users (Listing, RBAC, Pagination, Search, Filter, Sort)', async (getUsersTest) => {
    await getUsersTest.test('ADMIN can list users -> 200 with pagination meta', async () => {
      const res = await request('users?page=1&limit=2', { token: adminToken });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data));
      assert.equal(body.data.length, 2);
      assert.equal(body.meta.page, 1);
      assert.equal(body.meta.limit, 2);
      assert.ok(body.meta.total >= 4);

      // Sensitive fields must never be exposed
      for (const u of body.data) {
        assert.equal(u.passwordHash, undefined);
        assert.equal(u.refreshTokenHash, undefined);
      }
    });

    await getUsersTest.test('MEMBER cannot list users -> 403 Forbidden', async () => {
      const res = await request('users', { token: memberToken });
      assert.equal(res.status, 403);
    });

    await getUsersTest.test('Search by email & name works', async () => {
      const res = await request('users?search=admin', { token: adminToken });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.some((u) => u.email === 'admin@gym.com'));
    });

    await getUsersTest.test('Filter by role & status works', async () => {
      const res = await request('users?role=MEMBER&isActive=true', { token: adminToken });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.every((u) => u.roles.includes('MEMBER') && u.isActive === true));
    });

    await getUsersTest.test('Sorting works', async () => {
      const res = await request('users?sortBy=email&sortOrder=asc', { token: adminToken });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.length >= 2);
      assert.ok(body.data[0].email <= body.data[1].email);
    });
  });

  await t.test('2. GET /api/users/:id (Detail & Not Found)', async (getUserTest) => {
    await getUserTest.test('Admin gets existing user by ID -> 200', async () => {
      const res = await request(`users/${seededMemberId}`, { token: adminToken });
      assert.equal(res.status, 200);
      const user = await res.json();
      assert.equal(user.id, seededMemberId);
      assert.equal(user.email, 'member@gym.com');
      assert.deepEqual(user.roles, ['MEMBER']);
      assert.equal(user.passwordHash, undefined);
    });

    await getUserTest.test('Non-existent UUID returns 404 Not Found', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(`users/${fakeUuid}`, { token: adminToken });
      assert.equal(res.status, 404);
    });
  });

  await t.test('3. PATCH /api/users/:id (Update Account Info)', async (updateUserTest) => {
    await updateUserTest.test('Admin updates user fullName & phone -> 200', async () => {
      const res = await request(`users/${targetMemberId}`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({
          fullName: 'Target Updated Name',
          phone: '0999888777',
        }),
      });
      assert.equal(res.status, 200);
      const user = await res.json();
      assert.equal(user.fullName, 'Target Updated Name');
      assert.equal(user.phone, '0999888777');
    });

    await updateUserTest.test('Duplicate email returns 409 Conflict', async () => {
      const res = await request(`users/${targetMemberId}`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({
          email: 'admin@gym.com',
        }),
      });
      assert.equal(res.status, 409);
    });
  });

  await t.test('4. PATCH /api/users/:id/status (Deactivate/Activate & Protections)', async (statusTest) => {
    await statusTest.test('Admin cannot deactivate their own account -> 409 Conflict', async () => {
      const res = await request(`users/${adminId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ isActive: false }),
      });
      assert.equal(res.status, 409);
    });

    await statusTest.test('Admin deactivates member -> 200 & Member cannot login', async () => {
      const res = await request(`users/${targetMemberId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ isActive: false }),
      });
      assert.equal(res.status, 200);
      const user = await res.json();
      assert.equal(user.isActive, false);

      // Attempt login with deactivated member -> 401
      const loginAttempt = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          password: 'Member@123456',
        }),
      });
      assert.equal(loginAttempt.status, 401);
    });

    await statusTest.test('Admin reactivates member -> 200 & Member can login again', async () => {
      const res = await request(`users/${targetMemberId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ isActive: true }),
      });
      assert.equal(res.status, 200);

      const loginAttempt = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          password: 'Member@123456',
        }),
      });
      assert.equal(loginAttempt.status, 200);
    });
  });

  await t.test('5. PATCH /api/users/:id/roles (Role Assignment & Protections)', async (rolesTest) => {
    await rolesTest.test('Admin assigns STAFF & PT roles to member -> 200', async () => {
      const res = await request(`users/${targetMemberId}/roles`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ roles: ['STAFF', 'PT'] }),
      });
      assert.equal(res.status, 200);
      const user = await res.json();
      assert.ok(user.roles.includes('STAFF'));
      assert.ok(user.roles.includes('PT'));
      assert.equal(user.roles.length, 2);
    });

    await rolesTest.test('Admin cannot remove ADMIN role from self if only admin -> 409 Conflict', async () => {
      const res = await request(`users/${adminId}/roles`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ roles: ['STAFF'] }),
      });
      assert.equal(res.status, 409);
    });

    await rolesTest.test('Revert member role back to MEMBER', async () => {
      const res = await request(`users/${targetMemberId}/roles`, {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ roles: ['MEMBER'] }),
      });
      assert.equal(res.status, 200);
    });
  });

  await t.test('6. POST /api/users/:id/change-password (Self & Security)', async (pwdTest) => {
    await pwdTest.test('User cannot change password of another user -> 403 Forbidden', async () => {
      const res = await request(`users/${adminId}/change-password`, {
        method: 'POST',
        token: targetToken,
        body: JSON.stringify({
          currentPassword: 'Member@123456',
          newPassword: 'NewPassword@123',
        }),
      });
      assert.equal(res.status, 403);
    });

    await pwdTest.test('Wrong current password returns 401', async () => {
      const res = await request(`users/${targetMemberId}/change-password`, {
        method: 'POST',
        token: targetToken,
        body: JSON.stringify({
          currentPassword: 'WrongOldPassword123!',
          newPassword: 'NewPassword@123456',
        }),
      });
      assert.equal(res.status, 401);
    });

    await pwdTest.test('Valid current password changes password successfully', async () => {
      const res = await request(`users/${targetMemberId}/change-password`, {
        method: 'POST',
        token: targetToken,
        body: JSON.stringify({
          currentPassword: 'Member@123456',
          newPassword: 'NewMemberPassword@123',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Old password fails
      const oldLogin = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          password: 'Member@123456',
        }),
      });
      assert.equal(oldLogin.status, 401);

      // New password succeeds
      const newLogin = await request('auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: targetEmail,
          password: 'NewMemberPassword@123',
        }),
      });
      assert.equal(newLogin.status, 200);
    });
  });
});
