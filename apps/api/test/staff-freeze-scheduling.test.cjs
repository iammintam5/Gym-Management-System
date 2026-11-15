require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPrismaClient } = require('@gym/database');
const {
  SubscriptionFreezesService,
} = require('../dist/modules/subscription-freezes/subscription-freezes.service');
const {
  SubscriptionsService,
} = require('../dist/modules/subscriptions/subscriptions.service');
const {
  ClassBookingsService,
} = require('../dist/modules/class-bookings/class-bookings.service');
const {
  PtBookingsService,
} = require('../dist/modules/pt-bookings/pt-bookings.service');
const {
  ClassSchedulesService,
} = require('../dist/modules/class-schedules/class-schedules.service');
const { localPostgres } = require('./local-postgres.cjs');
const DAY = 86400000;

test(
  'staff freezes and scheduling on isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    const staff = await client.user.create({
      data: { email: 'staff@example.invalid', passwordHash: 'test' },
    });
    const actor = { id: staff.id, roles: ['STAFF'] };
    const role = await client.role.create({ data: { code: 'PT', name: 'PT' } });
    async function trainer() {
      return client.employeeProfile.create({
        data: {
          fullName: 'Trainer',
          user: {
            create: {
              email: randomUUID() + '@example.invalid',
              passwordHash: 'test',
              roles: { create: { roleId: role.id } },
            },
          },
        },
      });
    }
    const trainerA = await trainer();
    const trainerB = await trainer();
    const plan = await client.membershipPlan.create({
      data: { name: 'Plan', price: 100, durationDays: 90 },
    });
    const classType = await client.serviceType.create({
      data: { code: 'CLASS', name: 'Class' },
    });
    const ptType = await client.serviceType.create({
      data: { code: 'PT', name: 'PT' },
    });
    const gymClass = await client.gymClass.create({ data: { name: 'Yoga' } });
    const freezeService = new SubscriptionFreezesService({ client });
    const subService = new SubscriptionsService({ client });
    const classes = new ClassBookingsService({ client });
    const pts = new PtBookingsService({ client });
    const schedules = new ClassSchedulesService({ client });
    async function fixture() {
      const member = await client.memberProfile.create({
        data: {
          fullName: 'QA',
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
          startDate: new Date(Date.now() - DAY),
          endDate: new Date(Date.now() + 90 * DAY),
          status: 'ACTIVE',
          paymentStatus: 'PAID',
          agreedPrice: 100,
          quotas: {
            create: [
              { serviceTypeId: classType.id, allocated: 10 },
              { serviceTypeId: ptType.id, allocated: 10 },
            ],
          },
        },
      });
      return { member, sub };
    }
    async function schedule(
      offset = 2,
      capacity = 10,
      trainerId = trainerA.id,
    ) {
      const startsAt = new Date(Date.now() + offset * DAY);
      return client.classSchedule.create({
        data: {
          classId: gymClass.id,
          trainerId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3600000),
          capacity,
        },
      });
    }
    await t.test(
      'concurrent freeze requests create exactly one active request',
      async () => {
        const f = await fixture();
        const dto = {
          startsAt: new Date(Date.now() + DAY).toISOString(),
          endsAt: new Date(Date.now() + 9 * DAY).toISOString(),
          autoApprove: true,
        };
        const results = await Promise.allSettled([
          freezeService.createFreeze(f.sub.id, dto, actor),
          freezeService.createFreeze(f.sub.id, dto, actor),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      },
    );
    await t.test(
      'future restoration adds zero time and early restoration adds only elapsed time once',
      async () => {
        const f = await fixture();
        const startsAt = new Date(Date.now() + DAY);
        const endsAt = new Date(startsAt.getTime() + 8 * DAY);
        const future = await freezeService.createFreeze(
          f.sub.id,
          { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          actor,
        );
        await freezeService.unfreeze(future.id, actor);
        assert.equal(
          (
            await client.subscription.findUnique({ where: { id: f.sub.id } })
          ).endDate.getTime(),
          f.sub.endDate.getTime(),
        );
        const past = new Date(Date.now() - 2 * DAY);
        const freeze = await client.subscriptionFreeze.create({
          data: {
            subscriptionId: f.sub.id,
            startsAt: past,
            endsAt: new Date(past.getTime() + 10 * DAY),
            freezeDays: 10,
            status: 'APPROVED',
          },
        });
        const at = new Date(past.getTime() + 2 * DAY);
        await freezeService.unfreeze(freeze.id, actor, at);
        assert.equal(
          (
            await client.subscription.findUnique({ where: { id: f.sub.id } })
          ).endDate.getTime(),
          f.sub.endDate.getTime() + 2 * DAY,
        );
        await assert.rejects(
          freezeService.unfreeze(freeze.id, actor, at),
          (e) => e.getStatus() === 409,
        );
      },
    );
    await t.test(
      'due approved freezes activate and cancellation prevents later reactivation',
      async () => {
        const f = await fixture();
        const start = new Date(Date.now() + DAY);
        const freeze = await freezeService.createFreeze(
          f.sub.id,
          {
            startsAt: start.toISOString(),
            endsAt: new Date(start.getTime() + 8 * DAY).toISOString(),
          },
          actor,
        );
        await freezeService.activateDueFreezes(
          new Date(start.getTime() + 1000),
        );
        assert.equal(
          (await client.subscription.findUnique({ where: { id: f.sub.id } }))
            .status,
          'SUSPENDED',
        );
        await subService.cancel(f.sub.id, { reason: 'QA' });
        await assert.rejects(freezeService.approveFreeze(freeze.id, actor));
        await assert.rejects(freezeService.unfreeze(freeze.id, actor));
        assert.equal(
          (await client.subscription.findUnique({ where: { id: f.sub.id } }))
            .status,
          'CANCELLED',
        );
      },
    );
    await t.test(
      'unpaid, upcoming and past-date freeze requests are rejected',
      async () => {
        const f = await fixture();
        const dto = {
          startsAt: new Date(Date.now() + DAY).toISOString(),
          endsAt: new Date(Date.now() + 9 * DAY).toISOString(),
        };
        await client.subscription.update({
          where: { id: f.sub.id },
          data: { paymentStatus: 'PENDING' },
        });
        await assert.rejects(freezeService.createFreeze(f.sub.id, dto, actor));
        await client.subscription.update({
          where: { id: f.sub.id },
          data: { paymentStatus: 'PAID', status: 'UPCOMING' },
        });
        await assert.rejects(freezeService.createFreeze(f.sub.id, dto, actor));
        await client.subscription.update({
          where: { id: f.sub.id },
          data: { status: 'ACTIVE' },
        });
        await assert.rejects(
          freezeService.createFreeze(
            f.sub.id,
            {
              startsAt: new Date(Date.now() - DAY).toISOString(),
              endsAt: new Date(Date.now() + 8 * DAY).toISOString(),
            },
            actor,
          ),
        );
      },
    );
    await t.test(
      'concurrent members cannot exceed class capacity',
      async () => {
        const a = await fixture();
        const b = await fixture();
        const slot = await schedule(3, 1);
        const results = await Promise.allSettled([
          classes.createBooking(
            { memberId: a.member.id, scheduleId: slot.id },
            actor,
          ),
          classes.createBooking(
            { memberId: b.member.id, scheduleId: slot.id },
            actor,
          ),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          await client.classBooking.count({
            where: { scheduleId: slot.id, status: 'BOOKED' },
          }),
          1,
        );
      },
    );
    await t.test(
      'member PT and class conflicts are checked in both directions',
      async () => {
        const f = await fixture();
        const slot = await schedule(4);
        await pts.createBooking(
          {
            memberId: f.member.id,
            trainerId: trainerB.id,
            startsAt: slot.startsAt.toISOString(),
            endsAt: slot.endsAt.toISOString(),
          },
          actor,
        );
        await assert.rejects(
          classes.createBooking(
            { memberId: f.member.id, scheduleId: slot.id },
            actor,
          ),
          (e) => e.getStatus() === 409,
        );
        const g = await fixture();
        await classes.createBooking(
          { memberId: g.member.id, scheduleId: slot.id },
          actor,
        );
        await assert.rejects(
          pts.createBooking(
            {
              memberId: g.member.id,
              trainerId: trainerB.id,
              startsAt: slot.startsAt.toISOString(),
              endsAt: slot.endsAt.toISOString(),
            },
            actor,
          ),
          (e) => e.getStatus() === 409,
        );
      },
    );
    await t.test(
      'future attendance and attendance after refund cannot consume quota',
      async () => {
        const f = await fixture();
        const slot = await schedule(5);
        const booking = await classes.createBooking(
          { memberId: f.member.id, scheduleId: slot.id },
          actor,
        );
        await assert.rejects(
          classes.markAttendance(booking.id, { attendance: 'PRESENT' }, actor),
          (e) => e.getStatus() === 400,
        );
        const before = await client.subscriptionQuota.findUnique({
          where: { id: booking.quotaId },
        });
        await client.classSchedule.update({
          where: { id: slot.id },
          data: {
            startsAt: new Date(Date.now() - 3600000),
            endsAt: new Date(Date.now() - 1000),
          },
        });
        await client.subscription.update({
          where: { id: f.sub.id },
          data: { paymentStatus: 'REFUNDED' },
        });
        await assert.rejects(
          classes.markAttendance(booking.id, { attendance: 'PRESENT' }, actor),
          (e) => e.getStatus() === 400,
        );
        assert.deepEqual(
          await client.subscriptionQuota.findUnique({
            where: { id: booking.quotaId },
          }),
          before,
        );
      },
    );
    await t.test(
      'rescheduling rejects conflicts with an enrolled member PT booking',
      async () => {
        const f = await fixture();
        const slot = await schedule(6);
        await classes.createBooking(
          { memberId: f.member.id, scheduleId: slot.id },
          actor,
        );
        const start = new Date(Date.now() + 7 * DAY);
        const end = new Date(start.getTime() + 3600000);
        await pts.createBooking(
          {
            memberId: f.member.id,
            trainerId: trainerB.id,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
          },
          actor,
        );
        await assert.rejects(
          schedules.updateSchedule(
            slot.id,
            { startsAt: start.toISOString(), endsAt: end.toISOString() },
            staff.id,
          ),
          (e) => e.getStatus() === 409,
        );
        assert.equal(
          (
            await client.classSchedule.findUnique({ where: { id: slot.id } })
          ).startsAt.getTime(),
          slot.startsAt.getTime(),
        );
      },
    );
  },
);
