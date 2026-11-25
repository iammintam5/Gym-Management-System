const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes, randomUUID } = require('node:crypto');
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
    'Run API Batch 3B tests through pnpm --filter @gym/api test (temporary PostgreSQL)',
  );
}

const { NestFactory } = require('@nestjs/core');
const {
  DEFAULT_PT_PACKAGE_PLANS,
  PtPurchaseOrigin,
  PtPurchaseStatus,
  PaymentStatus,
  SubscriptionStatus,
  effectivePtPurchaseStatus,
  evaluateGymCoverageForSlot,
  selectPtCreditSourceForSlot,
} = require('@gym/contracts');
const { createPrismaClient } = require('@gym/database');
const { AppModule } = require('../dist/app.module');
const { DatabaseService } = require('../dist/modules/database/database.module');
const { setupApp } = require('../dist/config/setup-app');
const {
  PtCatalogInitializerService,
} = require('../dist/modules/pt-packages/pt-catalog-initializer.service');
const {
  PtLegacyConversionService,
} = require('../dist/modules/pt-packages/pt-legacy-conversion.service');

const dbRequire = createRequire(require.resolve('@gym/database'));
const { Client } = dbRequire('pg');

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '../../../packages/database/prisma/migrations',
);
const BATCH_3B_MIGRATION =
  '20261116020000_add_standalone_pt_packages_foundation';

function getSortedMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) =>
      fs.existsSync(path.join(MIGRATIONS_DIR, name, 'migration.sql')),
    )
    .sort();
}

async function createIsolatedDb(t, prefix) {
  const adminClient = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await adminClient.connect();
  const dbName = `${prefix}_${randomBytes(4).toString('hex')}`;
  await adminClient.query(`CREATE DATABASE "${dbName}"`);

  const targetUrl = new URL(process.env.DATABASE_URL);
  targetUrl.pathname = `/${dbName}`;
  const dbUrl = targetUrl.toString();

  const pgClient = new Client({ connectionString: dbUrl });
  await pgClient.connect();
  const prisma = createPrismaClient(dbUrl);

  t.after(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await pgClient.end().catch(() => undefined);
    await adminClient
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      )
      .catch(() => undefined);
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${dbName}"`)
      .catch(() => undefined);
    await adminClient.end().catch(() => undefined);
  });

  const dbService = { client: prisma };
  return {
    dbUrl,
    pgClient,
    prisma,
    catalogInitializer: new PtCatalogInitializerService(dbService),
    conversionService: new PtLegacyConversionService(dbService),
  };
}

async function applyAllMigrations(pgClient, upToExclusive) {
  const migrations = getSortedMigrations();
  assert.ok(migrations.includes(BATCH_3B_MIGRATION));
  for (const name of migrations) {
    if (upToExclusive && name >= upToExclusive) {
      continue;
    }
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, name, 'migration.sql'),
      'utf8',
    );
    await pgClient.query(sql);
  }
}

async function seedBaseActorsAndServices(pgClient) {
  const adminUserId = randomUUID();
  const trainerUserId = randomUUID();
  const trainerId = randomUUID();
  const memberAUserId = randomUUID();
  const memberAId = randomUUID();
  const memberBUserId = randomUUID();
  const memberBId = randomUUID();
  const ptServiceId = randomUUID();
  const classServiceId = randomUUID();
  const gymServiceId = randomUUID();
  const legacyPlanId = randomUUID();

  await pgClient.query(
    `INSERT INTO users (id, email, password_hash, is_active, updated_at) VALUES
      ($1, 'admin.3b@gym.local', 'hash', true, NOW()),
      ($2, 'trainer.3b@gym.local', 'hash', true, NOW()),
      ($3, 'membera.3b@gym.local', 'hash', true, NOW()),
      ($4, 'memberb.3b@gym.local', 'hash', true, NOW())`,
    [adminUserId, trainerUserId, memberAUserId, memberBUserId],
  );
  await pgClient.query(
    `INSERT INTO employee_profiles (id, user_id, full_name, can_teach_classes, can_coach_pt, updated_at)
     VALUES ($1, $2, 'HLV Batch 3B', true, true, NOW())`,
    [trainerId, trainerUserId],
  );
  await pgClient.query(
    `INSERT INTO member_profiles (id, user_id, full_name, updated_at) VALUES
      ($1, $2, 'Hội viên A', NOW()),
      ($3, $4, 'Hội viên B', NOW())`,
    [memberAId, memberAUserId, memberBId, memberBUserId],
  );
  await pgClient.query(
    `INSERT INTO service_types (id, code, name) VALUES
      ($1, 'PT', 'PT 1-1'),
      ($2, 'CLASS', 'Group Class'),
      ($3, 'GYM_ACCESS', 'Full Gym')`,
    [ptServiceId, classServiceId, gymServiceId],
  );
  await pgClient.query(
    `INSERT INTO membership_plans (id, name, duration_days, price, is_active, updated_at)
     VALUES ($1, 'Legacy Pro', 90, 1490000, true, NOW())`,
    [legacyPlanId],
  );

  return {
    adminUserId,
    trainerId,
    memberAId,
    memberBId,
    ptServiceId,
    classServiceId,
    gymServiceId,
    legacyPlanId,
  };
}

test(
  'Legacy DI wiring and protected history remain readable without mutating stored data',
  { timeout: 60000 },
  async (t) => {
    const app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());

    const initializer = app.get(PtCatalogInitializerService);
    const conversion = app.get(PtLegacyConversionService);
    assert.ok(initializer);
    assert.ok(conversion);

    // The catalog may already exist after cashier integration tests.
    // Dry-run must preserve every persisted plan and audit row in either state.
    const db = app.get(DatabaseService).client;
    const plansBefore = await db.ptPackagePlan.findMany({
      orderBy: { id: 'asc' },
    });
    const auditsBefore = await db.auditLog.count();
    const sampleCodes = DEFAULT_PT_PACKAGE_PLANS.map((plan) => plan.code);
    const catalogDryRun = await initializer.initializeDefaultPlans({
      dryRun: true,
    });
    assert.equal(catalogDryRun.dryRun, true);
    assert.deepEqual(
      catalogDryRun.createdCodes,
      sampleCodes.filter(
        (code) => !plansBefore.some((plan) => plan.code === code),
      ),
    );
    assert.deepEqual(
      catalogDryRun.plans.map((plan) => plan.code).sort(),
      plansBefore
        .filter((plan) => sampleCodes.includes(plan.code))
        .map((plan) => plan.code)
        .sort(),
    );
    assert.equal(
      JSON.stringify(
        await db.ptPackagePlan.findMany({ orderBy: { id: 'asc' } }),
      ),
      JSON.stringify(plansBefore),
    );
    assert.equal(await db.auditLog.count(), auditsBefore);

    const conversionDryRun = await conversion.runLegacyConversion({
      cutoverAt: new Date().toISOString(),
      dryRun: true,
    });
    assert.equal(conversionDryRun.dryRun, true);
    assert.equal(
      conversionDryRun.totalLegacyQuotas,
      await db.subscriptionQuota.count({
        where: { serviceType: { code: 'PT' } },
      }),
    );
    assert.equal(conversionDryRun.createdPurchasesCount, 0);

    const base = await app.getUrl();
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@gym.com',
        password: 'Admin@123456',
      }),
    });
    assert.equal(loginRes.status, 200);
    const adminToken = (await loginRes.json()).tokens.accessToken;

    const ptBookingsRes = await fetch(`${base}/api/pt-bookings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(ptBookingsRes.status, 200);

    const paymentsRes = await fetch(`${base}/api/payments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(paymentsRes.status, 200);
  },
);

