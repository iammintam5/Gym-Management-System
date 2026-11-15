const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/config/setup-app');
const { DatabaseService } = require('../dist/modules/database/database.module');
const {
  NotificationsService,
} = require('../dist/modules/notifications/notifications.service');
const {
  AuditLogsService,
} = require('../dist/modules/audit-logs/audit-logs.service');
const { JobsService } = require('../dist/modules/jobs/jobs.service');

test('Reports, Notifications, Audit Trail & Scheduled Jobs Integration Tests', async (t) => {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());

  const db = app.get(DatabaseService);
  const notificationsService = app.get(NotificationsService);
  const auditLogsService = app.get(AuditLogsService);
  const jobsService = app.get(JobsService);
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
  const adminData = await adminRes.json();
  const adminToken = adminData.tokens.accessToken;
  const adminUserId = adminData.user.id;

  const staffRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'staff@gym.com',
      password: 'Staff@123456',
    }),
  });
  assert.equal(staffRes.status, 200);
  const staffToken = (await staffRes.json()).tokens.accessToken;

  // Setup Test Members
  const member1Email = `report.m1.${Date.now()}@gym.local`;
  const m1Res = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: member1Email,
      password: 'Password@123456',
      fullName: 'Report Test Member One',
      phone: `093${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(m1Res.status, 201);
  const m1Data = await m1Res.json();
  const member1Id = m1Data.id;
  const member1UserId = m1Data.userId;

  const m1LoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: member1Email,
      password: 'Password@123456',
    }),
  });
  assert.equal(m1LoginRes.status, 200);
  const member1Token = (await m1LoginRes.json()).tokens.accessToken;

  const member2Email = `report.m2.${Date.now()}@gym.local`;
  const m2Res = await request('members', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      email: member2Email,
      password: 'Password@123456',
      fullName: 'Report Test Member Two',
      phone: `094${Math.floor(1000000 + Math.random() * 9000000)}`,
    }),
  });
  assert.equal(m2Res.status, 201);
  const member2Data = await m2Res.json();
  const _member2UserId = member2Data.userId;

  const m2LoginRes = await request('auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: member2Email,
      password: 'Password@123456',
    }),
  });
  assert.equal(m2LoginRes.status, 200);
  const member2Token = (await m2LoginRes.json()).tokens.accessToken;

  // Membership Plan & Subscription
  const planRes = await request('membership-plans', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      name: `Report Plan ${Date.now()}`,
      durationDays: 30,
      price: 1500000,
      isActive: true,
      entitlements: [{ service: 'GYM_ACCESS', limitType: 'UNLIMITED' }],
    }),
  });
  assert.equal(planRes.status, 201);
  const plan = await planRes.json();

  const subRes = await request('subscriptions', {
    method: 'POST',
    token: adminToken,
    body: JSON.stringify({
      memberId: member1Id,
      planId: plan.id,
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
    }),
  });
  assert.equal(subRes.status, 201);
  const sub = await subRes.json();
  const subId = sub.id;

  // ========================================================
  // Test 1: Dashboard Summary & Revenue Reports (ADMIN)
  // ========================================================
  await t.test(
    'GET /api/reports/dashboard-summary & /revenue - Financial KPIs and Aggregations',
    async () => {
      // Deposits belong to a separate unpaid subscription, within its agreed price.
      const installmentSubRes = await request('subscriptions', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({
          memberId: member2Data.id,
          planId: plan.id,
          paymentStatus: 'PENDING',
        }),
      });
      assert.equal(installmentSubRes.status, 201);
      const installmentSubId = (await installmentSubRes.json()).id;
      // Record and confirm payments with different methods
      const pay1 = await request(`subscriptions/${installmentSubId}/payments`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          amount: 500000,
          method: 'TRANSFER',
          status: 'PAID',
        }),
      });
      assert.equal(pay1.status, 201);

      const pay2 = await request(`subscriptions/${installmentSubId}/payments`, {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({
          amount: 700000,
          method: 'CASH',
          status: 'PAID',
        }),
      });
      assert.equal(pay2.status, 201);

      // Call dashboard summary
      const summaryRes = await request('reports/dashboard-summary', {
        method: 'GET',
        token: adminToken,
      });
      assert.equal(summaryRes.status, 200);
      const summary = await summaryRes.json();
      assert.ok(summary.financials.totalRevenue >= 2700000); // 1.5m initial sub + 500k + 700k
      assert.ok(summary.financials.cashAmount >= 2200000);
      assert.ok(summary.financials.transferAmount >= 500000);

      assert.ok(summary.members.totalActiveMembers >= 1);
      assert.ok(summary.members.newMembersCount >= 2);

      // Call revenue report
      const revRes = await request('reports/revenue?groupBy=DAY', {
        method: 'GET',
        token: adminToken,
      });
      assert.equal(revRes.status, 200);
      const rev = await revRes.json();
      assert.equal(rev.groupBy, 'DAY');
      assert.ok(rev.totalRevenue >= 2700000);
      assert.ok(Array.isArray(rev.items));
      assert.ok(rev.items.length >= 1);
      assert.ok(Array.isArray(rev.byPlan));
      assert.ok(rev.byPlan.some((p) => p.planId === plan.id));
    },
  );

  // ========================================================
  // Test 2: Operational Reports: Attendance Peak Hours, Class Utilization, Trainer Performance
  // ========================================================
  await t.test(
    'GET /api/reports/attendance-peak-hours & class-utilization & trainer-performance',
    async () => {
      // Record check-in to generate attendance data
      const checkinRes = await request('checkins', {
        method: 'POST',
        token: staffToken,
        body: JSON.stringify({ memberId: member1Id }),
      });
      assert.equal(checkinRes.status, 200);

      // Attendance Peak Hours
      const peakRes = await request('reports/attendance-peak-hours', {
        method: 'GET',
        token: staffToken,
      });
      assert.equal(peakRes.status, 200);
      const peak = await peakRes.json();
      assert.ok(peak.totalCheckins >= 1);
      assert.equal(peak.hourlyDistribution.length, 17); // hours 6 to 22
      assert.ok(peak.peakHour !== null);

      // Class Utilization
      const utilRes = await request('reports/class-utilization', {
        method: 'GET',
        token: staffToken,
      });
      assert.equal(utilRes.status, 200);
      const util = await utilRes.json();
      assert.ok(Array.isArray(util.items));
      assert.equal(typeof util.averageUtilizationRate, 'number');

      // Trainer Performance
      const trainerRes = await request('reports/trainer-performance', {
        method: 'GET',
        token: adminToken,
      });
      assert.equal(trainerRes.status, 200);
      const trainerReport = await trainerRes.json();
      assert.ok(Array.isArray(trainerReport.items));
    },
  );

  // ========================================================
  // Test 3: Notifications Workflow (My, Mark Read, Read All)
  // ========================================================
  let notif1Id = null;
  await t.test(
    'Notifications - Create, view unread count, mark read, and mark all read',
    async () => {
      // 1. Create 2 notifications for member1
      const n1 = await notificationsService.createNotification(
        member1UserId,
        'Chào mừng bạn!',
        'Chào mừng bạn đã gia nhập phòng gym.',
        { type: 'WELCOME' },
      );
      notif1Id = n1.id;

      await notificationsService.createNotification(
        member1UserId,
        'Lịch tập hôm nay',
        'Đừng quên bạn có lịch tập hôm nay lúc 18:00.',
      );

      // 2. Member checks notifications
      const myRes = await request('notifications/my', {
        method: 'GET',
        token: member1Token,
      });
      assert.equal(myRes.status, 200);
      const myNotifs = await myRes.json();
      assert.ok(myNotifs.unreadCount >= 2);
      assert.ok(myNotifs.data.length >= 2);

      // 3. Mark single notification as read
      const read1Res = await request(`notifications/${notif1Id}/read`, {
        method: 'PATCH',
        token: member1Token,
      });
      assert.equal(read1Res.status, 200);
      const read1 = await read1Res.json();
      assert.equal(read1.isRead, true);
      assert.ok(read1.readAt);

      // 4. Mark all read
      const readAllRes = await request('notifications/read-all', {
        method: 'PATCH',
        token: member1Token,
      });
      assert.equal(readAllRes.status, 200);

      // Verify unread count is now 0
      const checkUnreadRes = await request('notifications/my?unreadOnly=true', {
        method: 'GET',
        token: member1Token,
      });
      assert.equal(checkUnreadRes.status, 200);
      const checkData = await checkUnreadRes.json();
      assert.equal(checkData.unreadCount, 0);
      assert.equal(checkData.data.length, 0);
    },
  );

  // ========================================================
  // Test 4: Audit Logs Recording & Querying (ADMIN)
  // ========================================================
  await t.test(
    'Audit Logs - Log sensitive action and query with filters',
    async () => {
      // Log sensitive action
      await auditLogsService.logAction({
        actorId: adminUserId,
        action: 'MANUAL_QUOTA_ADJUSTMENT',
        entityType: 'SubscriptionQuota',
        entityId: subId,
        metadata: { delta: +5, reason: 'Compensation for system maintenance' },
      });

      // Admin queries audit logs
      const auditRes = await request(
        'audit-logs?action=MANUAL_QUOTA_ADJUSTMENT',
        {
          method: 'GET',
          token: adminToken,
        },
      );
      assert.equal(auditRes.status, 200);
      const audit = await auditRes.json();
      assert.ok(Array.isArray(audit.data));
      assert.ok(audit.data.length >= 1);
      const match = audit.data.find((l) => l.entityId === subId);
      assert.ok(match);
      assert.equal(match.action, 'MANUAL_QUOTA_ADJUSTMENT');
      assert.equal(match.actorEmail, 'admin@gym.com');
    },
  );

  // ========================================================
  // Test 5: Scheduled Background Jobs (Expiry Scanner & Freeze Auto-Restoration)
  // ========================================================
  await t.test(
    'Jobs - Expiry scanner and freeze auto-restoration background workflows',
    async () => {
      // 1. Test Expiry Scanner: set sub endDate to 4 days from now
      const now = new Date();
      const in4Days = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
      await db.client.subscription.update({
        where: { id: subId },
        data: { endDate: in4Days },
      });

      const scanResult = await jobsService.runExpiryScan(now);
      assert.ok(scanResult.scanned >= 1);
      assert.ok(scanResult.notified >= 1);

      // Member checks notifications for expiry reminder
      const expNotifsRes = await request('notifications/my', {
        method: 'GET',
        token: member1Token,
      });
      assert.equal(expNotifsRes.status, 200);
      const expNotifs = await expNotifsRes.json();
      assert.ok(
        expNotifs.data.some(
          (n) =>
            n.title === 'Gói tập sắp hết hạn' &&
            n.data?.type === 'EXPIRY_REMINDER',
        ),
      );

      // 2. Test Freeze Auto-Restoration: Create an approved freeze whose endsAt is in the past
      const pastStarts = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const pastEnds = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const dueFreeze = await db.client.subscriptionFreeze.create({
        data: {
          subscriptionId: subId,
          startsAt: pastStarts,
          endsAt: pastEnds,
          freezeDays: 9,
          status: 'APPROVED',
          reason: 'Nghỉ lễ đã kết thúc',
        },
      });

      const subBeforeRestore = await db.client.subscription.findUnique({
        where: { id: subId },
      });
      const oldEndDateMs = new Date(subBeforeRestore.endDate).getTime();

      // Trigger auto-restore runner
      const restoreResult = await jobsService.runFreezeAutoRestore(now);
      assert.ok(restoreResult.restored >= 1);

      // Verify freeze is completed and restoredAt is set
      const freezeAfter = await db.client.subscriptionFreeze.findUnique({
        where: { id: dueFreeze.id },
      });
      assert.equal(freezeAfter.status, 'COMPLETED');
      assert.ok(freezeAfter.restoredAt);

      // Verify sub endDate was extended by 9 days
      const subAfterRestore = await db.client.subscription.findUnique({
        where: { id: subId },
      });
      assert.equal(subAfterRestore.status, 'ACTIVE');
      const newEndDateMs = new Date(subAfterRestore.endDate).getTime();
      assert.equal(newEndDateMs - oldEndDateMs, 9 * 24 * 60 * 60 * 1000);

      // Member received auto-restored notification
      const autoRestoreNotif = await db.client.notification.findFirst({
        where: {
          userId: member1UserId,
          title: 'Bảo lưu gói tập đã kết thúc',
        },
      });
      assert.ok(autoRestoreNotif);
    },
  );

  // ========================================================
  // Test 6: RBAC & Security Enforcement
  // ========================================================
  await t.test(
    'RBAC - Restricts reports & audit logs to privileged roles',
    async () => {
      // Member cannot access dashboard summary
      const mDash = await request('reports/dashboard-summary', {
        method: 'GET',
        token: member1Token,
      });
      assert.equal(mDash.status, 403);

      // Member cannot access revenue report
      const mRev = await request('reports/revenue', {
        method: 'GET',
        token: member1Token,
      });
      assert.equal(mRev.status, 403);

      // Staff cannot access trainer performance (Admin only)
      const sTrainer = await request('reports/trainer-performance', {
        method: 'GET',
        token: staffToken,
      });
      assert.equal(sTrainer.status, 403);

      // Staff cannot access audit logs (Admin only)
      const sAudit = await request('audit-logs', {
        method: 'GET',
        token: staffToken,
      });
      assert.equal(sAudit.status, 403);

      // Member cannot mark another member's notification as read
      const hackNotif = await request(`notifications/${notif1Id}/read`, {
        method: 'PATCH',
        token: member2Token,
      });
      assert.equal(hackNotif.status, 403);
    },
  );
});
