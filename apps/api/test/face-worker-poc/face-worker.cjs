'use strict';

const { parentPort, workerData, threadId } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const {
  FaceInputValidationError,
  createVmFaceRuntime,
  normalizeAndDecodePortrait,
  describeRgbPortrait,
} = require('./face-runtime-core.cjs');

if (!parentPort) {
  throw new Error(
    'face-worker.cjs must execute inside a worker_threads Worker.',
  );
}

let runtimePromise = null;

function ensureRuntime() {
  if (!runtimePromise) {
    runtimePromise = createVmFaceRuntime({
      faceApiBundlePath: workerData?.faceApiBundlePath,
      modelRoot: workerData?.modelRoot,
    }).catch((err) => {
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}

parentPort.on('message', async (msg) => {
  const { taskId, payload } = msg;
  const taskStart = performance.now();

  try {
    if (payload?.type === 'warmup') {
      const wasLoaded = runtimePromise !== null;
      const runtime = await ensureRuntime();
      const mem = runtime.faceapi.tf.memory();
      parentPort.postMessage({
        taskId,
        ok: true,
        result: {
          threadId,
          wasLoaded,
          loadTimeMs: runtime.loadTimeMs,
          backend: runtime.backend,
          tfVersion: runtime.tfVersion,
          modelArtifacts: runtime.modelArtifacts,
          memory: {
            numTensors: mem.numTensors,
            numBytes: mem.numBytes,
          },
        },
      });
      return;
    }

    if (payload?.type === 'analyze') {
      // Validate/normalize/decode input image BEFORE loading/running heavy neural nets
      // so malformed or over-budget payloads fail fast inside the worker.
      const decoded = await normalizeAndDecodePortrait(payload.photo, {
        alreadyNormalized: Boolean(payload.alreadyNormalized),
      });

      const wasLoaded = runtimePromise !== null;
      const tLoad0 = performance.now();
      const runtime = await ensureRuntime();
      const coldLoadMs = wasLoaded ? 0 : performance.now() - tLoad0;

      const inference = await describeRgbPortrait(runtime, decoded.rgbBuffer);

      parentPort.postMessage({
        taskId,
        ok: true,
        result: {
          threadId,
          faceCount: inference.faceCount,
          descriptor: inference.descriptor,
          normalizedDataUrl: decoded.normalizedDataUrl,
          timings: {
            coldLoadMs,
            normalizeDecodeMs: decoded.normalizeDecodeMs,
            detectMs: inference.timings.detectMs,
            describeMs: inference.timings.describeMs,
            totalWorkerMs: performance.now() - taskStart,
          },
          tensorStats: inference.tensorStats,
        },
      });
      return;
    }

    parentPort.postMessage({
      taskId,
      ok: false,
      error: {
        code: 'UNSUPPORTED_MESSAGE',
        message: `Unsupported worker payload type: ${String(payload?.type)}`,
      },
    });
  } catch (err) {
    const code =
      err instanceof FaceInputValidationError
        ? 'INVALID_INPUT'
        : err?.code || 'WORKER_INFERENCE_ERROR';
    parentPort.postMessage({
      taskId,
      ok: false,
      error: {
        code,
        message: err?.message || 'Unexpected worker failure',
      },
    });
  }
});