test(
  'Forward migration adds pure DDL with zero eager rows and preserves historical 45m/90m PT bookings & CARD receipts',
  { timeout: 60000 },
  async (t) => {
    const { pgClient } = await createIsolatedDb(t, 'b3b_mig');
    await applyAllMigrations(pgClient, BATCH_3B_MIGRATION);
    const base = await seedBaseActorsAndServices(pgClient);

    const subId = randomUUID();
    const ptQuotaId = randomUUID();
    const booking45Id = randomUUID();
    const booking90Id = randomUUID();
    const cardPaymentId = randomUUID();

    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, activated_at, updated_at)
       VALUES ($1, $2, $3, '2026-10-01T00:00:00Z', '2026-12-30T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-10-01T00:00:00Z', NOW())`,
      [subId, base.memberAId, base.legacyPlanId],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at)
       VALUES ($1, $2, $3, 10, 1, 2, NOW())`,
      [ptQuotaId, subId, base.ptServiceId],
    );
    await pgClient.query(
      `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, starts_at, ends_at, status, attendance, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, '2026-11-20T09:00:00Z', '2026-11-20T09:45:00Z', 'BOOKED', 'PENDING', NOW()),
         ($6, $2, $3, $4, $5, '2026-11-05T10:00:00Z', '2026-11-05T11:30:00Z', 'COMPLETED', 'PRESENT', NOW())`,
      [
        booking45Id,
        base.memberAId,
        base.trainerId,
        subId,
        ptQuotaId,
        booking90Id,
      ],
    );
    await pgClient.query(
      `INSERT INTO payment_records (id, subscription_id, amount, currency, status, method, note, confirmed_by, confirmed_at)
       VALUES ($1, $2, 1490000, 'VND', 'PAID', 'CARD', 'REC-20261001-0001', $3, '2026-10-01T00:05:00Z')`,
      [cardPaymentId, subId, base.adminUserId],
    );

    const forwardSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, BATCH_3B_MIGRATION, 'migration.sql'),
      'utf8',
    );
    await pgClient.query(forwardSql);

    const planCount = await pgClient.query(
      `SELECT COUNT(*)::int AS cnt FROM pt_package_plans`,
    );
    const purchaseCount = await pgClient.query(
      `SELECT COUNT(*)::int AS cnt FROM pt_package_purchases`,
    );
    assert.equal(planCount.rows[0].cnt, 0);
    assert.equal(purchaseCount.rows[0].cnt, 0);

    // Updating a pre-existing 45-minute booking must succeed (no 60-minute table CHECK blocking history updates).
    await pgClient.query(
      `UPDATE pt_bookings SET status = 'COMPLETED', attendance = 'PRESENT', attended_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [booking45Id],
    );
    const durations = await pgClient.query(
      `SELECT id::text, EXTRACT(EPOCH FROM (ends_at - starts_at))::int / 60 AS mins, pt_purchase_id
       FROM pt_bookings ORDER BY starts_at ASC`,
    );
    assert.deepEqual(
      durations.rows.map((r) => ({
        mins: r.mins,
        ptPurchaseId: r.pt_purchase_id,
      })),
      [
        { mins: 90, ptPurchaseId: null },
        { mins: 45, ptPurchaseId: null },
      ],
    );

    const payment = await pgClient.query(
      `SELECT method, note, pt_purchase_id FROM payment_records WHERE id = $1`,
      [cardPaymentId],
    );
    assert.deepEqual(payment.rows[0], {
      method: 'CARD',
      note: 'REC-20261001-0001',
      pt_purchase_id: null,
    });
  },
);

test(
  'SQL CHECK constraints prevent NULL bypasses and enforce composite owner/source FKs & payment XOR',
  { timeout: 60000 },
  async (t) => {
    const { pgClient } = await createIsolatedDb(t, 'b3b_sql');
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const planPt5Id = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_package_plans (id, code, name, session_count, session_minutes, price, is_active, updated_at)
       VALUES ($1, 'PT5', 'Gói PT 5 buổi', 5, 60, 2250000, true, NOW())`,
      [planPt5Id],
    );

    // Non-60 catalog minutes or non-positive session_count rejected
    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_package_plans (id, code, name, session_count, session_minutes, price, updated_at)
         VALUES ($1, 'PT_BAD', 'Bad Minutes', 5, 45, 500000, NOW())`,
        [randomUUID()],
      ),
      /pt_package_plans_valid_terms/,
    );

    const subA = randomUUID();
    const quotaPtA = randomUUID();
    const subB = randomUUID();
    const quotaPtB = randomUUID();

    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, updated_at) VALUES
        ($1, $2, $3, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'ACTIVE', 'PAID', 1490000, NOW()),
        ($4, $5, $3, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'ACTIVE', 'PAID', 1490000, NOW())`,
      [subA, base.memberAId, base.legacyPlanId, subB, base.memberBId],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at) VALUES
        ($1, $2, $3, 5, 0, 0, NOW()),
        ($4, $5, $3, 5, 0, 0, NOW())`,
      [quotaPtA, subA, base.ptServiceId, quotaPtB, subB],
    );

    // Standalone NULL-bypass attempts must all fail CHECK constraints
    const badStandaloneCases = [
      // allocated NULL
      {
        allocated: null,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // agreed_price NULL
      {
        allocated: 5,
        price: null,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // session_count_snapshot NULL
      {
        allocated: 5,
        price: 2250000,
        countSnap: null,
        currency: 'VND',
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // currency NULL
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: null,
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // session_minutes_snapshot != 60
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 45,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // EXPIRED status disallowed on standalone
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'EXPIRED',
        payStatus: 'PAID',
        reserved: 0,
        used: 0,
      },
      // EXHAUSTED disallowed while reserved > 0
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'EXHAUSTED',
        payStatus: 'PAID',
        reserved: 1,
        used: 4,
      },
      // ACTIVE disallowed when reserved = 0 and used = allocated
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: 0,
        used: 5,
      },
      // REFUNDED disallowed while reserved > 0
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'REFUNDED',
        payStatus: 'REFUNDED',
        reserved: 1,
        used: 0,
      },
      // Negative balance
      {
        allocated: 5,
        price: 2250000,
        countSnap: 5,
        currency: 'VND',
        mins: 60,
        status: 'ACTIVE',
        payStatus: 'PAID',
        reserved: -1,
        used: 0,
      },
    ];

    for (const bad of badStandaloneCases) {
      await assert.rejects(
        pgClient.query(
          `INSERT INTO pt_package_purchases (
            id, member_id, origin, pt_plan_id, package_code_snapshot, package_name_snapshot,
            session_count_snapshot, session_minutes_snapshot, allocated, reserved, used,
            agreed_price, currency, payment_status, status, updated_at
          ) VALUES ($1, $2, 'STANDALONE', $3, 'PT5', 'Gói PT 5 buổi', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            randomUUID(),
            base.memberAId,
            planPt5Id,
            bad.countSnap,
            bad.mins,
            bad.allocated,
            bad.reserved,
            bad.used,
            bad.price,
            bad.currency,
            bad.payStatus,
            bad.status,
          ],
        ),
        (err) => err.code === '23514',
      );
    }

    // Legacy non-null price or cross-owner/cross-quota composite FKs rejected
    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_package_purchases (
          id, member_id, origin, source_subscription_id, legacy_quota_id,
          package_code_snapshot, package_name_snapshot, session_count_snapshot, session_minutes_snapshot,
          allocated, reserved, used, agreed_price, currency, payment_status, status,
          original_start_date, original_end_date, cutover_at, cutover_eligible, updated_at
        ) VALUES ($1, $2, 'LEGACY_BUNDLED', $3, $4, 'LEGACY_PT', 'Legacy', 5, 60, 5, 0, 0, 500000, NULL, 'PAID', 'ACTIVE', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', NOW(), true, NOW())`,
        [randomUUID(), base.memberAId, subA, quotaPtA],
      ),
      /pt_package_purchases_origin_shape/,
    );

    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_package_purchases (
          id, member_id, origin, source_subscription_id, legacy_quota_id,
          package_code_snapshot, package_name_snapshot, session_count_snapshot, session_minutes_snapshot,
          allocated, reserved, used, agreed_price, currency, payment_status, status,
          original_start_date, original_end_date, cutover_at, cutover_eligible, updated_at
        ) VALUES ($1, $2, 'LEGACY_BUNDLED', $3, $4, 'LEGACY_PT', 'Legacy', 5, 60, 5, 0, 0, NULL, NULL, 'PAID', 'ACTIVE', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', NOW(), true, NOW())`,
        [randomUUID(), base.memberBId, subA, quotaPtA],
      ),
      (err) => err.code === '23503',
    );

    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_package_purchases (
          id, member_id, origin, source_subscription_id, legacy_quota_id,
          package_code_snapshot, package_name_snapshot, session_count_snapshot, session_minutes_snapshot,
          allocated, reserved, used, agreed_price, currency, payment_status, status,
          original_start_date, original_end_date, cutover_at, cutover_eligible, updated_at
        ) VALUES ($1, $2, 'LEGACY_BUNDLED', $3, $4, 'LEGACY_PT', 'Legacy', 5, 60, 5, 0, 0, NULL, NULL, 'PAID', 'ACTIVE', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', NOW(), true, NOW())`,
        [randomUUID(), base.memberAId, subA, quotaPtB],
      ),
      (err) => err.code === '23503',
    );

    // Valid legacy purchase for A and valid standalone purchase for B
    const legacyPurchaseA = randomUUID();
    const standalonePurchaseB = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_package_purchases (
        id, member_id, origin, source_subscription_id, legacy_quota_id,
        package_code_snapshot, package_name_snapshot, session_count_snapshot, session_minutes_snapshot,
        allocated, reserved, used, agreed_price, currency, payment_status, status,
        original_start_date, original_end_date, cutover_at, cutover_eligible, updated_at
      ) VALUES ($1, $2, 'LEGACY_BUNDLED', $3, $4, 'LEGACY_PT', 'Legacy A', 5, 60, 5, 0, 0, NULL, NULL, 'PAID', 'ACTIVE', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', NOW(), true, NOW())`,
      [legacyPurchaseA, base.memberAId, subA, quotaPtA],
    );
    await pgClient.query(
      `INSERT INTO pt_package_purchases (
        id, member_id, origin, pt_plan_id,
        package_code_snapshot, package_name_snapshot, session_count_snapshot, session_minutes_snapshot,
        allocated, reserved, used, agreed_price, currency, payment_status, status, updated_at
      ) VALUES ($1, $2, 'STANDALONE', $3, 'PT5', 'Gói PT 5 buổi', 5, 60, 5, 0, 0, 2250000, 'VND', 'PAID', 'ACTIVE', NOW())`,
      [standalonePurchaseB, base.memberBId, planPt5Id],
    );

    // Booking cross-owner and booking cross-quota (including linking STANDALONE purchase to legacy quota) must fail FKs
    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, pt_purchase_id, starts_at, ends_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z', NOW())`,
        [
          randomUUID(),
          base.memberBId,
          base.trainerId,
          subB,
          quotaPtB,
          legacyPurchaseA,
        ],
      ),
      (err) => err.code === '23503',
    );
    await assert.rejects(
      pgClient.query(
        `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, pt_purchase_id, starts_at, ends_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z', NOW())`,
        [
          randomUUID(),
          base.memberBId,
          base.trainerId,
          subB,
          quotaPtB,
          standalonePurchaseB,
        ],
      ),
      (err) => err.code === '23503',
    );

    // QuotaTransaction cross-quota rejected
    await assert.rejects(
      pgClient.query(
        `INSERT INTO quota_transactions (id, quota_id, subscription_id, pt_purchase_id, type, reserved_delta, idempotency_key)
         VALUES ($1, $2, $3, $4, 'RESERVE', 1, 'bad-cross-tx')`,
        [randomUUID(), quotaPtB, subB, legacyPurchaseA],
      ),
      (err) => err.code === '23503',
    );

    // PaymentRecord XOR rejected when both subscription_id and pt_purchase_id are non-null
    await assert.rejects(
      pgClient.query(
        `INSERT INTO payment_records (id, subscription_id, pt_purchase_id, amount, currency, status, method)
         VALUES ($1, $2, $3, 2250000, 'VND', 'PAID', 'CASH')`,
        [randomUUID(), subB, standalonePurchaseB],
      ),
      /payment_records_single_target_xor/,
    );
  },
);

