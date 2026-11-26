require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPrismaClient } = require('@gym/database');
const {
  PaymentsService,
} = require('../dist/modules/payments/payments.service');
const {
  CheckinsService,
} = require('../dist/modules/checkins/checkins.service');
const { localPostgres } = require('./local-postgres.cjs');

test(
  'unused Gym refund policy and atomic settlement on isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    const admin = await client.user.create({
      data: { email: 'refund-admin@example.invalid', passwordHash: 'test' },
    });
    const actor = { id: admin.id, roles: ['ADMIN'] };
    const service = new PaymentsService({ client });
    const checkins = new CheckinsService({ client });
    const gym = await client.serviceType.create({
      data: { code: 'GYM_ACCESS', name: 'Gym' },
    });
    const classType = await client.serviceType.create({
      data: { code: 'CLASS', name: 'Class' },
    });
    const plan = await client.membershipPlan.create({
      data: { name: 'Refund Gym', price: 100, durationDays: 30 },
    });
    const teacher = await client.employeeProfile.create({
      data: {
        fullName: 'Teacher',
        user: {
          create: {
            email: 'refund-teacher@example.invalid',
            passwordHash: 'test',
          },
        },
      },
    });
    const course = await client.gymClass.create({ data: { name: 'Yoga' } });
    async function fixture(amounts = [100]) {
      const member = await client.memberProfile.create({
        data: {
          fullName: 'Refund Member',
          user: {
            create: {
              email: randomUUID() + '@example.invalid',
              passwordHash: 'test',
            },
          },
        },
      });
      const sub = await client.subscription.create({
        data: {
          memberId: member.id,
          planId: plan.id,
          status: 'ACTIVE',
          paymentStatus: 'PAID',
          agreedPrice: 100,
          startDate: new Date(Date.now() - 3600000),
          endDate: new Date(Date.now() + 30 * 86400000),
          quotas: {
            create: [
              { serviceTypeId: gym.id, allocated: null },
              { serviceTypeId: classType.id, allocated: 3 },
            ],
          },
        },
        include: { quotas: true },
      });
      const payments = [];
      for (const amount of amounts)
        payments.push(
          await client.paymentRecord.create({
            data: {
              subscriptionId: sub.id,
              amount,
              status: 'PAID',
              currency: 'VND',
              method: 'CASH',
              confirmedAt: new Date(),
              confirmedBy: admin.id,
            },
          }),
        );
      return {
        member,
        sub,
        payment: payments[0],
        payments,
        quota: sub.quotas.find((q) => q.serviceTypeId === classType.id),
      };
    }
    const dto = (amount = 100) => ({
      reason: 'Khách đổi ý',
      method: 'CASH',
      expectedAmount: amount,
      confirmedExternal: true,
    });
    async function blocked(f, pattern) {
      const preview = await service.getRefundPreview(f.payment.id, actor);
      assert.equal(preview.eligible, false);
      assert.match(preview.reasons.join(' '), pattern);
      await assert.rejects(
        service.refundPayment(f.payment.id, dto(), actor),
        (e) => e.getStatus() === 409,
      );
      assert.equal(
        (await client.paymentRecord.findUnique({ where: { id: f.payment.id } }))
          .status,
        'PAID',
      );
    }
    async function booking(
      f,
      startsAt = new Date(Date.now() + 86400000),
      extra = {},
    ) {
      const schedule = await client.classSchedule.create({
        data: {
          classId: course.id,
          trainerId: teacher.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3600000),
          capacity: 20,
        },
      });
      return client.classBooking.create({
        data: {
          scheduleId: schedule.id,
          memberId: f.member.id,
          subscriptionId: f.sub.id,
          quotaId: f.quota.id,
          ...extra,
        },
      });
    }
    await t.test(
      'staff cannot call service directly and invalid external confirmation is rejected',
      async () => {
        const f = await fixture();
        await assert.rejects(
          service.refundPayment(f.payment.id, dto(), {
            ...actor,
            roles: ['STAFF'],
          }),
          (e) => e.getStatus() === 403,
        );
        for (const body of [
          { ...dto(), reason: ' ' },
          { ...dto(), confirmedExternal: false },
          { ...dto(), method: 'TRANSFER' },
          { ...dto(), expectedAmount: NaN },
        ])
          await assert.rejects(
            service.refundPayment(f.payment.id, body, actor),
            (e) => e.getStatus() === 400,
          );
      },
    );
    await t.test(
      'old, missing and future confirmation dates cannot be refunded',
      async () => {
        for (const date of [
          new Date(Date.now() - 8 * 86400000),
          null,
          new Date(Date.now() + 86400000),
        ]) {
          const f = await fixture();
          await client.paymentRecord.update({
            where: { id: f.payment.id },
            data: { confirmedAt: date },
          });
          await blocked(f, /7 ngày|Thiếu ngày/);
        }
      },
    );
    await t.test(
      'seven day window starts when final installment settles the price',
      async () => {
        const f = await fixture([40, 60]);
        await client.paymentRecord.update({
          where: { id: f.payment.id },
          data: { confirmedAt: new Date(Date.now() - 8 * 86400000) },
        });
        assert.equal(
          (await service.getRefundPreview(f.payment.id, actor)).eligible,
          true,
        );
      },
    );
    await t.test(
      'accepted access blocks refund; rejected attempts do not',
      async () => {
        const f = await fixture();
        await client.checkin.create({
          data: {
            memberId: f.member.id,
            subscriptionId: f.sub.id,
            status: 'REJECTED',
            rejectionReason: 'Test rejected attempt',
          },
        });
        assert.equal(
          (await service.getRefundPreview(f.payment.id, actor)).eligible,
          true,
        );
        await client.checkin.create({
          data: {
            memberId: f.member.id,
            subscriptionId: f.sub.id,
            status: 'ACCEPTED',
            quotaId: f.sub.quotas.find((q) => q.serviceTypeId === gym.id).id,
          },
        });
        await blocked(f, /đã được sử dụng/);
      },
    );
    await t.test(
      'accepted access on another subscription does not block this unused package',
      async () => {
        const f = await fixture();
        await client.checkin.create({
          data: {
            memberId: f.member.id,
            subscriptionId: f.sub.id,
            quotaId: f.sub.quotas.find((q) => q.serviceTypeId === gym.id).id,
            status: 'ACCEPTED',
          },
        });
        const g = await fixture();
        await client.subscription.update({
          where: { id: g.sub.id },
          data: { memberId: f.member.id },
        });
        assert.equal(
          (await service.getRefundPreview(g.payment.id, actor)).eligible,
          true,
        );
      },
    );
    await t.test(
      'attendance, no-show and historical consumed quota block refunds',
      async () => {
        for (const status of ['COMPLETED', 'NO_SHOW']) {
          const f = await fixture();
          await booking(f, new Date(Date.now() - 7200000), {
            status,
            attendance: status === 'COMPLETED' ? 'PRESENT' : 'ABSENT',
          });
          await blocked(f, /đã được sử dụng/);
        }
        const f = await fixture();
        await client.quotaTransaction.create({
          data: {
            subscriptionId: f.sub.id,
            quotaId: f.quota.id,
            type: 'USE',
            usedDelta: 1,
            idempotencyKey: randomUUID(),
          },
        });
        await blocked(f, /đã được sử dụng/);
      },
    );
    await t.test(
      'overdue unresolved attendance and orphan reservations block refunds',
      async () => {
        const f = await fixture();
        await booking(f, new Date(Date.now() - 7200000));
        await blocked(f, /đối chiếu/);
        const g = await fixture();
        await client.subscriptionQuota.update({
          where: { id: g.quota.id },
          data: { reserved: 1 },
        });
        await blocked(g, /giữ chỗ/);
      },
    );
    await t.test(
      'suspended or renewal-linked subscriptions are blocked',
      async () => {
        const f = await fixture();
        await client.subscription.update({
          where: { id: f.sub.id },
          data: { status: 'SUSPENDED' },
        });
        await blocked(f, /bảo lưu/);
        const g = await fixture();
        const next = await fixture();
        await client.subscription.update({
          where: { id: next.sub.id },
          data: { memberId: g.member.id, previousSubscriptionId: g.sub.id },
        });
        await blocked(g, /gia hạn/);
      },
    );
    await t.test(
      'underpaid and mismatched amounts cannot be refunded',
      async () => {
        const f = await fixture([40]);
        await blocked(f, /thanh toán đủ/);
        const g = await fixture();
        await assert.rejects(
          service.refundPayment(g.payment.id, dto(99), actor),
          (e) => e.getStatus() === 409,
        );
      },
    );
    await t.test(
      'full multi-receipt refund cancels bookings, pending receipts, freezes and access, and preserves proof',
      async () => {
        const f = await fixture([40, 60]);
        const b = await booking(f);
        await client.subscriptionQuota.update({
          where: { id: f.quota.id },
          data: { reserved: 1 },
        });
        const pending = await client.paymentRecord.create({
          data: { subscriptionId: f.sub.id, amount: 10, status: 'PENDING' },
        });
        const freeze = await client.subscriptionFreeze.create({
          data: {
            subscriptionId: f.sub.id,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 7 * 86400000),
            freezeDays: 7,
            status: 'REQUESTED',
          },
        });
        const preview = await service.getRefundPreview(f.payment.id, actor);
        assert.equal(preview.amount, 100);
        assert.equal(preview.receiptCount, 2);
        assert.equal(preview.futureBookingCount, 1);
        assert.equal(preview.eligible, true);
        await service.refundPayment(
          f.payment.id,
          { ...dto(), method: 'TRANSFER', reference: 'BANK-QA-001' },
          actor,
        );
        const sub = await client.subscription.findUnique({
          where: { id: f.sub.id },
        });
        assert.equal(sub.status, 'CANCELLED');
        assert.equal(sub.paymentStatus, 'REFUNDED');
        assert.equal(
          await client.paymentRecord.count({
            where: { subscriptionId: f.sub.id, status: 'REFUNDED' },
          }),
          2,
        );
        assert.equal(
          (await client.paymentRecord.findUnique({ where: { id: pending.id } }))
            .status,
          'CANCELLED',
        );
        assert.equal(
          (await client.classBooking.findUnique({ where: { id: b.id } }))
            .status,
          'CANCELLED',
        );
        assert.equal(
          (
            await client.subscriptionQuota.findUnique({
              where: { id: f.quota.id },
            })
          ).reserved,
          0,
        );
        assert.equal(
          (
            await client.subscriptionFreeze.findUnique({
              where: { id: freeze.id },
            })
          ).status,
          'CANCELLED',
        );
        const receipt = await service.getReceipt(f.payment.id, actor);
        assert.equal(receipt.status, 'REFUNDED');
        assert.equal(receipt.method, 'CASH');
        assert.equal(receipt.refund.amount, 100);
        assert.equal(receipt.refund.method, 'TRANSFER');
        assert.equal(receipt.refund.reference, 'BANK-QA-001');
        assert.equal(receipt.refund.refundedBy, actor.id);
        assert.equal(
          await client.auditLog.count({
            where: {
              action: 'REFUND_PAYMENT',
              entityId: { in: f.payments.map((p) => p.id) },
            },
          }),
          2,
        );
        const access = await checkins.recordCheckin(
          { memberId: f.member.id, idempotencyKey: randomUUID() },
          actor.id,
        );
        assert.equal(access.status, 'REJECTED');
      },
    );
    await t.test(
      'failed confirmation audit rolls back the financial changes',
      async () => {
        const f = await fixture();
        await assert.rejects(
          service.refundPayment(f.payment.id, dto(), {
            id: randomUUID(),
            roles: ['ADMIN'],
          }),
        );
        assert.equal(
          (
            await client.paymentRecord.findUnique({
              where: { id: f.payment.id },
            })
          ).status,
          'PAID',
        );
        assert.equal(
          (await client.subscription.findUnique({ where: { id: f.sub.id } }))
            .status,
          'ACTIVE',
        );
        assert.equal(
          await client.auditLog.count({ where: { entityId: f.payment.id } }),
          0,
        );
      },
    );
    await t.test(
      'double submission refunds once with one immutable confirmation',
      async () => {
        const f = await fixture();
        const results = await Promise.allSettled([
          service.refundPayment(f.payment.id, dto(), actor),
          service.refundPayment(f.payment.id, dto(), actor),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          await client.auditLog.count({
            where: { entityId: f.payment.id, action: 'REFUND_PAYMENT' },
          }),
          1,
        );
      },
    );
    await t.test('check-in racing refund cannot both succeed', async () => {
      const f = await fixture();
      const [refund, access] = await Promise.allSettled([
        service.refundPayment(f.payment.id, dto(), actor),
        checkins.recordCheckin(
          { memberId: f.member.id, idempotencyKey: randomUUID() },
          actor.id,
        ),
      ]);
      assert.equal(access.status, 'fulfilled');
      assert.ok(
        !(refund.status === 'fulfilled' && access.value.status === 'ACCEPTED'),
      );
      if (refund.status === 'rejected') {
        assert.equal(access.value.status, 'ACCEPTED');
        assert.equal(
          (
            await client.paymentRecord.findUnique({
              where: { id: f.payment.id },
            })
          ).status,
          'PAID',
        );
      }
    });
  },
);
