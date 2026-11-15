'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const {
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
} = require('node:timers');
const { setTimeout: delay } = require('node:timers/promises');

const { FaceWorkerController } = require('./face-worker-controller.cjs');

function bytesToMB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(count / 2);
  const median =
    count % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Index = Math.min(count - 1, Math.ceil(count * 0.95) - 1);
  return {
    count,
    min: Number(sorted[0].toFixed(2)),
    median: Number(median.toFixed(2)),
    mean: Number((sum / count).toFixed(2)),
    p95: Number(sorted[p95Index].toFixed(2)),
    max: Number(sorted[count - 1].toFixed(2)),
  };
}

async function runFixturePreparationMode() {
  const { buildRealAndSyntheticFixtures } = require('./fixture-helpers.cjs');
  const fixtures = await buildRealAndSyntheticFixtures();
  process.stdout.write(
    JSON.stringify({
      upstreamSamplePath: fixtures.upstreamSamplePath,
      upstreamDimensions: fixtures.upstreamDimensions,
      upstreamFaceCount: fixtures.upstreamFaceCount,
      cropBox: fixtures.cropBox,
      singleFaceDataUrl: fixtures.singleFaceDataUrl,
      blankDataUrl: fixtures.blankDataUrl,
      multiFaceDataUrl: fixtures.multiFaceDataUrl,
    }),
  );
}

async function runParityMeasurement(workerNormalizedDataUrl, workerDescriptor) {
  const sharp = require('sharp');
  const ts = require('typescript');
  const {
    PORTRAIT_WIDTH,
    PORTRAIT_HEIGHT,
    resolveDefaultPaths,
    createVmFaceRuntime,
  } = require('./face-runtime-core.cjs');
  const { l2Distance, maxAbsDiff } = require('./fixture-helpers.cjs');

  const { webRoot } = resolveDefaultPaths();
  const webRequire = createRequire(path.join(webRoot, 'package.json'));
  const jpegJs = webRequire('jpeg-js');

  const runtime = await createVmFaceRuntime();
  try {
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
      require: () => runtime.faceapi,
      setTimeout: (...args) => {
        const timer = setTimeout(...args);
        timer.unref();
        return timer;
      },
      clearTimeout,
    });

    const normJpegBytes = Buffer.from(
      workerNormalizedDataUrl.slice(workerNormalizedDataUrl.indexOf(',') + 1),
      'base64',
    );

    const release = trainedExports.retainFaceRecognizer();
    try {
      const { data: sharpRgb } = await sharp(normJpegBytes)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const sharpPixels = new runtime.RuntimeFloat32Array(sharpRgb.length);
      for (let i = 0; i < sharpRgb.length; i++) {
        sharpPixels[i] = sharpRgb[i];
      }
      const sharpTensor = runtime.faceapi.tf.tensor3d(sharpPixels, [
        PORTRAIT_HEIGHT,
        PORTRAIT_WIDTH,
        3,
      ]);

      let samePixelsMaxAbsDiff;
      let samePixelsL2;
      try {
        const webSame = await trainedExports.describeFace(sharpTensor);
        samePixelsMaxAbsDiff = maxAbsDiff(workerDescriptor, webSame.descriptor);
        samePixelsL2 = l2Distance(workerDescriptor, webSame.descriptor);
      } finally {
        sharpTensor.dispose();
      }

      const decodedJpegJs = jpegJs.decode(normJpegBytes, { useTArray: true });
      const jpegJsPixels = new runtime.RuntimeFloat32Array(
        PORTRAIT_WIDTH * PORTRAIT_HEIGHT * 3,
      );
      for (let px = 0; px < PORTRAIT_WIDTH * PORTRAIT_HEIGHT; px++) {
        jpegJsPixels[px * 3] = decodedJpegJs.data[px * 4];
        jpegJsPixels[px * 3 + 1] = decodedJpegJs.data[px * 4 + 1];
        jpegJsPixels[px * 3 + 2] = decodedJpegJs.data[px * 4 + 2];
      }
      const jpegJsTensor = runtime.faceapi.tf.tensor3d(jpegJsPixels, [
        PORTRAIT_HEIGHT,
        PORTRAIT_WIDTH,
        3,
      ]);

      let crossDecoderMaxAbsDiff;
      let crossDecoderL2;
      try {
        const webJpegJs = await trainedExports.describeFace(jpegJsTensor);
        crossDecoderMaxAbsDiff = maxAbsDiff(
          workerDescriptor,
          webJpegJs.descriptor,
        );
        crossDecoderL2 = l2Distance(workerDescriptor, webJpegJs.descriptor);
      } finally {
        jpegJsTensor.dispose();
      }

      return {
        sameNormalizedRgbPixels: {
          maxAbsDiff: samePixelsMaxAbsDiff,
          l2Distance: samePixelsL2,
        },
        crossJpegDecoderSharpVsJpegJs: {
          maxAbsDiff: Number(crossDecoderMaxAbsDiff.toFixed(6)),
          l2Distance: Number(crossDecoderL2.toFixed(6)),
        },
        browserWebglParity: 'unverified_in_node_poc',
      };
    } finally {
      release();
    }
  } finally {
    runtime.dispose();
  }
}