test(
  'One open standalone purchase enforced across pending-payment concurrency and reserved>0 while coexisting with legacy',
  { timeout: 60000 },
  async (t) => {
    const { pgClient, prisma } = await createIsolatedDb(t, 'b3b_open');
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const planPt5Id = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_package_plans (id, code, name, session_count, session_minutes, price, is_active, updated_at)
       VALUES ($1, 'PT5', 'Gói PT 5 buổi', 5, 60, 2250000, true, NOW())`,
      [planPt5Id],
    );

    // Two legacy PT subscriptions can coexist as LEGACY_BUNDLED ACTIVE purchases alongside standalone
    const sub1 = randomUUID();
    const sub2 = randomUUID();
    const q1 = randomUUID();
    const q2 = randomUUID();
    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, updated_at) VALUES
        ($1, $2, $3, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'ACTIVE', 'PAID', 1490000, NOW()),
        ($4, $2, $3, '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'UPCOMING', 'PAID', 1490000, NOW())`,
      [sub1, base.memberAId, base.legacyPlanId, sub2],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at) VALUES
        ($1, $2, $3, 4, 0, 1, NOW()),
        ($4, $5, $3, 6, 0, 0, NOW())`,
      [q1, sub1, base.ptServiceId, q2, sub2],
    );
    await prisma.ptPackagePurchase.createMany({
      data: [
        {
          memberId: base.memberAId,
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          sourceSubscriptionId: sub1,
          legacyQuotaId: q1,
          packageCodeSnapshot: 'LEGACY_PT',
          packageNameSnapshot: 'Legacy 1',
          sessionCountSnapshot: 4,
          sessionMinutesSnapshot: 60,
          allocated: 4,
          reserved: 0,
          used: 1,
          agreedPrice: null,
          currency: null,
          paymentStatus: PaymentStatus.PAID,
          status: PtPurchaseStatus.ACTIVE,
          originalStartDate: new Date('2026-11-01T00:00:00Z'),
          originalEndDate: new Date('2026-12-01T00:00:00Z'),
          cutoverAt: new Date('2026-11-16T12:00:00Z'),
          cutoverEligible: true,
        },
        {
          memberId: base.memberAId,
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          sourceSubscriptionId: sub2,
          legacyQuotaId: q2,
          packageCodeSnapshot: 'LEGACY_PT',
          packageNameSnapshot: 'Legacy 2',
          sessionCountSnapshot: 6,
          sessionMinutesSnapshot: 60,
          allocated: 6,
          reserved: 0,
          used: 0,
          agreedPrice: null,
          currency: null,
          paymentStatus: PaymentStatus.PAID,
          status: PtPurchaseStatus.ACTIVE,
          originalStartDate: new Date('2026-12-01T00:00:00Z'),
          originalEndDate: new Date('2027-01-01T00:00:00Z'),
          cutoverAt: new Date('2026-11-16T12:00:00Z'),
          cutoverEligible: true,
        },
      ],
    });

    // Concurrent pending-payment standalone purchases: at most one succeeds
    const createPendingStandalone = () =>
      prisma.ptPackagePurchase.create({
        data: {
          memberId: base.memberAId,
          origin: PtPurchaseOrigin.STANDALONE,
          ptPlanId: planPt5Id,
          packageCodeSnapshot: 'PT5',
          packageNameSnapshot: 'Gói PT 5 buổi',
          sessionCountSnapshot: 5,
          sessionMinutesSnapshot: 60,
          allocated: 5,
          reserved: 0,
          used: 0,
          agreedPrice: 2250000,
          currency: 'VND',
          paymentStatus: PaymentStatus.PENDING,
          status: PtPurchaseStatus.PENDING_PAYMENT,
        },
      });

    const raceResults = await Promise.allSettled([
      createPendingStandalone(),
      createPendingStandalone(),
    ]);
    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, 'P2002');

    const openPurchase = fulfilled[0].value;

    // Transition to ACTIVE with used=4, reserved=1 -> must stay open (ACTIVE) and still block a new standalone purchase
    await prisma.ptPackagePurchase.update({
      where: { id: openPurchase.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        status: PtPurchaseStatus.ACTIVE,
        used: 4,
        reserved: 1,
      },
    });
    await assert.rejects(
      createPendingStandalone(),
      (err) => err.code === 'P2002',
    );

    // Once the last reserved session settles to used=5, reserved=0, EXHAUSTED, a new standalone purchase is allowed
    await prisma.ptPackagePurchase.update({
      where: { id: openPurchase.id },
      data: {
        reserved: 0,
        used: 5,
        status: PtPurchaseStatus.EXHAUSTED,
      },
    });
    const nextStandalone = await createPendingStandalone();
    assert.equal(nextStandalone.status, PtPurchaseStatus.PENDING_PAYMENT);
  },
);

test(
  'Explicit catalog initializer creates PT1/5/10/20 idempotently and purchase snapshots remain immutable',
  { timeout: 60000 },
  async (t) => {
    const { pgClient, prisma, catalogInitializer } = await createIsolatedDb(
      t,
      'b3b_cat',
    );
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const preview = await catalogInitializer.initializeDefaultPlans({
      dryRun: true,
    });
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.createdCodes, ['PT1', 'PT5', 'PT10', 'PT20']);
    assert.equal(preview.plans.length, 0);

    const created = await catalogInitializer.initializeDefaultPlans({
      dryRun: false,
      actorId: base.adminUserId,
    });
    assert.equal(created.dryRun, false);
    assert.deepEqual(created.createdCodes, ['PT1', 'PT5', 'PT10', 'PT20']);
    assert.deepEqual(
      created.plans.map((p) => ({
        code: p.code,
        sessionCount: p.sessionCount,
        sessionMinutes: p.sessionMinutes,
        price: p.price,
      })),
      DEFAULT_PT_PACKAGE_PLANS.map((p) => ({
        code: p.code,
        sessionCount: p.sessionCount,
        sessionMinutes: p.sessionMinutes,
        price: p.price,
      })),
    );

    // Edit PT5 catalog entry and purchase a snapshot
    const pt5Plan = created.plans.find((p) => p.code === 'PT5');
    await prisma.ptPackagePlan.update({
      where: { id: pt5Plan.id },
      data: { name: 'PT5 Nâng cao', price: 2500000 },
    });

    const purchase = await prisma.ptPackagePurchase.create({
      data: {
        memberId: base.memberAId,
        origin: PtPurchaseOrigin.STANDALONE,
        ptPlanId: pt5Plan.id,
        packageCodeSnapshot: 'PT5',
        packageNameSnapshot: 'PT5 Nâng cao',
        sessionCountSnapshot: 5,
        sessionMinutesSnapshot: 60,
        allocated: 5,
        reserved: 0,
        used: 0,
        agreedPrice: 2500000,
        currency: 'VND',
        paymentStatus: PaymentStatus.PAID,
        status: PtPurchaseStatus.ACTIVE,
      },
    });

    // Re-running initializer preserves admin edits; subsequent catalog edits do not mutate existing purchase snapshots
    const replay = await catalogInitializer.initializeDefaultPlans({
      dryRun: false,
      actorId: base.adminUserId,
    });
    assert.deepEqual(replay.createdCodes, []);
    assert.deepEqual(replay.existingCodes, ['PT1', 'PT5', 'PT10', 'PT20']);
    const pt5AfterReplay = replay.plans.find((p) => p.code === 'PT5');
    assert.equal(pt5AfterReplay.name, 'PT5 Nâng cao');
    assert.equal(pt5AfterReplay.price, 2500000);

    await prisma.ptPackagePlan.update({
      where: { id: pt5Plan.id },
      data: { name: 'PT5 Đổi giá mới', price: 3000000, sessionCount: 6 },
    });
    const persistedPurchase = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { id: purchase.id },
    });
    assert.equal(persistedPurchase.packageNameSnapshot, 'PT5 Nâng cao');
    assert.equal(persistedPurchase.sessionCountSnapshot, 5);
    assert.equal(persistedPurchase.sessionMinutesSnapshot, 60);
    assert.equal(Number(persistedPurchase.agreedPrice), 2500000);
  },
);

test(
  'Controlled legacy conversion handles full state matrix, checkpoint guard, idempotency, concurrency & rollback',
  { timeout: 60000 },
  async (t) => {
    const { pgClient, prisma, conversionService } = await createIsolatedDb(
      t,
      'b3b_conv',
    );
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const cutoverAt = '2026-11-16T12:00:00.000Z';

    // Helper to create distinct member + subscription + PT quota
    const createSubWithPtQuota = async (spec) => {
      let memberId = spec.memberId;
      if (!memberId) {
        const userId = randomUUID();
        memberId = randomUUID();
        await pgClient.query(
          `INSERT INTO users (id, email, password_hash, is_active, updated_at) VALUES ($1, $2, 'hash', true, NOW())`,
          [userId, `${spec.key}@gym.local`],
        );
        await pgClient.query(
          `INSERT INTO member_profiles (id, user_id, full_name, updated_at) VALUES ($1, $2, $3, NOW())`,
          [memberId, userId, `Member ${spec.key}`],
        );
      }
      const subId = randomUUID();
      const quotaId = randomUUID();
      await pgClient.query(
        `INSERT INTO subscriptions (
          id, member_id, plan_id, previous_subscription_id, start_date, end_date,
          status, payment_status, agreed_price, cancelled_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          subId,
          memberId,
          base.legacyPlanId,
          spec.previousSubscriptionId ?? null,
          spec.startDate,
          spec.endDate,
          spec.subStatus,
          spec.payStatus,
          spec.price ?? 1490000,
          spec.subStatus === 'CANCELLED' ? '2026-11-10T00:00:00Z' : null,
          spec.createdAt ?? '2026-11-01T00:00:00Z',
        ],
      );
      await pgClient.query(
        `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          quotaId,
          subId,
          base.ptServiceId,
          spec.allocated,
          spec.reserved,
          spec.used,
        ],
      );
      if (spec.paymentMethod) {
        await pgClient.query(
          `INSERT INTO payment_records (id, subscription_id, amount, currency, status, method, note, confirmed_by, confirmed_at)
           VALUES ($1, $2, $3, 'VND', $4, $5, $6, $7, '2026-11-01T00:00:00Z')`,
          [
            randomUUID(),
            subId,
            spec.price ?? 1490000,
            spec.payStatus === 'REFUNDED'
              ? 'REFUNDED'
              : spec.payStatus === 'PENDING'
                ? 'PENDING'
                : spec.payStatus === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'PAID',
            spec.paymentMethod,
            `REC-20261101-${spec.key}`,
            spec.payStatus === 'PAID' ? base.adminUserId : null,
          ],
        );
      }
      return { memberId, subId, quotaId };
    };

    // 1. Finite ACTIVE opening balance without ledger/bookings
    const s1 = await createSubWithPtQuota({
      key: '0001',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-25T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 10,
      reserved: 0,
      used: 4,
      paymentMethod: 'CARD',
    });

    // 2. Finite ACTIVE with real 45m BOOKED & 90m COMPLETED bookings + ledger entries
    const s2 = await createSubWithPtQuota({
      key: '0002',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-15T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 8,
      reserved: 1,
      used: 2,
      paymentMethod: 'CASH',
    });
    const b2Booked = randomUUID();
    const b2Done = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, starts_at, ends_at, status, attendance, updated_at) VALUES
        ($1, $2, $3, $4, $5, '2026-11-18T09:00:00Z', '2026-11-18T09:45:00Z', 'BOOKED', 'PENDING', NOW()),
        ($6, $2, $3, $4, $5, '2026-11-05T14:00:00Z', '2026-11-05T15:30:00Z', 'COMPLETED', 'PRESENT', NOW())`,
      [b2Booked, s2.memberId, base.trainerId, s2.subId, s2.quotaId, b2Done],
    );
    await pgClient.query(
      `INSERT INTO quota_transactions (id, quota_id, subscription_id, type, reserved_delta, used_delta, idempotency_key, reference_type, reference_id) VALUES
        ($1, $2, $3, 'RESERVE', 1, 0, 'legacy-res-b2', 'PT_BOOKING', $4),
        ($5, $2, $3, 'USE', -1, 1, 'legacy-use-b2', 'PT_BOOKING', $6)`,
      [randomUUID(), s2.quotaId, s2.subId, b2Booked, randomUUID(), b2Done],
    );

    // 3. Admin ADJUST ledger record (+4 -> allocated 12)
    const s3 = await createSubWithPtQuota({
      key: '0003',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-15T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 12,
      reserved: 0,
      used: 1,
      paymentMethod: 'TRANSFER',
    });
    await pgClient.query(
      `INSERT INTO quota_transactions (id, quota_id, subscription_id, type, allocated_delta, idempotency_key, reason, created_by)
       VALUES ($1, $2, $3, 'ADJUST', 4, 'legacy-adj-s3', 'Bù buổi', $4)`,
      [randomUUID(), s3.quotaId, s3.subId, base.adminUserId],
    );

    // 4. Finite remaining=0 but reserved=1 -> must be ACTIVE, NOT EXHAUSTED
    const s4 = await createSubWithPtQuota({
      key: '0004',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-15T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 3,
      reserved: 1,
      used: 2,
      paymentMethod: 'TRANSFER',
    });
    await pgClient.query(
      `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, starts_at, ends_at, status, attendance, updated_at)
       VALUES ($1, $2, $3, $4, $5, '2026-11-19T09:00:00Z', '2026-11-19T10:00:00Z', 'BOOKED', 'PENDING', NOW())`,
      [randomUUID(), s4.memberId, base.trainerId, s4.subId, s4.quotaId],
    );

    // 5. Finite fully used (reserved=0) -> EXHAUSTED (cutoverEligible=true)
    const s5 = await createSubWithPtQuota({
      key: '0005',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-15T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 2,
      reserved: 0,
      used: 2,
    });

    // 6. Unlimited (allocated=NULL) live at cutover
    const s6 = await createSubWithPtQuota({
      key: '0006',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-01T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: null,
      reserved: 0,
      used: 5,
    });

    // 7. Zero allocation -> historical EXHAUSTED
    const s7 = await createSubWithPtQuota({
      key: '0007',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-01T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 0,
      reserved: 0,
      used: 0,
    });

    // 8. SUSPENDED frozen (even with pre-extension endDate < cutover) -> stays ACTIVE & eligible
    const s8 = await createSubWithPtQuota({
      key: '0008',
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      subStatus: 'SUSPENDED',
      payStatus: 'PAID',
      allocated: 8,
      reserved: 0,
      used: 2,
    });

    // 9. Multi-subscription same member (ACTIVE + UPCOMING PAID)
    const s9a = await createSubWithPtQuota({
      key: '0009a',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-01T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 5,
      reserved: 0,
      used: 1,
    });
    const s9b = await createSubWithPtQuota({
      key: '0009b',
      memberId: s9a.memberId,
      previousSubscriptionId: s9a.subId,
      startDate: '2026-12-01T00:00:00Z',
      endDate: '2027-01-01T00:00:00Z',
      subStatus: 'UPCOMING',
      payStatus: 'PAID',
      allocated: 6,
      reserved: 0,
      used: 0,
    });

    // 10. PENDING payment UPCOMING -> PENDING_PAYMENT
    const s10 = await createSubWithPtQuota({
      key: '0010',
      startDate: '2026-12-01T00:00:00Z',
      endDate: '2027-01-01T00:00:00Z',
      subStatus: 'UPCOMING',
      payStatus: 'PENDING',
      allocated: 6,
      reserved: 0,
      used: 0,
      paymentMethod: 'TRANSFER',
    });

    // 11. Expired before cutover -> historical EXPIRED
    const s11 = await createSubWithPtQuota({
      key: '0011',
      startDate: '2026-09-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 5,
      reserved: 0,
      used: 1,
    });

    // 12. Cancelled before cutover -> historical CANCELLED
    const s12 = await createSubWithPtQuota({
      key: '0012',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-01T00:00:00Z',
      subStatus: 'CANCELLED',
      payStatus: 'CANCELLED',
      allocated: 5,
      reserved: 0,
      used: 1,
      paymentMethod: 'CASH',
    });

    // 13. Refunded before cutover -> historical REFUNDED
    const s13 = await createSubWithPtQuota({
      key: '0013',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-12-01T00:00:00Z',
      subStatus: 'CANCELLED',
      payStatus: 'REFUNDED',
      allocated: 5,
      reserved: 0,
      used: 0,
      paymentMethod: 'CASH',
    });

    // 14. Orphan reserved=1 with 0 bookings & 0 ledger
    const s14 = await createSubWithPtQuota({
      key: '0014',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2027-11-01T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 24,
      reserved: 1,
      used: 3,
      paymentMethod: 'CARD',
      price: 4500000,
    });

    // Guardrail assertions
    await assert.rejects(
      conversionService.runLegacyConversion({}),
      /cutoverAt is required/,
    );
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: false,
      }),
      /confirmRuntimeCutoverReady=true/,
    );

    // Dry-run reads everything without writing anything
    const dryRun = await conversionService.runLegacyConversion({
      cutoverAt,
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.totalLegacyQuotas, 15);
    assert.equal(dryRun.createdPurchasesCount, 0);
    assert.equal(dryRun.orphanReservationCandidates.length, 1);
    assert.equal(dryRun.orphanReservationCandidates[0].quotaId, s14.quotaId);
    assert.equal(dryRun.orphanReservationCandidates[0].confirmedOrphanCount, 1);
    assert.ok(
      dryRun.historicalLedgerGaps.some((g) => g.quotaId === s1.quotaId),
    );
    assert.deepEqual(dryRun.paymentTotalsBefore, dryRun.paymentTotalsAfter);
    assert.equal(await prisma.ptPackagePurchase.count(), 0);

    // Injected failure rolls back 100% of writes atomically
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
        actorId: base.adminUserId,
        injectFailureBeforeCommit: true,
      }),
      /INJECTED_CONVERSION_ROLLBACK_FAILURE/,
    );
    assert.equal(await prisma.ptPackagePurchase.count(), 0);
    assert.equal(
      await prisma.ptBooking.count({ where: { ptPurchaseId: { not: null } } }),
      0,
    );

    // Execute controlled conversion
    const executed = await conversionService.runLegacyConversion({
      cutoverAt,
      dryRun: false,
      confirmRuntimeCutoverReady: true,
      actorId: base.adminUserId,
    });
    assert.equal(executed.dryRun, false);
    assert.equal(executed.idempotentNoOp, false);
    assert.equal(executed.createdPurchasesCount, 15);
    assert.equal(executed.linkedBookingsCount, 3);
    assert.equal(executed.linkedTransactionsCount, 3);
    assert.deepEqual(executed.paymentTotalsBefore, executed.paymentTotalsAfter);
    assert.equal(executed.paymentTotalsAfter.paidByMethod.CARD, 5990000);

    const rowByQuota = new Map(executed.rows.map((r) => [r.quotaId, r]));
    assert.equal(rowByQuota.get(s1.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s1.quotaId).used, 4);
    assert.equal(rowByQuota.get(s2.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s3.quotaId).allocated, 12);
    assert.equal(rowByQuota.get(s4.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s5.quotaId).status, PtPurchaseStatus.EXHAUSTED);
    assert.equal(rowByQuota.get(s6.quotaId).unlimited, true);
    assert.equal(rowByQuota.get(s6.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s7.quotaId).cutoverEligible, false);
    assert.equal(rowByQuota.get(s7.quotaId).status, PtPurchaseStatus.EXHAUSTED);
    assert.equal(rowByQuota.get(s8.quotaId).cutoverEligible, true);
    assert.equal(rowByQuota.get(s8.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s9a.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(rowByQuota.get(s9b.quotaId).status, PtPurchaseStatus.ACTIVE);
    assert.equal(
      rowByQuota.get(s10.quotaId).status,
      PtPurchaseStatus.PENDING_PAYMENT,
    );
    assert.equal(rowByQuota.get(s11.quotaId).cutoverEligible, false);
    assert.equal(rowByQuota.get(s11.quotaId).status, PtPurchaseStatus.EXPIRED);
    assert.equal(
      rowByQuota.get(s12.quotaId).status,
      PtPurchaseStatus.CANCELLED,
    );
    assert.equal(rowByQuota.get(s13.quotaId).status, PtPurchaseStatus.REFUNDED);
    // Orphan reserved=1 preserved verbatim during conversion (never silently dropped)
    assert.equal(rowByQuota.get(s14.quotaId).reserved, 1);
    assert.equal(rowByQuota.get(s14.quotaId).used, 3);

    // Verify finite survival vs unlimited expiry after Gym endDate passes
    const p1 = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s1.quotaId },
    });
    const p6 = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s6.quotaId },
    });
    const postExpiryNow = new Date('2026-12-30T00:00:00.000Z');
    assert.equal(
      effectivePtPurchaseStatus(
        {
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          storedStatus: p1.status,
          paymentStatus: p1.paymentStatus,
          allocated: p1.allocated,
          reserved: p1.reserved,
          used: p1.used,
          cutoverEligible: p1.cutoverEligible,
        },
        {
          status: SubscriptionStatus.ACTIVE,
          paymentStatus: PaymentStatus.PAID,
          endDate: p1.originalEndDate,
        },
        postExpiryNow,
      ),
      PtPurchaseStatus.ACTIVE,
    );
    assert.equal(
      effectivePtPurchaseStatus(
        {
          origin: PtPurchaseOrigin.LEGACY_BUNDLED,
          storedStatus: p6.status,
          paymentStatus: p6.paymentStatus,
          allocated: p6.allocated,
          reserved: p6.reserved,
          used: p6.used,
          cutoverEligible: p6.cutoverEligible,
        },
        {
          status: SubscriptionStatus.ACTIVE,
          paymentStatus: PaymentStatus.PAID,
          endDate: p6.originalEndDate,
        },
        postExpiryNow,
      ),
      PtPurchaseStatus.EXPIRED,
    );

    // Verify combined policy evaluation (Gym coverage + credit selection) on converted s9a + s9b
    const p9a = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s9a.quotaId },
    });
    const p9b = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s9b.quotaId },
    });
    const sub9aRow = await prisma.subscription.findUniqueOrThrow({
      where: { id: s9a.subId },
    });
    const sub9bRow = await prisma.subscription.findUniqueOrThrow({
      where: { id: s9b.subId },
    });
    // Booking before upcoming period (in Nov): only p9a is usable
    const novGym = evaluateGymCoverageForSlot(
      [
        {
          id: sub9aRow.id,
          memberId: sub9aRow.memberId,
          status: sub9aRow.status,
          paymentStatus: sub9aRow.paymentStatus,
          startDate: sub9aRow.startDate,
          endDate: sub9aRow.endDate,
        },
        {
          id: sub9bRow.id,
          memberId: sub9bRow.memberId,
          status: sub9bRow.status,
          paymentStatus: sub9bRow.paymentStatus,
          startDate: sub9bRow.startDate,
          endDate: sub9bRow.endDate,
        },
      ],
      '2026-12-10T09:00:00Z',
      '2026-12-10T10:00:00Z',
      { referenceNow: cutoverAt },
    );
    assert.equal(novGym.covered, true);
    assert.equal(novGym.coveringSubscriptionId, sub9bRow.id);
    const earlySlotCredits = selectPtCreditSourceForSlot(
      [
        {
          id: p9b.id,
          memberId: p9b.memberId,
          origin: p9b.origin,
          storedStatus: p9b.status,
          paymentStatus: p9b.paymentStatus,
          allocated: p9b.allocated,
          reserved: p9b.reserved,
          used: p9b.used,
          cutoverEligible: p9b.cutoverEligible,
          createdAt: p9b.createdAt,
          sourceSubscription: {
            id: sub9bRow.id,
            memberId: sub9bRow.memberId,
            status: sub9bRow.status,
            paymentStatus: sub9bRow.paymentStatus,
            startDate: sub9bRow.startDate,
            endDate: sub9bRow.endDate,
          },
        },
        {
          id: p9a.id,
          memberId: p9a.memberId,
          origin: p9a.origin,
          storedStatus: p9a.status,
          paymentStatus: p9a.paymentStatus,
          allocated: p9a.allocated,
          reserved: p9a.reserved,
          used: p9a.used,
          cutoverEligible: p9a.cutoverEligible,
          createdAt: p9a.createdAt,
          sourceSubscription: {
            id: sub9aRow.id,
            memberId: sub9aRow.memberId,
            status: sub9aRow.status,
            paymentStatus: sub9aRow.paymentStatus,
            startDate: sub9aRow.startDate,
            endDate: sub9aRow.endDate,
          },
        },
      ],
      '2026-11-20T09:00:00Z',
      '2026-11-20T10:00:00Z',
      { referenceNow: cutoverAt },
    );
    assert.deepEqual(earlySlotCredits.eligiblePurchaseIds, [p9a.id]);

    // Checkpoint mismatch rejected; same checkpoint retry & concurrency are 100% idempotent
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt: '2026-12-30T00:00:00.000Z',
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /CUTOVER_CHECKPOINT_MISMATCH/,
    );

    const concurrentRetries = await Promise.all([
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
    ]);
    for (const replay of concurrentRetries) {
      assert.equal(replay.idempotentNoOp, true);
      assert.equal(replay.createdPurchasesCount, 0);
      assert.equal(replay.syncedPurchasesCount, 0);
      assert.equal(replay.unchangedPurchasesCount, 15);
    }

    // Finding #4: retry preserves cutoverEligible & grandfathered finite rights, verifies real payment for pending activation, syncs cancellations, detects balance drift, and rejects post-cutover source rows
    // 1) Flipping s10 subscription payment_status=PAID without a confirmed PAID PaymentRecord must fail
    await pgClient.query(
      `UPDATE subscriptions SET payment_status = 'PAID', updated_at = NOW() WHERE id = $1`,
      [s10.subId],
    );
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /UNVERIFIED_SUBSCRIPTION_PAYMENT/,
    );
    const s10BeforeRealPay = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s10.quotaId },
    });
    assert.equal(s10BeforeRealPay.status, PtPurchaseStatus.PENDING_PAYMENT);

    // 2) Confirming real PaymentRecord allows immediate effective status resolution AND conversion retry sync
    await pgClient.query(
      `UPDATE payment_records SET status = 'PAID', confirmed_by = $1, confirmed_at = NOW() WHERE subscription_id = $2`,
      [base.adminUserId, s10.subId],
    );
    const s10SubRow = await prisma.subscription.findUniqueOrThrow({
      where: { id: s10.subId },
    });
    assert.equal(
      effectivePtPurchaseStatus(
        {
          origin: s10BeforeRealPay.origin,
          storedStatus: s10BeforeRealPay.status,
          paymentStatus: s10BeforeRealPay.paymentStatus,
          allocated: s10BeforeRealPay.allocated,
          reserved: s10BeforeRealPay.reserved,
          used: s10BeforeRealPay.used,
          cutoverEligible: s10BeforeRealPay.cutoverEligible,
        },
        {
          status: s10SubRow.status,
          paymentStatus: s10SubRow.paymentStatus,
          endDate: s10SubRow.endDate,
          agreedPrice: Number(s10SubRow.agreedPrice),
          confirmedPaidAmount: Number(s10SubRow.agreedPrice),
        },
        new Date('2026-12-05T08:00:00.000Z'),
      ),
      PtPurchaseStatus.ACTIVE,
    );

    const syncPendingRetry = await conversionService.runLegacyConversion({
      cutoverAt,
      dryRun: false,
      confirmRuntimeCutoverReady: true,
      actorId: base.adminUserId,
    });
    assert.equal(syncPendingRetry.syncedPurchasesCount, 1);
    assert.equal(
      syncPendingRetry.rows.find((r) => r.quotaId === s10.quotaId).action,
      'SYNCED_STATUS',
    );
    const s10AfterSync = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s10.quotaId },
    });
    assert.equal(s10AfterSync.status, PtPurchaseStatus.ACTIVE);
    assert.equal(s10AfterSync.paymentStatus, PaymentStatus.PAID);
    assert.equal(s10AfterSync.cutoverEligible, true);

    // 3) Post-cutover cancellation of s3 syncs purchase to CANCELLED while keeping cutoverEligible=true & cutoverAt intact
    await pgClient.query(
      `UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [s3.subId],
    );
    const syncCancelRetry = await conversionService.runLegacyConversion({
      cutoverAt,
      dryRun: false,
      confirmRuntimeCutoverReady: true,
      actorId: base.adminUserId,
    });
    assert.equal(syncCancelRetry.syncedPurchasesCount, 1);
    const s3AfterCancel = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: s3.quotaId },
    });
    assert.equal(s3AfterCancel.status, PtPurchaseStatus.CANCELLED);
    assert.equal(s3AfterCancel.cutoverEligible, true);
    assert.equal(s3AfterCancel.cutoverAt.toISOString(), cutoverAt);

    // 4) Out-of-band balance drift on s5 is rejected rather than silently overwritten
    await pgClient.query(
      `UPDATE subscription_quotas SET used = 1, updated_at = NOW() WHERE id = $1`,
      [s5.quotaId],
    );
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /LEGACY_PURCHASE_DRIFT_DETECTED/,
    );
    await pgClient.query(
      `UPDATE subscription_quotas SET used = 2, updated_at = NOW() WHERE id = $1`,
      [s5.quotaId],
    );

    // 5) Newly discovered post-cutover source quota cannot be classified under the old checkpoint
    const postCutoverSub = await createSubWithPtQuota({
      key: 'post-cutover',
      createdAt: '2026-11-20T00:00:00Z',
      startDate: '2026-11-20T00:00:00Z',
      endDate: '2026-12-20T00:00:00Z',
      subStatus: 'ACTIVE',
      payStatus: 'PAID',
      allocated: 5,
      reserved: 0,
      used: 0,
    });
    assert.ok(postCutoverSub.quotaId);
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /POST_CUTOVER_LEGACY_SOURCE_DETECTED/,
    );
    assert.equal(
      await prisma.ptPackagePurchase.count({
        where: { legacyQuotaId: postCutoverSub.quotaId },
      }),
      0,
    );

    // Even if a missing quota later appears with a pre-cutover created_at after checkpoint materialization, reject it cleanly
    await pgClient.query(
      `UPDATE subscriptions SET created_at = '2026-11-10T00:00:00Z' WHERE id = $1`,
      [postCutoverSub.subId],
    );
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt,
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /POST_CUTOVER_UNCONVERTED_QUOTA_DETECTED/,
    );
    assert.equal(
      await prisma.ptPackagePurchase.count({
        where: { legacyQuotaId: postCutoverSub.quotaId },
      }),
      0,
    );
  },
);

test(
  'Conversion rejects unmatched source records and post-cutover initial runs without assigning the wrong member',
  { timeout: 60000 },
  async (t) => {
    const { pgClient, prisma, conversionService } = await createIsolatedDb(
      t,
      'b3b_badsrc',
    );
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const subId = randomUUID();
    const classQuotaId = randomUUID();
    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, created_at, updated_at)
       VALUES ($1, $2, $3, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-11-01T00:00:00Z', NOW())`,
      [subId, base.memberAId, base.legacyPlanId],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at)
       VALUES ($1, $2, $3, 10, 1, 0, NOW())`,
      [classQuotaId, subId, base.classServiceId],
    );
    // Corrupt PtBooking pointing to a CLASS quota
    const corruptBookingId = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, starts_at, ends_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z', NOW())`,
      [corruptBookingId, base.memberAId, base.trainerId, subId, classQuotaId],
    );

    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt: '2026-11-16T12:00:00Z',
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /UNMATCHED_PT_BOOKING_SOURCE/,
    );
    assert.equal(await prisma.ptPackagePurchase.count(), 0);

    // Post-cutover subscription on an unconverted DB cannot be classified under a backdated checkpoint
    await pgClient.query(`DELETE FROM pt_bookings WHERE id = $1`, [
      corruptBookingId,
    ]);
    const postSubId = randomUUID();
    const postPtQuotaId = randomUUID();
    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, created_at, updated_at)
       VALUES ($1, $2, $3, '2026-11-20T00:00:00Z', '2026-12-20T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-11-20T00:00:00Z', NOW())`,
      [postSubId, base.memberBId, base.legacyPlanId],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at)
       VALUES ($1, $2, $3, 5, 0, 0, NOW())`,
      [postPtQuotaId, postSubId, base.ptServiceId],
    );
    await assert.rejects(
      conversionService.runLegacyConversion({
        cutoverAt: '2026-11-16T12:00:00Z',
        dryRun: false,
        confirmRuntimeCutoverReady: true,
      }),
      /POST_CUTOVER_LEGACY_SOURCE_DETECTED/,
    );
    assert.equal(await prisma.ptPackagePurchase.count(), 0);
  },
);

