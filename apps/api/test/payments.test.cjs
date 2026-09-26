const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');

test('Payments & Billing Management Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const db = app.get(DatabaseService);
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

  // ========================================================
  // 1. Authenticate Actors
  // ========================================================
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

  // 2. Setup Test Member
  const memberEmail = `payment.member.${Date.now()}@gym.local`;
  const memberRes = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: memberEmail,
      password: 'Password@123456',
      fullName: 'Emma Billing Member',
      phone: `096${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(memberRes.status, 201);
  const memberProfile = await memberRes.json();

  const memberLogin = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: memberEmail,
      password: 'Password@123456',
    }),
  });
  assert.equal(memberLogin.status, 200);
  const memberToken = (await memberLogin.json()).tokens.accessToken;

  // 3. Setup Membership Plan
  const planRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Billing Test Plan ${Date.now()}`,
      durationDays: 30,
      price: 1200000,
      isActive: true,
      entitlements: [
        { service: 'GYM_ACCESS', limitType: 'UNLIMITED' },
      ],
    }),
  });
  assert.equal(planRes.status, 201);
  const plan = await planRes.json();

  let pendingSub = null;
  let initialPaymentId = null;

  // ========================================================
  // Test 1: Create subscription with PENDING payment
  // ========================================================
  await t.test('POST /api/subscriptions - Create subscription with PENDING payment', async () => {
    const res = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: memberProfile.id,
        planId: plan.id,
        paymentStatus: 'PENDING',
      }),
    });
    assert.equal(res.status, 201);
    pendingSub = await res.json();
    assert.equal(pendingSub.paymentStatus, 'PENDING');
    assert.equal(pendingSub.storedStatus, 'UPCOMING');
    assert.ok(pendingSub.payments.length >= 1);
    assert.equal(pendingSub.payments[0].status, 'PENDING');
    initialPaymentId = pendingSub.payments[0].id;
  });

  // ========================================================
  // Test 2: Staff records an additional payment on subscription
  // ========================================================
  let secondPaymentId = null;
  await t.test('POST /api/subscriptions/:id/payments - Staff adds payment record', async () => {
    const res = await request(`subscriptions/${pendingSub.id}/payments`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        amount: 500000,
        currency: 'VND',
        method: 'CASH',
        status: 'PENDING',
        note: 'Partial installment payment deposit',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.equal(data.amount, 500000);
    assert.equal(data.status, 'PENDING');
    secondPaymentId = data.id;
  });

  // ========================================================
  // Test 3: Confirm Payment (Marks PAID, records Cashier)
  // ========================================================
  await t.test('POST /api/payments/:id/confirm - Staff confirms payment & syncs subscription', async () => {
    const res = await request(`payments/${initialPaymentId}/confirm`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        method: 'TRANSFER',
        referenceCode: 'VCB20260923001',
        note: 'Member transferred via Vietcombank QR',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'PAID');
    assert.equal(data.method, 'TRANSFER');
    assert.ok(data.confirmedAt);
    assert.ok(data.confirmedBy);

    // Verify Subscription paymentStatus is synchronized to PAID
    const subRecord = await db.client.subscription.findUnique({
      where: { id: pendingSub.id },
    });
    assert.equal(subRecord.paymentStatus, 'PAID');
  });

  // ========================================================
  // Test 4: Prevent Duplicate Confirmation (409 Conflict)
  // ========================================================
  await t.test('POST /api/payments/:id/confirm - Reject duplicate confirmation on PAID payment', async () => {
    const res = await request(`payments/${initialPaymentId}/confirm`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        method: 'TRANSFER',
      }),
    });
    assert.equal(res.status, 409);
  });

  // ========================================================
  // Test 5: JIT Promotion on Payment Confirmation
  // ========================================================
  await t.test('POST /api/payments/:id/confirm - JIT auto-promotes eligible subscription to ACTIVE', async () => {
    // 1. Create a fresh member without prior subscriptions
    const jitEmail = `jit.member.${Date.now()}@gym.local`;
    const jitMemRes = await request('members', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        email: jitEmail,
        password: 'Password@123456',
        fullName: 'JIT Promotion Member',
        phone: `095${Math.floor(1000000 + Math.random() * 9000000)}`,
      }),
    });
    assert.equal(jitMemRes.status, 201);
    const jitMember = await jitMemRes.json();

    // 2. Create subscription starting today with PENDING payment
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const jitSubRes = await request('subscriptions', {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        memberId: jitMember.id,
        planId: plan.id,
        paymentStatus: 'PENDING',
        startDate: today.toISOString(),
      }),
    });
    assert.equal(jitSubRes.status, 201);
    const jitSub = await jitSubRes.json();
    assert.equal(jitSub.storedStatus, 'UPCOMING');

    const paymentToConfirm = jitSub.payments[0].id;

    // 2. Confirm payment
    const confirmRes = await request(`payments/${paymentToConfirm}/confirm`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        method: 'CARD',
        referenceCode: 'POS-AUTH-999',
      }),
    });
    assert.equal(confirmRes.status, 200);

    // 3. Subscription status should have automatically promoted to ACTIVE
    const updatedSub = await db.client.subscription.findUnique({
      where: { id: jitSub.id },
    });
    assert.equal(updatedSub.status, 'ACTIVE');
    assert.ok(updatedSub.activatedAt);
  });

  // ========================================================
  // Test 6: Digital Receipt Retrieval
  // ========================================================
  await t.test('GET /api/payments/:id/receipt - Retrieve formatted digital receipt', async () => {
    const res = await request(`payments/${initialPaymentId}/receipt`, {
      method: 'GET',
      token: memberToken,
    });
    assert.equal(res.status, 200);
    const receipt = await res.json();
    assert.ok(receipt.receiptNumber.startsWith('REC-'));
    assert.equal(receipt.status, undefined); // response conforms to PaymentReceipt
    assert.equal(receipt.currency, 'VND');
    assert.equal(receipt.method, 'TRANSFER');
    assert.ok(receipt.amount > 0);
    assert.ok(receipt.member.fullName);
    assert.ok(receipt.subscription.planName);
    assert.ok(receipt.cashier.fullName);
  });

  // ========================================================
  // Test 7: Security & RBAC Checks
  // ========================================================
  await t.test('POST /api/payments/:id/confirm - Member forbidden from self-confirming (403)', async () => {
    const res = await request(`payments/${secondPaymentId}/confirm`, {
      method: 'POST',
      token: memberToken,
      body: JSON.stringify({
        method: 'CASH',
      }),
    });
    assert.equal(res.status, 403);
  });

  await t.test('POST /api/payments/:id/refund - Staff forbidden from issuing refund (403, Admin only)', async () => {
    const res = await request(`payments/${initialPaymentId}/refund`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        reason: 'Staff attempted refund',
      }),
    });
    assert.equal(res.status, 403);
  });

  // ========================================================
  // Test 8: Admin Issues Refund
  // ========================================================
  await t.test('POST /api/payments/:id/refund - Admin issues refund successfully', async () => {
    const res = await request(`payments/${initialPaymentId}/refund`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        reason: 'Hội viên đổi ý huỷ gói trong thời hạn hoàn tiền',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'REFUNDED');
    assert.ok(data.note.includes('[REFUND:'));
  });

  // ========================================================
  // Test 9: Cashier Shift Reconciliation
  // ========================================================
  await t.test('GET /api/payments/reconciliation - Cashier revenue breakdown', async () => {
    // 1. Confirm second payment as CASH
    const confirmSecond = await request(`payments/${secondPaymentId}/confirm`, {
      method: 'POST',
      token: staffToken,
      body: JSON.stringify({
        method: 'CASH',
      }),
    });
    assert.equal(confirmSecond.status, 200);

    // 2. Query reconciliation for today
    const todayStr = new Date().toISOString().slice(0, 10);
    const res = await request(`payments/reconciliation?date=${todayStr}`, {
      method: 'GET',
      token: staffToken,
    });
    assert.equal(res.status, 200);
    const recon = await res.json();
    assert.ok(recon.totalRevenue >= 500000);
    assert.ok(recon.cashRevenue >= 500000);
    assert.ok(recon.transactionCount >= 1);
    assert.ok(Array.isArray(recon.items));
  });

  // ========================================================
  // Test 10: Query Payments with Filters
  // ========================================================
  await t.test('GET /api/payments - List payments with filters & pagination', async () => {
    const res = await request('payments?page=1&limit=10', {
      method: 'GET',
      token: staffToken,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.data.length >= 1);
    assert.ok(data.meta.total >= 1);
  });
});
