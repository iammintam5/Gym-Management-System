require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const { createPrismaClient } = require('@gym/database');
const { MembersService } = require('../dist/modules/members/members.service');
const {
  FaceEnrollmentService,
} = require('../dist/modules/face-recognition/face-enrollment.service');
const { localPostgres } = require('./local-postgres.cjs');

// Deterministic inference isolates transaction behavior. Packaged-real tests run actual inference.
const recognizer = {
  modelVersion: 'test-model-v1',
  async prepare(photo) {
    const descriptor = Array(128).fill(0);
    descriptor[0] = Number(photo);
    return {
      photo,
      descriptor,
      mirroredDescriptor: [...descriptor],
      modelVersion: this.modelVersion,
      photoVersion: createHash('md5').update(photo).digest('hex'),
    };
  },
};

test(
  'member face enrollment transactions on isolated PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    Logger.overrideLogger(false);
    const local = await localPostgres();
    const client = createPrismaClient(local.url);
    t.after(async () => {
      await client.$disconnect();
      await local.stop();
    });
    await client.role.create({ data: { code: 'MEMBER', name: 'Member' } });
    const faces = new FaceEnrollmentService(recognizer, new ConfigService());
    const members = new MembersService({ client }, faces);
    const create = (email, photo) =>
      members.create({
        email: `${email}@example.invalid`,
        fullName: email,
        idPhotoUrl: photo,
      });
    const rejectsCode = (promise, code) =>
      assert.rejects(promise, (error) => error.getResponse().code === code);
    const a = await create('a', '1');
    const b = await create('b', '3');
    await t.test('duplicate creation rolls back user and profile', async () => {
      await rejectsCode(create('duplicate', '1'), 'DUPLICATE_MEMBER_FACE');
      assert.equal(
        await client.user.count({
          where: { email: 'duplicate@example.invalid' },
        }),
        0,
      );
      assert.equal(
        await client.auditLog.count({
          where: { action: 'MEMBER_PHOTO_REJECTED' },
        }),
        1,
      );
    });
    await t.test(
      'self replacement succeeds and conflicting replacement preserves email/photo/vector',
      async () => {
        await members.update(a.id, { idPhotoUrl: '1' });
        const before = await client.memberProfile.findUnique({
          where: { id: b.id },
          include: { faceDescriptor: true, user: true },
        });
        await rejectsCode(
          members.update(b.id, {
            idPhotoUrl: '1',
            email: 'changed@example.invalid',
          }),
          'DUPLICATE_MEMBER_FACE',
        );
        const after = await client.memberProfile.findUnique({
          where: { id: b.id },
          include: { faceDescriptor: true, user: true },
        });
        assert.deepEqual(after, before);
      },
    );
    await t.test(
      'concurrent enrollment of the same face has one winner',
      async () => {
        const results = await Promise.allSettled([
          create('race-a', '5'),
          create('race-b', '5'),
        ]);
        assert.equal(
          results.filter((item) => item.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          results
            .find((item) => item.status === 'rejected')
            .reason.getResponse().code,
          'DUPLICATE_MEMBER_FACE',
        );
        assert.equal(
          await client.user.count({
            where: {
              email: {
                in: ['race-a@example.invalid', 'race-b@example.invalid'],
              },
            },
          }),
          1,
        );
      },
    );
    await t.test('inactive members retain face ownership', async () => {
      await client.user.update({
        where: { id: a.userId },
        data: { isActive: false },
      });
      await rejectsCode(
        create('inactive-duplicate', '1'),
        'DUPLICATE_MEMBER_FACE',
      );
    });
    await t.test(
      'deleting a photo releases ownership and removes the descriptor',
      async () => {
        await members.update(a.id, { idPhotoUrl: null });
        assert.equal(
          await client.memberFaceDescriptor.findUnique({
            where: { memberId: a.id },
          }),
          null,
        );
        await members.update(b.id, { idPhotoUrl: '1' });
        const audit = await client.auditLog.findMany({
          where: { entityType: 'MEMBER_PHOTO' },
        });
        for (const action of [
          'MEMBER_PHOTO_ENROLLED',
          'MEMBER_PHOTO_REPLACED',
          'MEMBER_PHOTO_DELETED',
        ]) {
          assert.ok(audit.some((item) => item.action === action));
        }
      },
    );
    await t.test(
      'unindexed legacy photos block new enrollment without partial changes',
      async () => {
        const legacy = await create('legacy');
        await client.memberProfile.update({
          where: { id: legacy.id },
          data: { idPhotoUrl: 'legacy-photo', facePhotoVersion: null },
        });
        await rejectsCode(create('unindexed', '7'), 'FACE_INDEX_NOT_READY');
        assert.equal(
          await client.user.count({
            where: { email: 'unindexed@example.invalid' },
          }),
          0,
        );
        await members.update(legacy.id, { idPhotoUrl: null });
        await create('indexed', '7');
      },
    );
  },
);