async function runBenchmark() {
  // Prepare fixtures in an isolated child process so the parent benchmark process
  // never loads sharp or face-api on the main thread before/during worker measurements.
  const fixtureRaw = execFileSync(
    process.execPath,
    [path.join(__dirname, 'benchmark-face-worker.cjs'), '--prepare-fixtures'],
    { maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' },
  );
  const fixtures = JSON.parse(fixtureRaw);

  const warmRunsTarget = 5;
  const heartbeatIntervalMs = 20;

  const rssBaselineBeforeWorkerMB = bytesToMB(process.memoryUsage().rss);

  const controller = new FaceWorkerController({
    maxQueueSize: 8,
    defaultTimeoutMs: 60_000,
    eagerStart: true,
  });

  // Give spawned worker thread a moment to settle idle V8 isolate before sampling idle RSS
  await delay(80);
  const rssAfterWorkerSpawnIdleMB = bytesToMB(process.memoryUsage().rss);

  // Measure cold model load in worker
  const coldWallStart = performance.now();
  const warmupInfo = await controller.warmup();
  const coldWallMs = Number((performance.now() - coldWallStart).toFixed(2));
  const rssAfterColdModelLoadMB = bytesToMB(process.memoryUsage().rss);

  // Start main-thread heartbeat & event-loop delay histogram during warm heavy inferences
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const heartbeatDriftsMs = [];
  let peakProcessRssBytes = process.memoryUsage().rss;
  let lastTick = performance.now();

  const heartbeatTimer = setInterval(() => {
    const now = performance.now();
    const drift = Math.max(0, now - lastTick - heartbeatIntervalMs);
    heartbeatDriftsMs.push(drift);
    lastTick = now;
    const rss = process.memoryUsage().rss;
    if (rss > peakProcessRssBytes) {
      peakProcessRssBytes = rss;
    }
  }, heartbeatIntervalMs);

  const warmOneFaceRuns = [];
  let firstOneFaceResult = null;
  let blankWarmResult = null;
  let multiFaceWarmResult = null;

  try {
    for (let run = 1; run <= warmRunsTarget; run++) {
      const t0 = performance.now();
      const res = await controller.analyzePhoto(fixtures.singleFaceDataUrl);
      const wallMs = performance.now() - t0;
      if (run === 1) {
        firstOneFaceResult = res;
      }
      const rssAfterRun = process.memoryUsage().rss;
      if (rssAfterRun > peakProcessRssBytes) {
        peakProcessRssBytes = rssAfterRun;
      }
      warmOneFaceRuns.push({
        run,
        wallMs: Number(wallMs.toFixed(2)),
        totalWorkerMs: Number(res.timings.totalWorkerMs.toFixed(2)),
        normalizeDecodeMs: Number(res.timings.normalizeDecodeMs.toFixed(2)),
        detectMs: Number(res.timings.detectMs.toFixed(2)),
        describeMs: Number(res.timings.describeMs.toFixed(2)),
        tensorsBefore: res.tensorStats.tensorsBefore,
        tensorsAfter: res.tensorStats.tensorsAfter,
        tensorDelta: res.tensorStats.tensorDelta,
        tfMemoryBytes: res.tensorStats.numBytes,
        processRssMB: bytesToMB(rssAfterRun),
      });
    }

    // Also record 1 warm early-exit run each for 0-face (blank) and multi-face (3 faces)
    const tBlank = performance.now();
    const blankRes = await controller.analyzePhoto(fixtures.blankDataUrl);
    blankWarmResult = {
      faceCount: blankRes.faceCount,
      wallMs: Number((performance.now() - tBlank).toFixed(2)),
      normalizeDecodeMs: Number(blankRes.timings.normalizeDecodeMs.toFixed(2)),
      detectMs: Number(blankRes.timings.detectMs.toFixed(2)),
      describeMs: Number(blankRes.timings.describeMs.toFixed(2)),
      tensorDelta: blankRes.tensorStats.tensorDelta,
    };

    const tMulti = performance.now();
    const multiRes = await controller.analyzePhoto(fixtures.multiFaceDataUrl);
    multiFaceWarmResult = {
      faceCount: multiRes.faceCount,
      wallMs: Number((performance.now() - tMulti).toFixed(2)),
      normalizeDecodeMs: Number(multiRes.timings.normalizeDecodeMs.toFixed(2)),
      detectMs: Number(multiRes.timings.detectMs.toFixed(2)),
      describeMs: Number(multiRes.timings.describeMs.toFixed(2)),
      tensorDelta: multiRes.tensorStats.tensorDelta,
    };
  } finally {
    clearInterval(heartbeatTimer);
    loopDelay.disable();
  }

  const rssAfterRepeatedJobsMB = bytesToMB(process.memoryUsage().rss);
  await controller.shutdown();
  await delay(80);
  const rssAfterWorkerShutdownMB = bytesToMB(process.memoryUsage().rss);

  // Measure parity after worker benchmark is completely shut down so RSS/CPU metrics stay pure
  const parity = await runParityMeasurement(
    firstOneFaceResult.normalizedDataUrl,
    firstOneFaceResult.descriptor,
  );

  const cpus = os.cpus();
  const faceApiPkg = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../web/node_modules/@vladmandic/face-api/package.json',
      ),
      'utf8',
    ),
  );
  const sharpPkg = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../node_modules/sharp/package.json'),
      'utf8',
    ),
  );

  const report = {
    measuredAtIso: new Date().toISOString(),
    environment: {
      os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`,
      nodeVersion: process.version,
      cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
      logicalCores: cpus.length,
      totalSystemRamGB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
      faceApiPackage: `@vladmandic/face-api@${faceApiPkg.version} (dist/face-api.js in Node vm)`,
      tfBackend: warmupInfo.backend,
      tfVersion: warmupInfo.tfVersion,
      sharpVersion: sharpPkg.version,
    },
    fixture: {
      source: 'apps/web/node_modules/@vladmandic/face-api/demo/sample1.jpg',
      upstreamDimensions: fixtures.upstreamDimensions,
      upstreamDetectedFaces: fixtures.upstreamFaceCount,
      singleFaceCropRect: fixtures.cropBox,
      singleFaceDataUrlChars: fixtures.singleFaceDataUrl.length,
      normalizedTarget: '360x480 JPEG quality 85 (RGB tensor [480, 360, 3])',
      detectorOptions: { inputSize: 416, scoreThreshold: 0.5 },
    },
    modelArtifacts: warmupInfo.modelArtifacts,
    coldStartup: {
      workerModelLoadMs: Number(warmupInfo.loadTimeMs.toFixed(2)),
      parentRoundTripWarmupMs: coldWallMs,
      initialModelTensors: warmupInfo.memory.numTensors,
      initialModelBytes: warmupInfo.memory.numBytes,
    },
    warmSingleFaceBenchmark: {
      sampleCount: warmOneFaceRuns.length,
      wallMsSummary: summarizeNumbers(warmOneFaceRuns.map((r) => r.wallMs)),
      normalizeDecodeMsSummary: summarizeNumbers(
        warmOneFaceRuns.map((r) => r.normalizeDecodeMs),
      ),
      detectMsSummary: summarizeNumbers(warmOneFaceRuns.map((r) => r.detectMs)),
      describeMsSummary: summarizeNumbers(
        warmOneFaceRuns.map((r) => r.describeMs),
      ),
      runs: warmOneFaceRuns,
    },
    warmEarlyExitTimings: {
      blankZeroFace: blankWarmResult,
      uncroppedMultiFace: multiFaceWarmResult,
    },
    workerTensorLeakCheck: {
      baselineLoadedTensors: warmupInfo.memory.numTensors,
      tensorsBeforeFirstWarmRun: warmOneFaceRuns[0].tensorsBefore,
      tensorsAfterFifthWarmRun:
        warmOneFaceRuns[warmOneFaceRuns.length - 1].tensorsAfter,
      allRunsZeroDelta: warmOneFaceRuns.every((r) => r.tensorDelta === 0),
    },
    processWideRssMB: {
      note: 'OS process-wide RSS covering parent Node thread + worker_threads isolate + sharp/libvips native buffers (not per-worker RSS).',
      baselineBeforeWorker: rssBaselineBeforeWorkerMB,
      afterWorkerSpawnIdle: rssAfterWorkerSpawnIdleMB,
      afterColdModelLoad: rssAfterColdModelLoadMB,
      peakDuringWarmRuns: bytesToMB(peakProcessRssBytes),
      afterRepeatedJobsBeforeShutdown: rssAfterRepeatedJobsMB,
      afterWorkerShutdown: rssAfterWorkerShutdownMB,
    },
    mainThreadResponsivenessDuringHeavyInference: {
      heartbeatIntervalMs,
      heartbeatTicksRecorded: heartbeatDriftsMs.length,
      heartbeatDriftMs: summarizeNumbers(heartbeatDriftsMs),
      eventLoopDelayMs: {
        p50: Number((loopDelay.percentile(50) / 1e6).toFixed(2)),
        p95: Number((loopDelay.percentile(95) / 1e6).toFixed(2)),
        p99: Number((loopDelay.percentile(99) / 1e6).toFixed(2)),
        max: Number((loopDelay.max / 1e6).toFixed(2)),
      },
    },
    parity,
  };

  console.log(JSON.stringify(report, null, 2));
}

if (process.argv.includes('--prepare-fixtures')) {
  runFixturePreparationMode().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  runBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
