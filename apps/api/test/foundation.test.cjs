const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
require('reflect-metadata');

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
if (
  !process.env.DATABASE_URL ||
  !['127.0.0.1', 'localhost'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
) {
  throw new Error(
    'Run foundation tests through pnpm test:local with its temporary database',
  );
}
process.env.WEB_ORIGIN = 'http://localhost:3000';

const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../dist/common/constants/auth');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('HTTP foundation & RBAC tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const db = app.get(DatabaseService);

  const seedAdmin = await db.client.user.findUnique({
    where: { email: 'admin@gym.com' },
  });

  const jwt = new JwtService();
  const sign = (roles, payload = {}, options = {}) =>
    jwt.sign(
      { sub: seedAdmin?.id || 'test-user', roles, type: 'access', ...payload },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: '15m',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ...options,
      },
    );
  const request = (path, token) =>
    fetch(`${base}/api/${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  await t.test('public health and CORS', async () => {
    const response = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:3000',
    );
  });

  await t.test('OpenAPI documents real routes', async () => {
    const response = await fetch(`${base}/api/docs-json`);
    assert.equal(response.status, 200);
    const schema = await response.json();
    assert.ok(schema.paths['/api/health']);
    assert.ok(schema.paths['/api/auth/login']);
  });

  await t.test(
    'missing, tampered, expired, refresh and malformed claims are denied',
    async () => {
      const tokens = [
        undefined,
        'not-a-jwt',
        sign(['MEMBER'], {}, { secret: 'wrong-secret' }),
        sign(['MEMBER'], {}, { expiresIn: -1 }),
        sign(['MEMBER'], { type: 'refresh' }),
        sign(['UNKNOWN']),
        sign(['MEMBER'], { sub: '' }),
        sign(['MEMBER'], {}, { audience: 'wrong' }),
      ];
      for (const token of tokens)
        assert.equal((await request('auth/me', token)).status, 401);
      const noExpiry = jwt.sign(
        {
          sub: seedAdmin?.id || 'test-user',
          roles: ['MEMBER'],
          type: 'access',
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      );
      assert.equal((await request('auth/me', noExpiry)).status, 401);
    },
  );

  await t.test(
    'verified claims populate CurrentUser and load from DB',
    async () => {
      const response = await request('auth/me', sign(['ADMIN']));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.email, 'admin@gym.com');
      assert.deepEqual(data.roles, ['ADMIN']);
    },
  );

  await t.test(
    'RBAC distinguishes unauthenticated, forbidden and unimplemented',
    async () => {
      assert.equal((await request('reports/overview')).status, 401);
      assert.equal(
        (await request('reports/overview', sign(['MEMBER']))).status,
        403,
      );
      assert.equal(
        (await request('reports/overview', sign(['ADMIN']))).status,
        501,
      );
    },
  );

  await t.test(
    'validation rejects extra fields and malformed login; non-existent user returns 401',
    async () => {
      for (const [body, status] of [
        [{ email: 'invalid', password: 'short' }, 400],
        [
          {
            email: 'test@example.com',
            password: 'some-password',
            role: 'ADMIN',
          },
          400,
        ],
        [{ email: 'nonexistent@example.com', password: 'some-password' }, 401],
      ]) {
        const response = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, status);
      }
    },
  );
});