test(
  'Confirmed orphan reservation reconciliation protects real BOOKED appointments, rolls back failures, and binds replay to original payload/snapshot',
  { timeout: 60000 },
  async (t) => {
    const { pgClient, prisma, conversionService } = await createIsolatedDb(
      t,
      'b3b_orphan',
    );
    await applyAllMigrations(pgClient);
    const base = await seedBaseActorsAndServices(pgClient);

    const subReal = randomUUID();
    const qReal = randomUUID();
    const subPartial = randomUUID();
    const qPartial = randomUUID();
    const subPureOrphan = randomUUID();
    const qPureOrphan = randomUUID();

    await pgClient.query(
      `INSERT INTO subscriptions (id, member_id, plan_id, start_date, end_date, status, payment_status, agreed_price, created_at, updated_at) VALUES
        ($1, $2, $3, '2026-11-01T00:00:00Z', '2026-12-30T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-11-01T00:00:00Z', NOW()),
        ($4, $5, $3, '2026-11-01T00:00:00Z', '2026-12-30T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-11-01T00:00:00Z', NOW()),
        ($6, $2, $3, '2026-11-01T00:00:00Z', '2026-12-30T00:00:00Z', 'ACTIVE', 'PAID', 1490000, '2026-11-01T00:00:00Z', NOW())`,
      [
        subReal,
        base.memberAId,
        base.legacyPlanId,
        subPartial,
        base.memberBId,
        subPureOrphan,
      ],
    );
    await pgClient.query(
      `INSERT INTO subscription_quotas (id, subscription_id, service_type_id, allocated, reserved, used, updated_at) VALUES
        ($1, $2, $3, 10, 1, 2, NOW()),
        ($4, $5, $3, 10, 2, 3, NOW()),
        ($6, $7, $3, 24, 1, 3, NOW())`,
      [
        qReal,
        subReal,
        base.ptServiceId,
        qPartial,
        subPartial,
        qPureOrphan,
        subPureOrphan,
      ],
    );

    const realBooking1 = randomUUID();
    const realBooking2 = randomUUID();
    await pgClient.query(
      `INSERT INTO pt_bookings (id, member_id, trainer_id, subscription_id, quota_id, starts_at, ends_at, status, attendance, updated_at) VALUES
        ($1, $2, $3, $4, $5, '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z', 'BOOKED', 'PENDING', NOW()),
        ($6, $7, $3, $8, $9, '2026-11-21T09:00:00Z', '2026-11-21T10:00:00Z', 'BOOKED', 'PENDING', NOW())`,
      [
        realBooking1,
        base.memberAId,
        base.trainerId,
        subReal,
        qReal,
        realBooking2,
        base.memberBId,
        subPartial,
        qPartial,
      ],
    );

    // Run conversion first so mirrored purchases exist and we prove both quota + purchase update atomically
    await conversionService.runLegacyConversion({
      cutoverAt: '2026-11-16T12:00:00Z',
      dryRun: false,
      confirmRuntimeCutoverReady: true,
      actorId: base.adminUserId,
    });

    const diagnostics = await conversionService.inspectOrphanReservations();
    const sortByQuota = (left, right) =>
      left.quotaId.localeCompare(right.quotaId);
    assert.deepEqual(
      diagnostics
        .map((d) => ({
          quotaId: d.quotaId,
          confirmedOrphanCount: d.confirmedOrphanCount,
          activeBookedCount: d.activeBookedCount,
        }))
        .sort(sortByQuota),
      [
        { quotaId: qPartial, confirmedOrphanCount: 1, activeBookedCount: 1 },
        { quotaId: qPureOrphan, confirmedOrphanCount: 1, activeBookedCount: 0 },
      ].sort(sortByQuota),
    );

    // Real reservation must never be released
    await assert.rejects(
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qReal,
        actorId: base.adminUserId,
        reason: 'Kiểm thử chống trả nhầm lịch thật',
      }),
      /backed by active BOOKED/,
    );

    // Wrong expectedReleaseCount is rejected
    await assert.rejects(
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qPartial,
        actorId: base.adminUserId,
        reason: 'Kiểm thử sai số lượng',
        expectedReleaseCount: 2,
      }),
      /does not match expectedReleaseCount/,
    );

    // Failed transaction rolls back quota, purchase, transaction ledger, and audit log completely
    await assert.rejects(
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qPartial,
        actorId: base.adminUserId,
        reason: 'Đối soát 1 lượt giữ treo (1 lịch thật còn hiệu lực)',
        expectedReleaseCount: 1,
        injectFailureBeforeCommit: true,
      }),
      /INJECTED_ORPHAN_RECONCILE_ROLLBACK_FAILURE/,
    );
    assert.equal(
      (
        await prisma.subscriptionQuota.findUniqueOrThrow({
          where: { id: qPartial },
        })
      ).reserved,
      2,
    );
    assert.equal(
      (
        await prisma.ptPackagePurchase.findUniqueOrThrow({
          where: { legacyQuotaId: qPartial },
        })
      ).reserved,
      2,
    );
    assert.equal(
      await prisma.quotaTransaction.count({
        where: {
          quotaId: qPartial,
          referenceType: 'ORPHAN_RESERVATION_RECONCILIATION',
        },
      }),
      0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: 'PT_ORPHAN_RESERVATION_RECONCILED',
          entityId: qPartial,
        },
      }),
      0,
    );

    // Partial excess releases ONLY 1 (reserved 2 -> 1), keeping real booking and used=3 intact
    const partialReason = 'Đối soát 1 lượt giữ treo (1 lịch thật còn hiệu lực)';
    const partialResult = await conversionService.reconcileOrphanReservedQuota({
      quotaId: qPartial,
      actorId: base.adminUserId,
      reason: partialReason,
      expectedReleaseCount: 1,
    });
    assert.equal(partialResult.idempotentReplay, false);
    assert.equal(partialResult.releasedCount, 1);
    assert.equal(partialResult.previousReserved, 2);
    assert.equal(partialResult.newReserved, 1);
    assert.equal(partialResult.activeBookedCount, 1);
    assert.equal(partialResult.preservedUsed, 3);
    assert.ok(partialResult.auditLogId);

    const partialQuotaAfter = await prisma.subscriptionQuota.findUniqueOrThrow({
      where: { id: qPartial },
    });
    const partialPurchaseAfter =
      await prisma.ptPackagePurchase.findUniqueOrThrow({
        where: { legacyQuotaId: qPartial },
      });
    assert.equal(partialQuotaAfter.reserved, 1);
    assert.equal(partialQuotaAfter.used, 3);
    assert.equal(partialPurchaseAfter.reserved, 1);
    assert.equal(partialPurchaseAfter.used, 3);
    assert.equal(partialPurchaseAfter.status, PtPurchaseStatus.ACTIVE);

    // Finding #5: simulate subsequent appointment completion (reserved 1->0, used 3->4) and prove replay returns original snapshot & rejects payload mismatches
    await pgClient.query(
      `UPDATE pt_bookings SET status = 'COMPLETED', attendance = 'PRESENT', attended_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [realBooking2],
    );
    await pgClient.query(
      `UPDATE subscription_quotas SET reserved = 0, used = 4, updated_at = NOW() WHERE id = $1`,
      [qPartial],
    );
    await pgClient.query(
      `UPDATE pt_package_purchases SET reserved = 0, used = 4, updated_at = NOW() WHERE legacy_quota_id = $1`,
      [qPartial],
    );

    const exactReplay = await conversionService.reconcileOrphanReservedQuota({
      quotaId: qPartial,
      actorId: base.adminUserId,
      reason: partialReason,
      expectedReleaseCount: 1,
    });
    assert.deepEqual(exactReplay, {
      ...partialResult,
      idempotentReplay: true,
    });
    assert.equal(
      (
        await prisma.subscriptionQuota.findUniqueOrThrow({
          where: { id: qPartial },
        })
      ).used,
      4,
    );

    for (const mismatchedOptions of [
      {
        quotaId: qPartial,
        actorId: base.adminUserId,
        reason: partialReason,
        expectedReleaseCount: 2,
      },
      {
        quotaId: qPartial,
        actorId: base.adminUserId,
        reason: partialReason,
      },
      {
        quotaId: qPartial,
        actorId: base.adminUserId,
        reason: 'Lý do khác sau khi chạy',
        expectedReleaseCount: 1,
      },
      {
        quotaId: qPartial,
        actorId: randomUUID(),
        reason: partialReason,
        expectedReleaseCount: 1,
      },
    ]) {
      await assert.rejects(
        conversionService.reconcileOrphanReservedQuota(mismatchedOptions),
        /IDEMPOTENCY_PAYLOAD_MISMATCH/,
      );
    }

    // Concurrent retries on pure orphan (reserved 1 -> 0) release strictly once
    const race = await Promise.all([
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qPureOrphan,
        actorId: base.adminUserId,
        reason: 'Trả 1 lượt treo không có lịch',
        expectedReleaseCount: 1,
      }),
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qPureOrphan,
        actorId: base.adminUserId,
        reason: 'Trả 1 lượt treo không có lịch',
        expectedReleaseCount: 1,
      }),
      conversionService.reconcileOrphanReservedQuota({
        quotaId: qPureOrphan,
        actorId: base.adminUserId,
        reason: 'Trả 1 lượt treo không có lịch',
        expectedReleaseCount: 1,
      }),
    ]);

    assert.equal(race.filter((r) => !r.idempotentReplay).length, 1);
    assert.equal(race.filter((r) => r.idempotentReplay).length, 2);

    const pureQuotaAfter = await prisma.subscriptionQuota.findUniqueOrThrow({
      where: { id: qPureOrphan },
    });
    const purePurchaseAfter = await prisma.ptPackagePurchase.findUniqueOrThrow({
      where: { legacyQuotaId: qPureOrphan },
    });
    assert.equal(pureQuotaAfter.reserved, 0);
    assert.equal(pureQuotaAfter.used, 3);
    assert.equal(purePurchaseAfter.reserved, 0);
    assert.equal(purePurchaseAfter.used, 3);

    const refundTxs = await prisma.quotaTransaction.findMany({
      where: {
        quotaId: qPureOrphan,
        referenceType: 'ORPHAN_RESERVATION_RECONCILIATION',
      },
    });
    assert.equal(refundTxs.length, 1);
    assert.equal(refundTxs[0].reservedDelta, -1);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: 'PT_ORPHAN_RESERVATION_RECONCILED',
        entityId: qPureOrphan,
      },
    });
    assert.equal(auditLogs.length, 1);

    const booking1After = await prisma.ptBooking.findUniqueOrThrow({
      where: { id: realBooking1 },
    });
    assert.equal(booking1After.status, 'BOOKED');

    // Re-running legacy conversion after orphan reconciliation with the same checkpoint remains 100% idempotent
    const retryAfterReconcile = await conversionService.runLegacyConversion({
      cutoverAt: '2026-11-16T12:00:00Z',
      dryRun: false,
      confirmRuntimeCutoverReady: true,
    });
    assert.equal(retryAfterReconcile.idempotentNoOp, true);
    assert.equal(retryAfterReconcile.syncedPurchasesCount, 0);
    assert.equal(retryAfterReconcile.orphanReservationCandidates.length, 0);
  },
);
