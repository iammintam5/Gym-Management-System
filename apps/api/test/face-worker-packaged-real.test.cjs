const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FaceWorkerController,
} = require('../dist/modules/face-recognition/runtime/face-worker-controller.cjs');
const {
  buildRealAndSyntheticFixtures,
} = require('./face-worker-poc/fixture-helpers.cjs');

test(
  'built API worker loads its own assets and validates original and mirrored face descriptors',
  { timeout: 90000 },
  async (t) => {
    const fixtures = await buildRealAndSyntheticFixtures();
    const pool = new FaceWorkerController({
      defaultTimeoutMs: 45000,
      maxQueueSize: 0,
    });
    t.after(() => pool.shutdown());
    const warm = await pool.warmup();
    assert.match(warm.descriptorVersion, /^face128-[a-f0-9]{64}$/);
    const face = await pool.analyzePhoto(fixtures.singleFaceDataUrl);
    assert.equal(face.faceCount, 1);
    assert.equal(face.descriptorVersion, warm.descriptorVersion);
    for (const vector of [face.descriptor, face.mirroredDescriptor]) {
      assert.equal(vector.length, 128);
      assert.ok(vector.every(Number.isFinite));
    }
    assert.equal(face.tensorStats.tensorDelta, 0);
    const blank = await pool.analyzePhoto(fixtures.blankDataUrl);
    assert.equal(blank.descriptor, null);
    assert.equal(blank.mirroredDescriptor, null);
    const multi = await pool.analyzePhoto(fixtures.multiFaceDataUrl);
    assert.ok(multi.faceCount > 1);
    assert.equal(multi.descriptor, null);
    assert.equal(multi.mirroredDescriptor, null);
    await assert.rejects(pool.analyzePhoto(fixtures.overPixelBudgetDataUrl), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(pool.analyzePhoto('data:image/jpeg;base64,YQ=='), {
      code: 'INVALID_INPUT',
    });
  },
);
