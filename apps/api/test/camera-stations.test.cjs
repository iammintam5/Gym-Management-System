require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const {
  Module,
  ValidationPipe,
  BadRequestException,
} = require('@nestjs/common');
const { NestFactory, APP_GUARD, Reflector } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ConfigService } = require('@nestjs/config');
const { CAMERA_STATION_RULES: rules } = require('@gym/contracts');
const {
  CameraStationsService,
} = require('../dist/modules/checkins/camera-stations.service');
const {
  CameraStationsController,
} = require('../dist/modules/checkins/camera-stations.controller');
const {
  CheckinsService,
} = require('../dist/modules/checkins/checkins.service');
const { DatabaseService } = require('../dist/modules/database/database.module');
const sharp = require('sharp');
const { JwtAuthGuard } = require('../dist/common/guards/jwt-auth.guard');
const { RolesGuard } = require('../dist/common/guards/roles.guard');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../dist/common/constants/auth');

const memberId = '32f617c9-e116-407d-a0e4-40a907f2cfe8';
const userId = 'cbe98f44-ebcb-4f62-b8d1-ae70f6bc8450';
const photo = 'data:image/jpeg;base64,/9j/2Q==';
const result = {
  id: 'eeb53bbb-f43c-43df-87f8-4cf3281c24c8',
  memberId,
  memberCode: 'HV001',
  memberFullName: 'Camera Test',
  memberIdPhotoUrl: 'https://example.test/original.jpg',
  subscriptionId: null,
  planName: null,
  quotaId: null,
  status: 'REJECTED',
  rejectionReason: 'No active subscription',
  checkedInAt: new Date().toISOString(),
  recordedBy: userId,
  recordedByName: 'Staff',
};

test('station isolation, offline timeout, portrait expiration while heartbeat continues', () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const service = new CameraStationsService();
    service.publish('desk-a', result, photo);
    assert.equal(service.read('desk-a').latest.capturedPhoto, photo);
    assert.equal(
      service.read('desk-a').latest.checkin.memberIdPhotoUrl,
      result.memberIdPhotoUrl,
    );
    assert.equal(service.read('desk-b').latest, null);
    now += rules.onlineTimeoutMs + 1;
    assert.equal(service.read('desk-a').online, false);
    service.heartbeat('desk-a');
    assert.equal(service.read('desk-a').online, true);
    now += rules.imageRetentionMs - rules.onlineTimeoutMs;
    service.heartbeat('desk-a');
    assert.equal(service.read('desk-a').latest, null);
    assert.equal(service.read('desk-a').online, true);
  } finally {
    Date.now = originalNow;
  }
});

test('station storage evicts old stations at the configured bound', () => {
  const service = new CameraStationsService();
  for (let index = 0; index <= rules.maxStations; index++)
    service.publish(`desk-${index}`, result, photo);
  assert.equal(service.read('desk-0').latest, null);
  assert.equal(
    service.read(`desk-${rules.maxStations}`).latest.capturedPhoto,
    photo,
  );
});

test('camera HTTP endpoints preserve authentication, validation and server check-in decisions', async (t) => {
  const photo =
    'data:image/jpeg;base64,' +
    (
      await sharp({
        create: { width: 360, height: 480, channels: 3, background: '#888888' },
      })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  const secret = randomBytes(48).toString('hex');
  const jwt = new JwtService();
  const calls = [];
  let fail = false;
  class TestModule {}
  Module({
    controllers: [CameraStationsController],
    providers: [
      CameraStationsService,
      {
        provide: DatabaseService,
        useValue: {
          client: {
            memberProfile: {
              findMany: async () => [],
              findFirst: async () => null,
            },
          },
        },
      },
      Reflector,
      {
        provide: CheckinsService,
        useValue: {
          recordCheckin: async (dto, staffId) => {
            if (fail) throw new BadRequestException('Check-in failed');
            calls.push({ dto, staffId });
            return result;
          },
        },
      },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, {
    logger: false,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const token = (role) =>
    jwt.sign(
      { sub: userId, type: 'access', roles: [role] },
      {
        secret,
        algorithm: 'HS256',
        expiresIn: '5m',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
  const request = (path, role, body) =>
    fetch(`${base}/api/checkins/camera${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(role ? { Authorization: `Bearer ${token(role)}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body
        ? {
            body: JSON.stringify(
              body.memberId
                ? {
                    idempotencyKey: 'test-request-0001',
                    photoVersion: 'a'.repeat(32),
                    ...body,
                  }
                : body,
            ),
          }
        : {}),
    });
  assert.equal((await request('/desk', null)).status, 401);
  for (const role of ['MEMBER', 'PT']) {
    assert.equal((await request('/desk', role)).status, 403);
    assert.equal(
      (
        await request('', role, {
          stationId: 'desk',
          memberId,
          capturedPhoto: photo,
        })
      ).status,
      403,
    );
  }
  for (const role of ['STAFF', 'ADMIN'])
    assert.equal((await request('/desk', role)).status, 200);
  assert.equal((await request('/desk/heartbeat', 'STAFF', {})).status, 200);
  assert.equal((await request('/bad.station', 'STAFF')).status, 400);
  for (const change of [
    { memberId: 'invalid' },
    { stationId: '../bad' },
    { capturedPhoto: 'https://example.test/photo.jpg' },
    {
      capturedPhoto: `data:image/jpeg;base64,${'A'.repeat(rules.maxImageLength)}`,
    },
    { unexpected: true },
  ])
    assert.equal(
      (
        await request('', 'STAFF', {
          stationId: 'desk',
          memberId,
          capturedPhoto: photo,
          ...change,
        })
      ).status,
      400,
    );
  const posted = await request('', 'STAFF', {
    stationId: 'desk',
    memberId,
    capturedPhoto: photo,
  });
  assert.equal(posted.status, 200);
  assert.deepEqual(await posted.json(), result);
  assert.deepEqual(calls, [
    {
      dto: {
        memberId,
        gateIdentifier: 'desk',
        idempotencyKey: 'test-request-0001',
        photoVersion: 'a'.repeat(32),
      },
      staffId: userId,
    },
  ]);
  const read = await request('/desk', 'STAFF');
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const state = await read.json();
  assert.equal(state.latest.capturedPhoto, photo);
  assert.equal(state.latest.checkin.status, 'REJECTED');
  assert.equal(state.latest.checkin.memberIdPhotoUrl, result.memberIdPhotoUrl);
  assert.equal(
    (await (await request('/other-desk', 'STAFF')).json()).latest,
    null,
  );
  fail = true;
  assert.equal(
    (
      await request('', 'STAFF', {
        stationId: 'failed-desk',
        memberId,
        capturedPhoto: photo,
      })
    ).status,
    400,
  );
  assert.equal(
    (await (await request('/failed-desk', 'STAFF')).json()).latest,
    null,
  );
});
