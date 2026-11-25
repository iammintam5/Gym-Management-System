const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
require('reflect-metadata');

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || randomBytes(48).toString('hex');

if (
  !process.env.DATABASE_URL ||
  !['127.0.0.1', 'localhost'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
) {
  throw new Error(
    'Run API role compatibility tests through pnpm --filter @gym/api test (temporary PostgreSQL)',
  );
}

const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../dist/common/constants/auth');
const { DatabaseService } = require('../dist/modules/database/database.module');

test(
  'Forward SQL migration renames UserRole PT -> TRAINER while preserving IDs, assignments, sessions, and PT service type',
  { timeout: 60000 },
  async (t) => {
    const dbRequire = createRequire(require.resolve('@gym/database'));
    const { Client } = dbRequire('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const schemaName = 'batch2a_mig_test';
    t.after(async () => {
      await client
        .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .catch(() => undefined);
      await client.end();
    });

    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);

    const migrationsDir = path.resolve(
      __dirname,
      '../../../packages/database/prisma/migrations',
    );
    const targetMigration = '20261116000000_rename_user_role_pt_to_trainer';
    const migrationNames = fs
      .readdirSync(migrationsDir)
      .filter((name) =>
        fs.existsSync(path.join(migrationsDir, name, 'migration.sql')),
      )
      .sort();

    const preMigrationNames = migrationNames.filter(
      (name) => name < targetMigration,
    );
    assert.ok(preMigrationNames.length >= 7);
    assert.ok(migrationNames.includes(targetMigration));

    for (const name of preMigrationNames) {
      const sql = fs.readFileSync(
        path.join(migrationsDir, name, 'migration.sql'),
        'utf8',
      );
      await client.query(sql);
    }

    const ids = {
      adminRole: '00000000-0000-4000-8000-000000000001',
      staffRole: '00000000-0000-4000-8000-000000000002',
      trainerRole: '00000000-0000-4000-8000-000000000003',
      memberRole: '00000000-0000-4000-8000-000000000004',
      trainerUser: '10000000-0000-4000-8000-000000000011',
      employeeProfile: '20000000-0000-4000-8000-000000000011',
      authSession: '30000000-0000-4000-8000-000000000011',
      ptServiceType: '40000000-0000-4000-8000-000000000011',
    };

    await client.query(
      `INSERT INTO roles (id, code, name) VALUES
        ($1, 'ADMIN', 'ADMIN'),
        ($2, 'STAFF', 'STAFF'),
        ($3, 'PT', 'PT'),
        ($4, 'MEMBER', 'MEMBER')`,
      [ids.adminRole, ids.staffRole, ids.trainerRole, ids.memberRole],
    );
    await client.query(
      `INSERT INTO users (id, email, password_hash, is_active, updated_at)
       VALUES ($1, 'legacy.trainer@gym.local', 'hashed', true, NOW())`,
      [ids.trainerUser],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
      [ids.trainerUser, ids.trainerRole],
    );
    await client.query(
      `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, 'legacy-session-hash', NOW() + INTERVAL '1 day')`,
      [ids.authSession, ids.trainerUser],
    );
    await client.query(
      `INSERT INTO employee_profiles (id, user_id, full_name, updated_at)
       VALUES ($1, $2, 'Coach Legacy', NOW())`,
      [ids.employeeProfile, ids.trainerUser],
    );
    await client.query(
      `INSERT INTO service_types (id, code, name) VALUES ($1, 'PT', 'PT 1-1')`,
      [ids.ptServiceType],
    );

    const forwardSql = fs.readFileSync(
      path.join(migrationsDir, targetMigration, 'migration.sql'),
      'utf8',
    );
    await client.query(forwardSql);

    const roleRows = await client.query(
      `SELECT id::text AS id, code::text AS code, name FROM roles ORDER BY id`,
    );
    assert.deepEqual(roleRows.rows, [
      { id: ids.adminRole, code: 'ADMIN', name: 'Quản trị viên' },
      { id: ids.staffRole, code: 'STAFF', name: 'Nhân viên' },
      { id: ids.trainerRole, code: 'TRAINER', name: 'Huấn luyện viên' },
      { id: ids.memberRole, code: 'MEMBER', name: 'Hội viên' },
    ]);

    const assignmentRows = await client.query(
      `SELECT user_id::text AS user_id, role_id::text AS role_id FROM user_roles`,
    );
    assert.deepEqual(assignmentRows.rows, [
      { user_id: ids.trainerUser, role_id: ids.trainerRole },
    ]);

    const sessionRows = await client.query(
      `SELECT id::text AS id, user_id::text AS user_id, token_hash FROM auth_sessions`,
    );
    assert.deepEqual(sessionRows.rows, [
      {
        id: ids.authSession,
        user_id: ids.trainerUser,
        token_hash: 'legacy-session-hash',
      },
    ]);

    const employeeRows = await client.query(
      `SELECT id::text AS id, full_name FROM employee_profiles`,
    );
    assert.deepEqual(employeeRows.rows, [
      { id: ids.employeeProfile, full_name: 'Coach Legacy' },
    ]);

    const serviceRows = await client.query(
      `SELECT id::text AS id, code, name FROM service_types`,
    );
    assert.deepEqual(serviceRows.rows, [
      { id: ids.ptServiceType, code: 'PT', name: 'PT 1-1' },
    ]);

    await assert.rejects(
      client.query(`SELECT 'PT'::"${schemaName}"."UserRole"`),
      /invalid input value for enum/,
    );
  },
);

test(
  'Backend JWT legacy PT normalization, unknown-role rejection, refresh TRAINER issuance, and canonical DTO checks',
  { timeout: 60000 },
  async (t) => {
    const app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());

    const base = await app.getUrl();
    const db = app.get(DatabaseService);
    const jwt = new JwtService();

    const request = (apiPath, options = {}) =>
      fetch(`${base}/api/${apiPath}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
          ...options.headers,
        },
        ...options,
      });

    const signAccess = (roles, overrides = {}, options = {}) =>
      jwt.sign(
        {
          sub: trainerUser.id,
          roles,
          type: 'access',
          ...overrides,
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          expiresIn: '15m',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          ...options,
        },
      );

    const trainerUser = await db.client.user.findUnique({
      where: { email: 'pt@gym.com' },
      include: { roles: { include: { role: true } } },
    });
    assert.ok(trainerUser, 'Seeded trainer pt@gym.com must exist');
    assert.equal(trainerUser.roles[0].role.code, 'TRAINER');
    assert.equal(trainerUser.roles[0].role.name, 'Huấn luyện viên');

    const adminLoginRes = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@gym.com',
        password: 'Admin@123456',
      }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminToken = (await adminLoginRes.json()).tokens.accessToken;

    const trainerLoginRes = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'pt@gym.com',
        password: 'Pt@123456',
      }),
    });
    assert.equal(trainerLoginRes.status, 200);
    const trainerLoginData = await trainerLoginRes.json();
    assert.deepEqual(trainerLoginData.user.roles, ['TRAINER']);

    const verifiedLoginClaims = jwt.verify(
      trainerLoginData.tokens.accessToken,
      {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
    assert.deepEqual(verifiedLoginClaims.roles, ['TRAINER']);

    await t.test(
      'Validly signed access JWT carrying legacy PT normalizes to TRAINER',
      async () => {
        const legacyPtToken = signAccess(['PT']);

        const meRes = await request('auth/me', { token: legacyPtToken });
        assert.equal(meRes.status, 200);
        const meData = await meRes.json();
        assert.deepEqual(meData.roles, ['TRAINER']);

        const empMeRes = await request('employees/me', {
          token: legacyPtToken,
        });
        assert.equal(empMeRes.status, 200);

        const ptRosterRes = await request('pt-bookings/trainer', {
          token: legacyPtToken,
        });
        assert.equal(ptRosterRes.status, 200);

        const adminOnlyRes = await request('employees', {
          token: legacyPtToken,
        });
        assert.equal(adminOnlyRes.status, 403);
      },
    );

    await t.test(
      'Signature, expiry, issuer, and audience are verified before role normalization; unknown roles are rejected',
      async () => {
        const validLegacyToken = signAccess(['PT']);
        const tamperedToken = `${validLegacyToken.slice(0, -4)}XXXX`;

        const invalidTokens = [
          signAccess(
            ['PT'],
            {},
            { secret: 'wrong-secret-00000000000000000000' },
          ),
          tamperedToken,
          signAccess(['PT'], {}, { expiresIn: -10 }),
          signAccess(['PT'], {}, { audience: 'wrong-audience' }),
          signAccess(['PT'], {}, { issuer: 'wrong-issuer' }),
          signAccess(['UNKNOWN']),
          signAccess(['PT', 'SUPERADMIN']),
          signAccess(['pt']),
          signAccess('PT'),
        ];

        for (const badToken of invalidTokens) {
          const res = await request('employees/me', { token: badToken });
          assert.equal(res.status, 401);
        }
      },
    );

    await t.test(
      'POST /api/auth/refresh emits canonical TRAINER role on new access token',
      async () => {
        const refreshRes = await request('auth/refresh', {
          method: 'POST',
          body: JSON.stringify({
            refreshToken: trainerLoginData.tokens.refreshToken,
          }),
        });
        assert.equal(refreshRes.status, 200);
        const refreshed = await refreshRes.json();
        const decoded = jwt.verify(refreshed.accessToken, {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        });
        assert.deepEqual(decoded.roles, ['TRAINER']);
      },
    );

    await t.test(
      'Canonical DTOs reject legacy role input and active service types exclude retired PT',
      async () => {
        const createEmpRes = await request('employees', {
          method: 'POST',
          token: adminToken,
          body: JSON.stringify({
            email: `legacy.role.${Date.now()}@gym.local`,
            fullName: 'Rejected PT Role',
            role: 'PT',
          }),
        });
        assert.equal(createEmpRes.status, 400);

        const updateUserRoleRes = await request(
          `users/${trainerUser.id}/roles`,
          {
            method: 'PATCH',
            token: adminToken,
            body: JSON.stringify({ roles: ['PT'] }),
          },
        );
        assert.equal(updateUserRoleRes.status, 400);

        const serviceTypesRes = await request(
          'membership-plans/service-types',
          {
            token: adminToken,
          },
        );
        assert.equal(serviceTypesRes.status, 200);
        const serviceTypes = await serviceTypesRes.json();
        assert.ok(!serviceTypes.some((st) => st.code === 'PT'));
      },
    );
  },
);
