const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Phase 2 - Authentication & RBAC Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const base = await app.getUrl();
  const db = app.get(DatabaseService);

  const request = (path, options = {}) =>
    fetch(`${base}/api/${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...options,
    });

  // Ensure test users exist
  const seedAdmin = await db.client.user.findUnique({
    where: { email: 'admin@gym.com' },
  });
  assert.ok(seedAdmin, 'Admin user should be seeded in DB');

  let adminAccessToken = '';
  let adminRefreshToken = '';

  await t.test('1. Login Endpoint', async (loginTest) => {
    await loginTest.test(
      'Valid email & password returns token pair and user profile',
      async () => {
        const res = await request('auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'admin@gym.com',
            password: 'Admin@123456',
          }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.tokens.accessToken, 'Should return accessToken');
        assert.ok(data.tokens.refreshToken, 'Should return refreshToken');
        assert.equal(data.user.email, 'admin@gym.com');
        assert.deepEqual(data.user.roles, ['ADMIN']);
        assert.equal(
          data.user.passwordHash,
          undefined,
          'Must not expose passwordHash',
        );
        assert.equal(
          data.user.refreshTokenHash,
          undefined,
          'Must not expose refreshTokenHash',
        );

        adminAccessToken = data.tokens.accessToken;
        adminRefreshToken = data.tokens.refreshToken;
      },
    );

    await loginTest.test(
      'Wrong password returns 401 Invalid credentials',
      async () => {
        const res = await request('auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'admin@gym.com',
            password: 'WrongPassword123!',
          }),
        });
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.equal(data.message, 'Invalid credentials');
      },
    );

    await loginTest.test(
      'Non-existent email returns 401 Invalid credentials',
      async () => {
        const res = await request('auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'nonexistent@gym.com',
            password: 'SomePassword123!',
          }),
        });
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.equal(data.message, 'Invalid credentials');
      },
    );

    await loginTest.test(
      'Validation rejects invalid email / short password',
      async () => {
        const res = await request('auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: 'invalid-email',
            password: '123',
          }),
        });
        assert.equal(res.status, 400);
      },
    );
  });

  await t.test('2. /auth/me Endpoint (DB-backed)', async (meTest) => {
    await meTest.test(
      'Valid Bearer token returns current user profile from DB',
      async () => {
        const res = await request('auth/me', { token: adminAccessToken });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.email, 'admin@gym.com');
        assert.deepEqual(data.roles, ['ADMIN']);
        assert.equal(data.fullName, 'System Administrator');
        assert.equal(data.passwordHash, undefined);
      },
    );

    await meTest.test('Missing Bearer token returns 401', async () => {
      const res = await request('auth/me');
      assert.equal(res.status, 401);
    });

    await meTest.test('Invalid or tampered token returns 401', async () => {
      const res = await request('auth/me', { token: 'invalid.jwt.token' });
      assert.equal(res.status, 401);
    });
  });

  await t.test('3. Refresh Token Flow & Rotation', async (refreshTest) => {
    let rotatedRefreshToken = '';

    await refreshTest.test(
      'Valid refresh token issues new token pair',
      async () => {
        const res = await request('auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: adminRefreshToken }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.accessToken);
        assert.ok(data.refreshToken);
        assert.notEqual(
          data.refreshToken,
          adminRefreshToken,
          'Should issue new refresh token',
        );

        adminAccessToken = data.accessToken;
        rotatedRefreshToken = data.refreshToken;
      },
    );

    await refreshTest.test(
      'Old refresh token is invalidated after rotation',
      async () => {
        const res = await request('auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: adminRefreshToken }),
        });
        assert.equal(res.status, 401);
      },
    );

    await refreshTest.test('Invalid refresh token returns 401', async () => {
      const res = await request('auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'fake-refresh-token' }),
      });
      assert.equal(res.status, 401);
    });

    adminRefreshToken = rotatedRefreshToken;
  });

  await t.test('4. RBAC Roles Guard', async (rbacTest) => {
    // Login as Member
    const memberLogin = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'member@gym.com',
        password: 'Member@123456',
      }),
    });
    assert.equal(memberLogin.status, 200);
    const memberData = await memberLogin.json();
    const memberToken = memberData.tokens.accessToken;

    // Login as Staff
    const staffLogin = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff@gym.com',
        password: 'Staff@123456',
      }),
    });
    assert.equal(staffLogin.status, 200);
    const staffData = await staffLogin.json();
    const staffToken = staffData.tokens.accessToken;

    await rbacTest.test(
      'Member cannot access Admin-only route -> 403 Forbidden',
      async () => {
        const res = await request('reports/overview', { token: memberToken });
        assert.equal(res.status, 403);
      },
    );

    await rbacTest.test(
      'Staff cannot access Admin-only route -> 403 Forbidden',
      async () => {
        const res = await request('reports/overview', { token: staffToken });
        assert.equal(res.status, 403);
      },
    );

    await rbacTest.test(
      'Admin accesses Admin route -> Passes RBAC (returns 501 Unimplemented)',
      async () => {
        const res = await request('reports/overview', {
          token: adminAccessToken,
        });
        assert.equal(res.status, 501);
      },
    );
  });

  await t.test('5. Logout Flow', async (logoutTest) => {
    await logoutTest.test('Logout invalidates refresh token', async () => {
      const res = await request('auth/logout', {
        method: 'POST',
        token: adminAccessToken,
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Attempt refresh with previous refresh token after logout -> 401
      const refreshRes = await request('auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: adminRefreshToken }),
      });
      assert.equal(refreshRes.status, 401);
    });
  });
});
