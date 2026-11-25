require('reflect-metadata');
process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { createPrismaClient } = require('@gym/database');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../dist/common/constants/auth');
const {
  PtCreditService,
} = require('../dist/modules/pt-packages/pt-credit.service');
test('catalog read performance keeps mutation freshness, public scope and RBAC', async (t) => {
  assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
  const db = createPrismaClient(process.env.DATABASE_URL),
    app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });
  const base = await app.getUrl(),
    jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  async function actor(role) {
    const row = await db.user.create({
      data: {
        email: randomUUID() + '@example.invalid',
        passwordHash: 'fixture',
        roles: { create: { role: { connect: { code: role } } } },
      },
    });
    return jwt.sign(
      { sub: row.id, roles: [role], type: 'access' },
      { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '5m' },
    );
  }
  const admin = await actor('ADMIN'),
    member = await actor('MEMBER');
  async function api(method, route, token, body) {
    const r = await fetch(base + '/api' + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  const name = 'Speed ' + randomUUID(),
    list = '/membership-plans?limit=100&search=' + encodeURIComponent(name);
  const create = async (suffix) =>
    api('POST', '/membership-plans', admin, {
      name: name + suffix,
      durationDays: 30,
      price: 100000,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 8 },
      ],
    });
  const created = await create(' A');
  assert.equal(created.status, 201);
  const id = created.body.id;
  const credits = app.get(PtCreditService),
    original = credits.hasCutoverOccurred.bind(credits);
  let ptReads = 0;
  credits.hasCutoverOccurred = async () => {
    ptReads++;
    return original();
  };
  async function readAll() {
    const before = ptReads;
    const rows = await api('GET', list, admin);
    const detail = await api('GET', '/membership-plans/' + id, admin);
    const pub = await api('GET', '/public/membership-plans');
    const services = await api('GET', '/membership-plans/service-types', admin);
    for (const r of [rows, detail, pub, services]) assert.equal(r.status, 200);
    assert.equal(
      ptReads,
      before,
      'read paths must not query PT conversion state',
    );
    return { rows: rows.body, detail: detail.body, pub: pub.body };
  }
  await readAll();
  await readAll();
  const edit = await api('PATCH', '/membership-plans/' + id, admin, {
    price: 250000,
  });
  assert.equal(edit.status, 200);
  let fresh = await readAll();
  assert.equal(fresh.detail.price, 250000);
  assert.equal(fresh.rows.data.find((p) => p.id === id).price, 250000);
  assert.equal(fresh.pub.find((p) => p.id === id).price, 250000);
  const quota = await api(
    'PUT',
    '/membership-plans/' + id + '/entitlements',
    admin,
    {
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
        { service: 'CLASS', limitType: 'COUNT', limitValue: 12 },
      ],
    },
  );
  assert.equal(quota.status, 200);
  fresh = await readAll();
  assert.equal(
    fresh.detail.entitlements.find((e) => e.service === 'CLASS').limitValue,
    12,
  );
  const status = await api(
    'PATCH',
    '/membership-plans/' + id + '/status',
    admin,
    { isActive: false },
  );
  assert.equal(status.status, 200);
  fresh = await readAll();
  assert.equal(fresh.detail.isActive, false);
  assert.ok(!fresh.pub.some((p) => p.id === id));
  assert.equal((await create(' B')).status, 201);
  fresh = await readAll();
  assert.equal(fresh.rows.meta.total, 2);
  assert.equal((await api('GET', list)).status, 401);
  assert.equal((await api('GET', list, member)).status, 403);
});
