const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

test('an original single-face portrait remains valid when mirrored detection misses', async () => {
  let listener;
  let response;
  let calls = 0;
  const descriptor = new Float32Array(128).fill(0.1);
  const runtime = {
    descriptorVersion: 'test',
    faceapi: { tf: { memory: () => ({ numTensors: 10, numBytes: 100 }) } },
  };
  const code = fs.readFileSync(
    path.join(
      __dirname,
      '../src/modules/face-recognition/runtime/face-worker.cjs',
    ),
    'utf8',
  );
  vm.runInNewContext(code, {
    Buffer,
    require(name) {
      if (name === 'node:worker_threads')
        return {
          parentPort: {
            on(_name, callback) {
              listener = callback;
            },
            postMessage(message) {
              response = message;
            },
          },
          threadId: 1,
        };
      if (name === 'node:perf_hooks') return { performance };
      if (name === './face-runtime-core.cjs')
        return {
          FaceInputValidationError: class extends Error {},
          createVmFaceRuntime: async () => runtime,
          normalizeAndDecodePortrait: async () => ({
            rgbBuffer: Buffer.alloc(360 * 480 * 3),
            normalizedDataUrl: 'normalized',
          }),
          describeRgbPortrait: async () => ({
            faceCount: ++calls === 1 ? 1 : 0,
            descriptor: calls === 1 ? descriptor : null,
            timings: {},
          }),
        };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  await listener({ taskId: 1, payload: { type: 'analyze', photo: 'test' } });
  assert.equal(response.ok, true);
  assert.equal(response.result.faceCount, 1);
  assert.equal(response.result.mirroredDescriptor, descriptor);
  assert.equal(response.result.tensorStats.tensorDelta, 0);
});
