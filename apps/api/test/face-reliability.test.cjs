require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Logger } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const bcrypt = require('bcryptjs');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../dist/common/constants/auth');
const { createPrismaClient } = require('@gym/database');
const {
  CheckinsService,
} = require('../dist/modules/checkins/checkins.service');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { MembersService } = require('../dist/modules/members/members.service');
const {
  CameraStationsController,
} = require('../dist/modules/checkins/camera-stations.controller');
const {
  CameraStationsService,
} = require('../dist/modules/checkins/camera-stations.service');
const {
  normalizeMemberPhoto,
  validateCameraPortrait,
} = require('../dist/modules/common/member-photo');
const sharp = require('sharp');
const { localPostgres } = require('./local-postgres.cjs');

test(
  'face check-in reliability with real isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    Logger.overrideLogger(false);
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    const actor = await client.user.create({
      data: { email: 'staff@example.test', passwordHash: 'test-only' },
    });
    const role = await client.role.create({
      data: { code: 'STAFF', name: 'Staff' },
    });
    await client.userRoleAssignment.create({
      data: { userId: actor.id, roleId: role.id },
    });
    const serviceType = await client.serviceType.create({
      data: { code: 'GYM_ACCESS', name: 'Gym' },
    });
    const plan = await client.membershipPlan.create({
      data: { name: 'Test', durationDays: 30, price: 100 },
    });
    const service = new CheckinsService({ client });
    async function fixture(paymentStatus = 'PAID', reserved = 0) {
      const member = await client.memberProfile.create({
        data: {
          fullName: 'Test Member',
          facePhotoVersion: 'a'.repeat(32),
          user: {
            create: {
              email: `${randomUUID()}@example.test`,
              passwordHash: 'test-only',
            },
          },
        },
      });
      const sub = await client.subscription.create({
        data: {
          memberId: member.id,
          planId: plan.id,
          startDate: new Date(Date.now() - 86400000),
          endDate: new Date(Date.now() + 86400000),
          status: 'ACTIVE',
          paymentStatus,
          agreedPrice: 100,
          quotas: {
            create: { serviceTypeId: serviceType.id, allocated: 1, reserved },
          },
        },
        include: { quotas: true },
      });
      return { member, sub, quota: sub.quotas[0] };
    }
    await t.test(
      'two simultaneous cameras consume the final quota only once',
      async () => {
        const f = await fixture();
        const results = await Promise.all(
          [1, 2].map(() =>
            service.recordCheckin(
              {
                memberId: f.member.id,
                idempotencyKey: randomUUID(),
                gateIdentifier: 'phone',
                photoVersion: 'a'.repeat(32),
              },
              actor.id,
            ),
          ),
        );
        assert.equal(
          results.filter((item) => item.status === 'ACCEPTED').length,
          1,
        );
        assert.equal(
          (
            await client.subscriptionQuota.findUnique({
              where: { id: f.quota.id },
            })
          ).used,
          1,
        );
        assert.equal(
          await client.quotaTransaction.count({
            where: { quotaId: f.quota.id },
          }),
          1,
        );
      },
    );
    await t.test(
      'retrying the same request returns the same result and ledger',
      async () => {
        const f = await fixture();
        const dto = {
          memberId: f.member.id,
          idempotencyKey: randomUUID(),
          gateIdentifier: 'phone',
          photoVersion: 'a'.repeat(32),
        };
        const [one, two] = await Promise.all([
          service.recordCheckin(dto, actor.id),
          service.recordCheckin(dto, actor.id),
        ]);
        assert.equal(one.id, two.id);
        assert.equal(
          await client.checkin.count({ where: { memberId: f.member.id } }),
          1,
        );
        assert.equal(
          (
            await client.subscriptionQuota.findUnique({
              where: { id: f.quota.id },
            })
          ).used,
          1,
        );
        await assert.rejects(
          service.recordCheckin(
            { ...dto, gateIdentifier: 'different' },
            actor.id,
          ),
          /Mã yêu cầu/,
        );
      },
    );
    await t.test(
      'refunded and reserved quota cannot grant access',
      async () => {
        for (const [payment, reserved] of [
          ['REFUNDED', 0],
          ['PAID', 1],
        ]) {
          const f = await fixture(payment, reserved);
          assert.equal(
            (await service.recordCheckin({ memberId: f.member.id }, actor.id))
              .status,
            'REJECTED',
          );
          assert.equal(
            (
              await client.subscriptionQuota.findUnique({
                where: { id: f.quota.id },
              })
            ).used,
            0,
          );
        }
      },
    );
    await t.test(
      'a stale photo version is rejected before creating a check-in',
      async () => {
        const f = await fixture();
        await assert.rejects(
          service.recordCheckin(
            { memberId: f.member.id, photoVersion: 'b'.repeat(32) },
            actor.id,
          ),
          /Ảnh hồ sơ/,
        );
        assert.equal(
          await client.checkin.count({ where: { memberId: f.member.id } }),
          0,
        );
      },
    );
    await t.test(
      'photo changes and deletion update the thin roster',
      async () => {
        const f = await fixture();
        // This roster test isolates persistence. Actual inference has packaged-real coverage.
        const {
          FaceEnrollmentService,
        } = require('../dist/modules/face-recognition/face-enrollment.service');
        const { ConfigService } = require('@nestjs/config');
        const recognizer = {
          modelVersion: 'roster-test',
          async prepare(photo) {
            const normalized = await normalizeMemberPhoto(photo);
            return {
              photo: normalized,
              photoVersion: createHash('md5').update(normalized).digest('hex'),
              descriptor: Array(128).fill(0),
              mirroredDescriptor: Array(128).fill(0),
              modelVersion: this.modelVersion,
            };
          },
        };
        const members = new MembersService(
          { client },
          new FaceEnrollmentService(recognizer, new ConfigService()),
        );
        const image = await sharp({
          create: { width: 360, height: 480, channels: 3, background: '#999' },
        })
          .jpeg()
          .toBuffer();
        await members.update(f.member.id, {
          idPhotoUrl: `data:image/jpeg;base64,${image.toString('base64')}`,
        });
        const stored = await client.memberProfile.findUnique({
          where: { id: f.member.id },
        });
        assert.ok(
          stored.facePhotoVersion && stored.facePhotoVersion !== 'a'.repeat(32),
        );
        const stations = new CameraStationsService();
        try {
          const controller = new CameraStationsController(service, stations, {
            client,
          });
          const entry = (await controller.roster()).find(
            (item) => item.id === f.member.id,
          );
          assert.equal(entry.photoVersion, stored.facePhotoVersion);
          assert.equal(entry.idPhotoUrl, undefined);
          assert.equal(
            (await controller.photo(f.member.id)).idPhotoUrl,
            stored.idPhotoUrl,
          );
          await members.update(f.member.id, { idPhotoUrl: null });
          const cleared = await client.memberProfile.findUnique({
            where: { id: f.member.id },
          });
          assert.equal(cleared.idPhotoUrl, null);
          assert.equal(cleared.facePhotoVersion, null);
          assert.equal(
            (await controller.roster()).some((item) => item.id === f.member.id),
            false,
          );
        } finally {
          stations.onModuleDestroy();
        }
      },
    );
    await t.test(
      'phone and desk refresh sessions rotate independently',
      async () => {
        const config = {
          JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
          JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
        };
        const auth = new AuthService({ client }, new JwtService(), {
          getOrThrow: (key) => config[key],
          get: (key, fallback) => config[key] ?? fallback,
        });
        const phone = await auth.generateTokens(actor.id, ['STAFF']);
        const desk = await auth.generateTokens(actor.id, ['STAFF']);
        const legacy = new JwtService().sign(
          { sub: actor.id, jti: randomUUID(), type: 'refresh' },
          {
            secret: config.JWT_REFRESH_SECRET,
            expiresIn: '5m',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
          },
        );
        await client.user.update({
          where: { id: actor.id },
          data: {
            refreshTokenHash: await bcrypt.hash(
              createHash('sha256').update(legacy).digest('hex'),
              10,
            ),
          },
        });
        const migrated = await auth.refresh({ refreshToken: legacy });
        assert.ok(new JwtService().decode(migrated.accessToken).sid);
        await assert.rejects(auth.refresh({ refreshToken: legacy }));
        await auth.logout(actor.id); // Legacy logout must not revoke the new phone/desk sessions.
        const nextPhone = await auth.refresh({
          refreshToken: phone.refreshToken,
        });
        const nextDesk = await auth.refresh({
          refreshToken: desk.refreshToken,
        });
        await assert.rejects(
          auth.refresh({ refreshToken: phone.refreshToken }),
        );
        const sid = new JwtService().decode(nextPhone.accessToken).sid;
        await auth.logout(actor.id, sid);
        await assert.rejects(
          auth.refresh({ refreshToken: nextPhone.refreshToken }),
        );
        assert.ok(
          (await auth.refresh({ refreshToken: nextDesk.refreshToken }))
            .accessToken,
        );
      },
    );
  },
);

test('photo normalization rejects fake, remote and oversized raster images', async () => {
  await assert.rejects(normalizeMemberPhoto('not-an-image'));
  await assert.rejects(normalizeMemberPhoto('https://example.test/photo.jpg'));
  await assert.rejects(
    validateCameraPortrait('data:image/jpeg;base64,QUFBQQ=='),
  );
  const image = await sharp({
    create: { width: 360, height: 480, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeMemberPhoto(
    `data:image/jpeg;base64,${image.toString('base64')}`,
  );
  await validateCameraPortrait(normalized);
  const huge = await sharp({
    create: { width: 2100, height: 2100, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer();
  await assert.rejects(
    normalizeMemberPhoto(`data:image/jpeg;base64,${huge.toString('base64')}`),
  );
});
