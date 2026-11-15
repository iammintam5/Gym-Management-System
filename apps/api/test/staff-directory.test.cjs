require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPrismaClient } = require('@gym/database');
const { MembersService } = require('../dist/modules/members/members.service');
const {
  SubscriptionsService,
} = require('../dist/modules/subscriptions/subscriptions.service');
const {
  PaymentsService,
} = require('../dist/modules/payments/payments.service');
const {
  SubscriptionFreezesService,
} = require('../dist/modules/subscription-freezes/subscription-freezes.service');
const { localPostgres } = require('./local-postgres.cjs');

test(
  'staff directory pagination, searching and complete statistics',
  { timeout: 120000 },
  async (t) => {
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    const users = Array.from({ length: 140 }, (_, i) => ({
      id: randomUUID(),
      email: `directory-${i}@example.invalid`,
      passwordHash: 'test',
    }));
    await client.user.createMany({ data: users });
    const profiles = users.map((user, i) => ({
      id: randomUUID(),
      userId: user.id,
      fullName: `Directory ${String(i).padStart(3, '0')}`,
      idPhotoUrl: `private-photo-${i}`,
    }));
    await client.memberProfile.createMany({ data: profiles });
    const service = new MembersService(
      { client },
      {},
      new SubscriptionsService({ client }),
    );
    const payments = new PaymentsService({ client });
    const freezes = new SubscriptionFreezesService({ client });
    const last = profiles[139];
    const code = 'MEM-' + last.id.replaceAll('-', '').slice(0, 8).toUpperCase();
    const plan = await client.membershipPlan.create({
      data: { name: 'Directory Plan', price: 100, durationDays: 30 },
    });
    const sub = await client.subscription.create({
      data: {
        memberId: last.id,
        planId: plan.id,
        agreedPrice: 100,
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        startDate: new Date(Date.now() - 86400000),
        endDate: new Date(Date.now() + 86400000),
      },
    });
    await t.test(
      'directory returns only the requested page and searches by member code',
      async () => {
        const page = await service.directory({
          page: 14,
          limit: 10,
          directoryStatus: 'All',
        });
        assert.equal(page.meta.total, 140);
        assert.equal(page.data.length, 10);
        assert.equal(new Set(page.data.map((m) => m.id)).size, 10);
        const result = await service.directory({
          page: 1,
          limit: 10,
          search: code,
        });
        assert.equal(result.meta.total, 1);
        assert.equal(result.data[0].id, last.id);
        assert.equal(result.subscriptions[0].id, sub.id);
        const active = await service.directory({
          page: 1,
          limit: 10,
          directoryStatus: 'Active',
        });
        assert.equal(active.meta.total, 1);
        assert.equal(active.data[0].id, last.id);
        const light = await service.findAll({
          page: 1,
          limit: 100,
          includePhoto: false,
        });
        assert.ok(light.data.every((member) => member.idPhotoUrl === null));
        assert.ok(
          (await client.memberProfile.findUnique({ where: { id: last.id } }))
            .idPhotoUrl,
        );
      },
    );
    await client.subscriptionFreeze.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        subscriptionId: sub.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 9 * 86400000),
        freezeDays: 8,
        status: i < 90 ? 'COMPLETED' : i < 100 ? 'REJECTED' : 'APPROVED',
      })),
    });
    await t.test(
      'freeze statistics use the complete history and scheduled/rejected filters remain distinct',
      async () => {
        const stats = await freezes.statistics();
        assert.equal(stats.restored, 90);
        assert.equal(stats.frozen, 0);
        const scheduled = await freezes.findAll(
          { page: 2, limit: 10, phase: 'Scheduled' },
          { id: users[0].id, roles: ['STAFF'] },
        );
        assert.equal(scheduled.meta.total, 20);
        assert.equal(scheduled.data.length, 10);
        const rejected = await freezes.findAll(
          { page: 1, limit: 10, phase: 'Rejected' },
          { id: users[0].id, roles: ['STAFF'] },
        );
        assert.equal(rejected.meta.total, 10);
        assert.ok(rejected.data.every((item) => item.status === 'REJECTED'));
      },
    );
    await client.paymentRecord.createMany({
      data: Array.from({ length: 100 }, () => ({
        subscriptionId: sub.id,
        amount: 1,
        status: 'PAID',
        currency: 'VND',
      })),
    });
    await t.test(
      'payment search and pagination include records beyond the first fifty',
      async () => {
        const result = await payments.findAll({
          page: 10,
          limit: 10,
          search: code,
        });
        assert.equal(result.meta.total, 100);
        assert.equal(result.data.length, 10);
        const receipt = result.data[0];
        const match = await payments.findAll({
          page: 1,
          limit: 10,
          search: `REC-20261112-${receipt.id.slice(0, 8).toUpperCase()}`,
        });
        assert.equal(match.meta.total, 1);
        assert.equal(match.data[0].id, receipt.id);
      },
    );
    await t.test(
      'cashier reconciliation uses Vietnam day boundaries and the selected cashier',
      async () => {
        await client.paymentRecord.createMany({
          data: [
            {
              subscriptionId: sub.id,
              amount: 10,
              status: 'PAID',
              method: 'CASH',
              confirmedBy: users[0].id,
              confirmedAt: new Date('2026-11-11T17:00:00Z'),
            },
            {
              subscriptionId: sub.id,
              amount: 20,
              status: 'PAID',
              method: 'CARD',
              confirmedBy: users[0].id,
              confirmedAt: new Date('2026-11-12T16:59:59Z'),
            },
            {
              subscriptionId: sub.id,
              amount: 40,
              status: 'PAID',
              method: 'CASH',
              confirmedBy: users[0].id,
              confirmedAt: new Date('2026-11-12T17:00:00Z'),
            },
            {
              subscriptionId: sub.id,
              amount: 80,
              status: 'PAID',
              method: 'CASH',
              confirmedBy: users[1].id,
              confirmedAt: new Date('2026-11-12T08:00:00Z'),
            },
          ],
        });
        const result = await payments.reconcile({
          date: '2026-11-12',
          cashierId: users[0].id,
        });
        assert.equal(result.transactionCount, 2);
        assert.equal(result.totalRevenue, 30);
        assert.equal(result.cashRevenue, 10);
        assert.equal(result.cardRevenue, 20);
      },
    );
  },
);
