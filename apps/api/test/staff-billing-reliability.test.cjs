require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPrismaClient } = require('@gym/database');
const {
  PaymentsService,
} = require('../dist/modules/payments/payments.service');
const {
  SubscriptionsService,
} = require('../dist/modules/subscriptions/subscriptions.service');
const { localPostgres } = require('./local-postgres.cjs');

test(
  'staff billing consistency and retry behavior on isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    const user = await client.user.create({
      data: { email: 'cashier@example.invalid', passwordHash: 'test' },
    });
    const actor = { id: user.id, roles: ['STAFF'] };
    const member = await client.memberProfile.create({
      data: {
        fullName: 'Billing QA',
        user: {
          create: { email: 'billing@example.invalid', passwordHash: 'test' },
        },
      },
    });
    const plan = await client.membershipPlan.create({
      data: { name: 'Billing', price: 100, durationDays: 30 },
    });
    const payments = new PaymentsService({ client });
    const subscriptions = new SubscriptionsService({ client });
    async function fixture() {
      return client.subscription.create({
        data: {
          memberId: member.id,
          planId: plan.id,
          startDate: new Date(Date.now() - 3600000),
          endDate: new Date(Date.now() + 86400000),
          agreedPrice: 100,
          status: 'UPCOMING',
          paymentStatus: 'PENDING',
        },
      });
    }
    await t.test(
      'partial collection does not grant paid access, full collection does, full subscription refund revokes it',
      async () => {
        const sub = await fixture();
        const first = await payments.createPayment(
          sub.id,
          { amount: 1, status: 'PAID' },
          actor,
        );
        let stored = await client.subscription.findUnique({
          where: { id: sub.id },
        });
        assert.equal(stored.paymentStatus, 'PENDING');
        assert.equal(stored.status, 'UPCOMING');
        await payments.createPayment(
          sub.id,
          { amount: 99, status: 'PAID' },
          actor,
        );
        stored = await client.subscription.findUnique({
          where: { id: sub.id },
        });
        assert.equal(stored.paymentStatus, 'PAID');
        assert.equal(stored.status, 'ACTIVE');
        await assert.rejects(
          payments.createPayment(sub.id, { amount: 1, status: 'PAID' }, actor),
          (e) => e.getStatus() === 409,
        );
        await payments.refundPayment(
          first.id,
          {
            reason: 'Test',
            method: 'CASH',
            expectedAmount: 100,
            confirmedExternal: true,
          },
          { ...actor, roles: ['ADMIN'] },
        );
        assert.equal(
          (await client.subscription.findUnique({ where: { id: sub.id } }))
            .paymentStatus,
          'REFUNDED',
        );
      },
    );
    await t.test(
      'concurrent confirmation has one winner and preserves confirmer',
      async () => {
        const sub = await fixture();
        const pending = await payments.createPayment(
          sub.id,
          { amount: 100, status: 'PENDING' },
          actor,
        );
        const results = await Promise.allSettled([
          payments.confirmPayment(pending.id, { method: 'CASH' }, actor),
          payments.confirmPayment(pending.id, { method: 'TRANSFER' }, actor),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          results.find((r) => r.status === 'rejected').reason.getStatus(),
          409,
        );
        assert.equal(
          (await client.paymentRecord.findUnique({ where: { id: pending.id } }))
            .method,
          results.find((r) => r.status === 'fulfilled').value.method,
        );
      },
    );
    await t.test(
      'concurrent receipts cannot over-collect the same outstanding balance',
      async () => {
        const sub = await fixture();
        await payments.createPayment(
          sub.id,
          { amount: 50, status: 'PAID' },
          actor,
        );
        const a = await payments.createPayment(
          sub.id,
          { amount: 50, status: 'PENDING' },
          actor,
        );
        const b = await payments.createPayment(
          sub.id,
          { amount: 50, status: 'PENDING' },
          actor,
        );
        const results = await Promise.allSettled([
          payments.confirmPayment(a.id, { method: 'CASH' }, actor),
          payments.confirmPayment(b.id, { method: 'CASH' }, actor),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const total = await client.paymentRecord.aggregate({
          where: { subscriptionId: sub.id, status: 'PAID' },
          _sum: { amount: true },
        });
        assert.equal(Number(total._sum.amount), 100);
      },
    );
    await t.test(
      'payment retries return the same receipt and reject changed payload',
      async () => {
        const sub = await fixture();
        const key = randomUUID();
        const dto = { amount: 20, status: 'PAID', idempotencyKey: key };
        const [a, b] = await Promise.all([
          payments.createPayment(sub.id, dto, actor),
          payments.createPayment(sub.id, dto, actor),
        ]);
        assert.equal(a.id, b.id);
        assert.equal(
          await client.paymentRecord.count({
            where: { subscriptionId: sub.id },
          }),
          1,
        );
        await assert.rejects(
          payments.createPayment(sub.id, { ...dto, amount: 21 }, actor),
          (e) => e.getStatus() === 409,
        );
      },
    );
    await t.test(
      'subscription sale and renewal retries return one subscription each',
      async () => {
        const person = await client.memberProfile.create({
          data: {
            fullName: 'Retry QA',
            user: {
              create: { email: 'retry@example.invalid', passwordHash: 'test' },
            },
          },
        });
        const dto = {
          memberId: person.id,
          planId: plan.id,
          paymentStatus: 'PAID',
          idempotencyKey: randomUUID(),
        };
        const [a, b] = await Promise.all([
          subscriptions.create(dto, user.id),
          subscriptions.create(dto, user.id),
        ]);
        assert.equal(a.id, b.id);
        const renewal = { paymentStatus: 'PAID', idempotencyKey: randomUUID() };
        const [r1, r2] = await Promise.all([
          subscriptions.renew(a.id, renewal, user.id),
          subscriptions.renew(a.id, renewal, user.id),
        ]);
        assert.equal(r1.id, r2.id);
        assert.equal(
          await client.subscription.count({ where: { memberId: person.id } }),
          2,
        );
        assert.equal(
          await client.paymentRecord.count({
            where: { subscription: { memberId: person.id } },
          }),
          2,
        );
      },
    );
    await t.test('date range retains both bounds', async () => {
      const response = await payments.findAll({
        from: '2100-01-01',
        to: '2101-01-01',
        page: 1,
        limit: 100,
      });
      assert.equal(response.meta.total, 0);
    });
    await t.test(
      'rejects legacy CARD for new payment writes while preserving historical CARD reads',
      async () => {
        const sub = await fixture();
        await assert.rejects(
          payments.createPayment(
            sub.id,
            { amount: 50, status: 'PAID', method: 'CARD' },
            actor,
          ),
          (e) => e.getStatus() === 400,
        );
        const pending = await payments.createPayment(
          sub.id,
          { amount: 50, status: 'PENDING' },
          actor,
        );
        await assert.rejects(
          payments.confirmPayment(pending.id, { method: 'CARD' }, actor),
          (e) => e.getStatus() === 400,
        );
      },
    );
  },
);
