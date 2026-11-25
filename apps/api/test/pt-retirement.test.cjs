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

test(
  'retired PT: blocked operations, unchanged purchased rights, retained receipts and active group classes',
  { timeout: 120000 },
  async (t) => {
    assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
    const db = createPrismaClient(process.env.DATABASE_URL);
    const app = await NestFactory.create(AppModule, { logger: false });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    t.after(async () => {
      await app.close();
      await db.$disconnect();
    });
    const base = await app.getUrl(),
      jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    async function actor(role) {
      const user = await db.user.create({
        data: {
          email: randomUUID() + '@example.invalid',
          passwordHash: 'fixture',
          roles: { create: { role: { connect: { code: role } } } },
          ...(role === 'MEMBER'
            ? { memberProfile: { create: { fullName: 'Retirement Member' } } }
            : {
                employeeProfile: {
                  create: {
                    fullName: 'Retirement ' + role,
                    canTeachClasses: role === 'TRAINER',
                    canCoachPt: role === 'TRAINER',
                  },
                },
              }),
        },
        include: { memberProfile: true, employeeProfile: true },
      });
      return {
        user,
        memberId: user.memberProfile?.id,
        trainerId: user.employeeProfile?.id,
        token: jwt.sign(
          { sub: user.id, email: user.email, roles: [role], type: 'access' },
          { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
        ),
      };
    }
    const admin = await actor('ADMIN'),
      staff = await actor('STAFF'),
      member = await actor('MEMBER'),
      stranger = await actor('MEMBER'),
      trainer = await actor('TRAINER');
    async function api(method, route, person, body) {
      const response = await fetch(base + '/api' + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(person ? { Authorization: 'Bearer ' + person.token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    function expect(result, status) {
      assert.equal(result.status, status, JSON.stringify(result.body));
      return result.body;
    }
    const gymPlan = await db.membershipPlan.create({
      data: {
        name: 'Retirement Gym',
        durationDays: 90,
        price: 900000,
        entitlements: {
          create: [
            {
              serviceType: { connect: { code: 'GYM_ACCESS' } },
              allocated: null,
            },
            { serviceType: { connect: { code: 'CLASS' } }, allocated: 8 },
            { serviceType: { connect: { code: 'PT' } }, allocated: 5 },
          ],
        },
      },
    });
    const gym = expect(
      await api('POST', '/subscriptions', staff, {
        memberId: member.memberId,
        planId: gymPlan.id,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        idempotencyKey: randomUUID(),
      }),
      201,
    );
    // A retained bundled quota is read-only after retirement. This is test data, not a newly sold entitlement.
    const oldQuota = await db.subscriptionQuota.create({
      data: {
        subscription: { connect: { id: gym.id } },
        serviceType: { connect: { code: 'PT' } },
        allocated: 2,
      },
    });
    const legacyPlan = await db.ptPackagePlan.create({
      data: {
        code: 'OLD_' + randomUUID(),
        name: 'PT cũ 5 buổi',
        sessionCount: 5,
        price: 2000000,
      },
    });
    const purchase = await db.ptPackagePurchase.create({
      data: {
        memberId: member.memberId,
        origin: 'STANDALONE',
        ptPlanId: legacyPlan.id,
        packageCodeSnapshot: legacyPlan.code,
        packageNameSnapshot: legacyPlan.name,
        sessionCountSnapshot: 5,
        sessionMinutesSnapshot: 60,
        allocated: 5,
        used: 1,
        reserved: 1,
        agreedPrice: 2000000,
        currency: 'VND',
        paymentStatus: 'PAID',
        status: 'ACTIVE',
      },
    });
    const payment = await db.paymentRecord.create({
      data: {
        ptPurchaseId: purchase.id,
        amount: 2000000,
        currency: 'VND',
        status: 'PAID',
        method: 'TRANSFER',
        confirmedAt: new Date(),
        confirmedBy: staff.user.id,
      },
    });
    const start = new Date(Date.now() + 2 * 86400000),
      end = new Date(start.getTime() + 3600000);
    const held = await db.ptBooking.create({
      data: {
        memberId: member.memberId,
        trainerId: trainer.trainerId,
        subscriptionId: gym.id,
        ptPurchaseId: purchase.id,
        startsAt: start,
        endsAt: end,
      },
    });
    const before = {
      purchase: await db.ptPackagePurchase.findUniqueOrThrow({
        where: { id: purchase.id },
      }),
      payment: await db.paymentRecord.findUniqueOrThrow({
        where: { id: payment.id },
      }),
      held: await db.ptBooking.findUniqueOrThrow({ where: { id: held.id } }),
    };

    await t.test(
      'all roles are prevented from selling, assigning or booking PT, including stale clients',
      async () => {
        for (const person of [admin, staff, member, trainer]) {
          for (const [method, route, body] of [
            [
              'POST',
              '/pt-packages/purchases',
              { memberId: member.memberId, ptPlanId: legacyPlan.id },
            ],
            [
              'POST',
              '/pt-bookings',
              {
                memberId: member.memberId,
                trainerId: trainer.trainerId,
                startsAt: start.toISOString(),
                endsAt: end.toISOString(),
              },
            ],
            [
              'POST',
              '/pt-assignments/' + gym.id,
              { trainerId: trainer.trainerId, expectedVersion: 0 },
            ],
            [
              'POST',
              '/trainers/me/availabilities',
              { startsAt: start.toISOString(), endsAt: end.toISOString() },
            ],
            [
              'POST',
              '/pt-bookings/' + held.id + '/attendance',
              { attendance: 'PRESENT' },
            ],
          ])
            expect(await api(method, route, person, body), 410);
        }
        expect(await api('GET', '/pt-package-plans', admin), 410);
        expect(
          await api('POST', '/quotas/' + oldQuota.id + '/adjust', null, {
            allocatedDelta: 1,
            reason: 'Retired quota test',
          }),
          401,
        );
        expect(
          await api('POST', '/quotas/' + oldQuota.id + '/adjust', admin, {
            allocatedDelta: 1,
            reason: 'Retired quota test',
          }),
          410,
        );
        assert.deepEqual(
          await db.subscriptionQuota.findUniqueOrThrow({
            where: { id: oldQuota.id },
          }),
          oldQuota,
        );
        expect(
          await api('POST', '/payments/' + payment.id + '/confirm', null, {
            method: 'CASH',
          }),
          401,
        );
        expect(
          await api('DELETE', '/trainers/availabilities/' + held.id, admin),
          410,
        );
        expect(await api('GET', '/pt-assignments/me', member), 410);
        expect(
          await api(
            'GET',
            '/trainers/' + trainer.trainerId + '/availabilities',
            null,
          ),
          410,
        );
        expect(
          await api('POST', '/payments/' + payment.id + '/confirm', admin, {
            method: 'CASH',
          }),
          410,
        );
        expect(
          await api('POST', '/membership-plans', admin, {
            name: 'Rejected PT',
            durationDays: 30,
            price: 100,
            entitlements: [
              { service: 'pt', limitType: 'COUNT', limitValue: 5 },
            ],
          }),
          410,
        );
        expect(
          await api('POST', '/employees', admin, { canCoachPt: true }),
          410,
        );
        assert.equal(
          await db.ptPackagePurchase.count({
            where: { memberId: member.memberId },
          }),
          1,
        );
        assert.equal(
          await db.ptBooking.count({ where: { memberId: member.memberId } }),
          1,
        );
        assert.deepEqual(
          await db.ptPackagePurchase.findUniqueOrThrow({
            where: { id: purchase.id },
          }),
          before.purchase,
        );
        assert.deepEqual(
          await db.paymentRecord.findUniqueOrThrow({
            where: { id: payment.id },
          }),
          before.payment,
        );
        assert.deepEqual(
          await db.ptBooking.findUniqueOrThrow({ where: { id: held.id } }),
          before.held,
        );
      },
    );

    await t.test(
      'pure PT lifecycle hooks do not query or rewrite archived rights',
      async () => {
        const {
          PtCreditService,
        } = require('../dist/modules/pt-packages/pt-credit.service');
        const service = app.get(PtCreditService);
        const tx = new Proxy(
          {},
          {
            get() {
              throw Error('Retired PT hook attempted a database operation');
            },
          },
        );
        const params = {
          memberId: member.memberId,
          subscriptionId: gym.id,
          cancelledSubscriptionId: gym.id,
          freezeId: randomUUID(),
          freezeStartsAt: start,
          freezeEndsAt: end,
          now: new Date(),
          actorId: admin.user.id,
          reason: 'Retired product',
        };
        // Mixed freeze hook keeps its group-class work, then stops before any PT access.
        await service.handleFreezeApprovedInTx(
          { classBooking: { findMany: async () => [] } },
          params,
        );
        await service.handleFreezeRestoredInTx(tx, params);
        await service.handleSubscriptionCancelledInTx(tx, params);
        assert.deepEqual(
          await db.ptPackagePurchase.findUniqueOrThrow({
            where: { id: purchase.id },
          }),
          before.purchase,
        );
        assert.deepEqual(
          await db.ptBooking.findUniqueOrThrow({ where: { id: held.id } }),
          before.held,
        );
      },
    );

    await t.test(
      'historical money and remaining rights stay readable with ownership protection',
      async () => {
        const history = expect(
          await api('GET', '/pt-packages/me/purchases', member),
          200,
        );
        assert.equal(history.data[0].id, purchase.id);
        assert.equal(history.data[0].remaining, 3);
        assert.equal(history.data[0].reserved, 1);
        const receipt = expect(
          await api('GET', '/payments/' + payment.id + '/receipt', member),
          200,
        );
        assert.equal(receipt.ptPurchase.packageName, legacyPlan.name);
        assert.equal(receipt.amount, 2000000);
        expect(
          await api('GET', '/payments/' + payment.id + '/receipt', stranger),
          403,
        );
        expect(
          await api(
            'GET',
            '/members/' + member.memberId + '/pt-purchases',
            stranger,
          ),
          403,
        );
        assert.ok(
          expect(
            await api('GET', '/payments/me?limit=100', member),
            200,
          ).data.some((item) => item.id === payment.id),
        );
      },
    );

    await t.test(
      'Gym packages cannot mint or advertise PT and group scheduling ignores retired PT holds',
      async () => {
        assert.ok(!gym.quotas.some((quota) => quota.service === 'PT'));
        const services = expect(
          await api('GET', '/membership-plans/service-types', admin),
          200,
        );
        assert.ok(!services.some((item) => item.code === 'PT'));
        const course = await db.gymClass.create({
          data: { name: 'Retirement Yoga' },
        });
        const scheduled = expect(
          await api('POST', '/class-schedules', staff, {
            classId: course.id,
            trainerId: trainer.trainerId,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            capacity: 20,
          }),
          201,
        );
        const booking = expect(
          await api('POST', '/class-bookings', member, {
            scheduleId: scheduled.id,
          }),
          201,
        );
        assert.equal(booking.memberId, member.memberId);
        expect(
          await api(
            'POST',
            '/class-bookings/' + booking.id + '/cancel',
            member,
            {},
          ),
          200,
        );
        // No history rows or PT balances are rewritten just to unblock the new calendar.
        assert.deepEqual(
          await db.ptBooking.findUniqueOrThrow({ where: { id: held.id } }),
          before.held,
        );
        assert.deepEqual(
          await db.ptPackagePurchase.findUniqueOrThrow({
            where: { id: purchase.id },
          }),
          before.purchase,
        );
        const roster = expect(
          await api('GET', '/class-schedules?limit=100', trainer),
          200,
        );
        assert.ok(roster.data.some((item) => item.id === scheduled.id));
      },
    );

    await t.test(
      'HLV report is based on ended group classes and excludes historical private sessions',
      async () => {
        const course = await db.gymClass.create({
          data: { name: 'Past Yoga' },
        });
        await db.classSchedule.create({
          data: {
            classId: course.id,
            trainerId: trainer.trainerId,
            startsAt: new Date(Date.now() - 2 * 3600000),
            endsAt: new Date(Date.now() - 3600000),
            capacity: 20,
          },
        });
        const report = expect(
          await api('GET', '/reports/trainer-performance', admin),
          200,
        );
        assert.equal(report.basis, 'ENDED_GROUP_CLASSES');
        assert.equal(
          report.items.find((item) => item.trainerId === trainer.trainerId)
            .completedSessionsCount,
          1,
        );
      },
    );
  },
);
