'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
} = require('node:timers');
const sharp = require('sharp');
const ts = require('typescript');

const {
  FaceWorkerController,
  FaceWorkerError,
} = require('./face-worker-controller.cjs');
const {
  PORTRAIT_WIDTH,
  PORTRAIT_HEIGHT,
  DESCRIPTOR_LENGTH,
  resolveDefaultPaths,
  createVmFaceRuntime,
} = require('./face-runtime-core.cjs');
const {
  buildRealAndSyntheticFixtures,
  l2Distance,
  maxAbsDiff,
} = require('./fixture-helpers.cjs');

function loadTranspiledWebModules(vmFaceRuntime) {
  const { webRoot } = resolveDefaultPaths();
  const webRequire = createRequire(path.join(webRoot, 'package.json'));
  const jpegJs = webRequire('jpeg-js');

  const faceMatchExports = {};
  const faceMatchCode = ts.transpileModule(
    fs.readFileSync(
      path.join(webRoot, 'src/features/checkins/face-match.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(faceMatchCode, {
    exports: faceMatchExports,
    Float32Array,
    Number,
  });

  const trainedExports = {};
  const trainedCode = ts.transpileModule(
    fs.readFileSync(
      path.join(webRoot, 'src/lib/trained-face-recognition.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(trainedCode, {
    exports: trainedExports,
    require: () => vmFaceRuntime.faceapi,
    setTimeout: (...args) => {
      const timer = setTimeout(...args);
      timer.unref();
      return timer;
    },
    clearTimeout,
  });

  return {
    jpegJs,
    selectFaceMatch: faceMatchExports.selectFaceMatch,
    trainedFaceRecognition: trainedExports,
  };
}

test(
  'real worker fixture validation, main-thread heartbeat responsiveness, tensor stability, and web helper parity',
  { timeout: 180_000 },
  async (t) => {
    const vmRuntime = await createVmFaceRuntime();
    t.after(() => vmRuntime.dispose());

    const fixtures = await buildRealAndSyntheticFixtures(vmRuntime);
    assert.ok(
      fixtures.upstreamFaceCount > 1,
      'upstream sample1.jpg should contain multiple faces requiring one-face crop',
    );

    const controller = new FaceWorkerController({
      maxQueueSize: 4,
      defaultTimeoutMs: 60_000,
    });
    t.after(() => controller.shutdown());

    let firstOneFaceResult = null;

    await t.test(
      'warmup loads tinyFaceDetector + faceLandmark68Net + faceRecognitionNet in worker',
      async () => {
        const warm = await controller.warmup();
        assert.equal(warm.backend, 'cpu');
        assert.equal(warm.wasLoaded, false);
        assert.ok(warm.loadTimeMs > 0);
        assert.equal(warm.modelArtifacts.files.length, 6);
        assert.ok(warm.memory.numTensors > 0);
      },
    );

    await t.test(
      'one-face crop normalizes to 360x480 JPEG, yields finite 128D descriptor, leaks zero tensors, and keeps main thread responsive',
      async () => {
        const intervalMs = 20;
        let lastTick = performance.now();
        let tickCount = 0;
        let maxDriftMs = 0;

        const heartbeat = setInterval(() => {
          const now = performance.now();
          const drift = Math.max(0, now - lastTick - intervalMs);
          if (drift > maxDriftMs) {
            maxDriftMs = drift;
          }
          tickCount += 1;
          lastTick = now;
        }, intervalMs);

        let res;
        try {
          res = await controller.analyzePhoto(fixtures.singleFaceDataUrl);
        } finally {
          clearInterval(heartbeat);
        }

        firstOneFaceResult = res;
        assert.equal(res.faceCount, 1);
        assert.ok(res.descriptor instanceof Float32Array);
        assert.equal(res.descriptor.length, DESCRIPTOR_LENGTH);
        assert.ok(res.descriptor.every(Number.isFinite));

        const norm = Math.hypot(...res.descriptor);
        assert.ok(norm > 0.1, '128D face descriptor must be non-trivial');

        // Verify normalized output matches production 360x480 JPEG contract
        assert.ok(res.normalizedDataUrl.startsWith('data:image/jpeg;base64,'));
        const normBytes = Buffer.from(
          res.normalizedDataUrl.slice(res.normalizedDataUrl.indexOf(',') + 1),
          'base64',
        );
        const normMeta = await sharp(normBytes).metadata();
        assert.equal(normMeta.format, 'jpeg');
        assert.equal(normMeta.width, PORTRAIT_WIDTH);
        assert.equal(normMeta.height, PORTRAIT_HEIGHT);

        // Zero leaked tensors in worker
        assert.equal(
          res.tensorStats.tensorDelta,
          0,
          'worker must dispose per-request input/intermediate tensors',
        );

        // Main thread remained responsive throughout multi-second worker inference
        assert.ok(
          tickCount >= 10,
          `expected main-thread heartbeat to fire repeatedly during worker inference (got ${tickCount})`,
        );
        assert.ok(
          maxDriftMs < 250,
          `main thread must remain unblocked while worker runs inference (maxDriftMs=${maxDriftMs.toFixed(1)})`,
        );
      },
    );

    await t.test(
      'blank image and multi-face image return null descriptor without leaking tensors',
      async () => {
        const blankRes = await controller.analyzePhoto(fixtures.blankDataUrl);
        assert.equal(blankRes.faceCount, 0);
        assert.equal(blankRes.descriptor, null);
        assert.equal(blankRes.tensorStats.tensorDelta, 0);

        const multiRes = await controller.analyzePhoto(
          fixtures.multiFaceDataUrl,
        );
        assert.ok(
          multiRes.faceCount > 1,
          `expected multiple faces in uncropped sample1, got ${multiRes.faceCount}`,
        );
        assert.equal(multiRes.descriptor, null);
        assert.equal(multiRes.tensorStats.tensorDelta, 0);
      },
    );

    await t.test(
      'malformed, remote, unsupported, over-byte-budget, and over-pixel-budget inputs are rejected',
      async () => {
        // 1. Non-image string & external URL
        for (const badInput of [
          '',
          'not-an-image',
          'https://example.test/remote.jpg',
          'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=',
          'data:image/jpeg;base64,QUFBQQ==',
        ]) {
          await assert.rejects(
            controller.analyzePhoto(badInput),
            (err) =>
              err instanceof FaceWorkerError && err.code === 'INVALID_INPUT',
          );
        }

        // 2. Over 200,000-char data URL budget rejected at parent envelope check
        await assert.rejects(
          controller.analyzePhoto(fixtures.overByteBudgetDataUrl),
          (err) =>
            err instanceof FaceWorkerError && err.code === 'INVALID_INPUT',
        );

        // 3. Over 200,000-char data URL budget ALSO rejected inside worker if submitted directly
        await assert.rejects(
          controller.submit({
            type: 'analyze',
            photo: fixtures.overByteBudgetDataUrl,
          }),
          (err) =>
            err instanceof FaceWorkerError && err.code === 'INVALID_INPUT',
        );

        // 4. Over 4,000,000-pixel budget (2100x2100 solid JPEG < 20KB base64) rejected inside worker by sharp
        assert.ok(fixtures.overPixelBudgetDataUrl.length < 200_000);
        await assert.rejects(
          controller.analyzePhoto(fixtures.overPixelBudgetDataUrl),
          (err) =>
            err instanceof FaceWorkerError && err.code === 'INVALID_INPUT',
        );

        // 5. alreadyNormalized=true rejects valid JPEG whose dimensions are not 360x480
        const wrongSizeJpeg = await sharp({
          create: {
            width: 200,
            height: 200,
            channels: 3,
            background: '#444444',
          },
        })
          .jpeg()
          .toBuffer();
        await assert.rejects(
          controller.analyzePhoto(
            `data:image/jpeg;base64,${wrongSizeJpeg.toString('base64')}`,
            { alreadyNormalized: true },
          ),
          (err) =>
            err instanceof FaceWorkerError && err.code === 'INVALID_INPUT',
        );
      },
    );

    await t.test(
      'model parity: worker descriptor matches browser-bundle CPU helper on normalized 360x480 portrait',
      async () => {
        assert.ok(
          firstOneFaceResult,
          'expected one-face result from prior subtest',
        );
        const { jpegJs, selectFaceMatch, trainedFaceRecognition } =
          loadTranspiledWebModules(vmRuntime);

        // Re-evaluating the stored normalized 360x480 JPEG in worker with alreadyNormalized=true is bit-identical
        const normalizedRepeat = await controller.analyzePhoto(
          firstOneFaceResult.normalizedDataUrl,
          { alreadyNormalized: true },
        );
        assert.equal(normalizedRepeat.faceCount, 1);
        assert.equal(normalizedRepeat.tensorStats.tensorDelta, 0);
        assert.equal(
          maxAbsDiff(
            firstOneFaceResult.descriptor,
            normalizedRepeat.descriptor,
          ),
          0,
        );

        const normalizedJpegBytes = Buffer.from(
          firstOneFaceResult.normalizedDataUrl.slice(
            firstOneFaceResult.normalizedDataUrl.indexOf(',') + 1,
          ),
          'base64',
        );

        const release = trainedFaceRecognition.retainFaceRecognizer();
        try {
          // Parity Check A: Identical sharp-decoded 360x480 RGB pixels + identical weights
          const { data: sharpRgb } = await sharp(normalizedJpegBytes)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

          const sharpFloats = new vmRuntime.RuntimeFloat32Array(
            sharpRgb.length,
          );
          for (let i = 0; i < sharpRgb.length; i++) {
            sharpFloats[i] = sharpRgb[i];
          }
          const sharpTensor = vmRuntime.faceapi.tf.tensor3d(sharpFloats, [
            PORTRAIT_HEIGHT,
            PORTRAIT_WIDTH,
            3,
          ]);
          try {
            const webHelperSamePixels =
              await trainedFaceRecognition.describeFace(sharpTensor);
            assert.equal(webHelperSamePixels.faceCount, 1);
            assert.equal(
              webHelperSamePixels.descriptor.length,
              DESCRIPTOR_LENGTH,
            );
            assert.equal(
              maxAbsDiff(
                firstOneFaceResult.descriptor,
                webHelperSamePixels.descriptor,
              ),
              0,
              'worker and trained-face-recognition.ts must produce bit-identical 128D descriptors on identical RGB pixels and CPU backend',
            );
            assert.equal(
              l2Distance(
                firstOneFaceResult.descriptor,
                webHelperSamePixels.descriptor,
              ),
              0,
            );
          } finally {
            sharpTensor.dispose();
          }

          // Parity Check B: Cross-JPEG-decoder check (sharp/libjpeg-turbo vs jpeg-js) on same 360x480 JPEG bytes
          const jpegDecoded = jpegJs.decode(normalizedJpegBytes, {
            useTArray: true,
          });
          assert.equal(jpegDecoded.width, PORTRAIT_WIDTH);
          assert.equal(jpegDecoded.height, PORTRAIT_HEIGHT);

          const jpegJsFloats = new vmRuntime.RuntimeFloat32Array(
            PORTRAIT_WIDTH * PORTRAIT_HEIGHT * 3,
          );
          for (let px = 0; px < PORTRAIT_WIDTH * PORTRAIT_HEIGHT; px++) {
            jpegJsFloats[px * 3] = jpegDecoded.data[px * 4];
            jpegJsFloats[px * 3 + 1] = jpegDecoded.data[px * 4 + 1];
            jpegJsFloats[px * 3 + 2] = jpegDecoded.data[px * 4 + 2];
          }
          const jpegJsTensor = vmRuntime.faceapi.tf.tensor3d(jpegJsFloats, [
            PORTRAIT_HEIGHT,
            PORTRAIT_WIDTH,
            3,
          ]);
          try {
            const webHelperJpegJs =
              await trainedFaceRecognition.describeFace(jpegJsTensor);
            assert.equal(webHelperJpegJs.faceCount, 1);
            const decoderDist = l2Distance(
              firstOneFaceResult.descriptor,
              webHelperJpegJs.descriptor,
            );
            assert.ok(Number.isFinite(decoderDist) && decoderDist >= 0);
            // Validate compatibility strictly via the existing production selectFaceMatch rule
            // without inventing new biometric thresholds.
            const matched = selectFaceMatch(firstOneFaceResult.descriptor, [
              { member: 'same-person', descriptor: webHelperJpegJs.descriptor },
            ]);
            assert.equal(matched?.member, 'same-person');
          } finally {
            jpegJsTensor.dispose();
          }
        } finally {
          release();
        }
      },
    );
  },
);
