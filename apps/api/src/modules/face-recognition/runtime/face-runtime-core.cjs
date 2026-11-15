'use strict';

/** Packaged CPU runtime and pinned model artifacts, isolated in a worker. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { setTimeout, clearTimeout } = require('node:timers');
const { TextEncoder, TextDecoder } = require('node:util');
const sharp = require('sharp');

const PORTRAIT_WIDTH = 360;
const PORTRAIT_HEIGHT = 480;
const PORTRAIT_CHANNELS = 3;
const MAX_DATA_URL_LENGTH = 200_000;
const MAX_INPUT_PIXELS = 4_000_000;
const DETECTOR_INPUT_SIZE = 416;
const DETECTOR_SCORE_THRESHOLD = 0.5;
const DESCRIPTOR_LENGTH = 128;

const DATA_URL_REGEX =
  /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const JPEG_DATA_URL_REGEX = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

const EXPECTED_MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

function resolveDefaultPaths() {
  return {
    faceApiBundlePath: path.join(__dirname, 'assets/face-api.js'),
    modelRoot: path.join(__dirname, 'assets/models'),
  };
}

async function verifyPackagedArtifacts() {
  const assetRoot = path.join(__dirname, 'assets');
  const manifest = JSON.parse(
    await fs.promises.readFile(path.join(assetRoot, 'manifest.json'), 'utf8'),
  );
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const filename = path.resolve(assetRoot, relative);
    if (!filename.startsWith(assetRoot + path.sep))
      throw new Error('Invalid asset manifest path');
    const actual = createHash('sha256')
      .update(await fs.promises.readFile(filename))
      .digest('hex');
    if (actual !== expected)
      throw new Error(`Face runtime asset integrity mismatch: ${relative}`);
  }
  return manifest.descriptorVersion;
}

class FaceInputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FaceInputValidationError';
    this.code = 'INVALID_INPUT';
  }
}

async function inspectModelArtifacts(modelRoot) {
  const resolvedRoot = path.resolve(modelRoot);
  const files = [];
  const combinedHash = createHash('sha256');

  for (const filename of EXPECTED_MODEL_FILES) {
    const fullPath = path.resolve(resolvedRoot, filename);
    if (!fullPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Unsafe model file path: ${filename}`);
    }
    const bytes = await fs.promises.readFile(fullPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    combinedHash.update(`${filename}:${sha256}\n`);
    files.push({
      filename,
      byteLength: bytes.byteLength,
      sha256,
    });
  }

  return {
    modelRoot: resolvedRoot,
    bundleSha256: combinedHash.digest('hex'),
    files,
  };
}

function createLocalModelFetch(modelRoot) {
  const resolvedRoot = path.resolve(modelRoot);
  const allowedSet = new Set(EXPECTED_MODEL_FILES);

  return async function localModelFetch(inputUrl) {
    const cleanUrl = String(inputUrl).split('?')[0].split('#')[0];
    const filename = path.basename(cleanUrl);
    if (!allowedSet.has(filename)) {
      return new globalThis.Response(null, {
        status: 404,
        statusText: 'Model artifact not allowlisted',
      });
    }
    const filepath = path.resolve(resolvedRoot, filename);
    if (!filepath.startsWith(resolvedRoot + path.sep)) {
      return new globalThis.Response(null, { status: 403 });
    }
    const bytes = await fs.promises.readFile(filepath);
    return new globalThis.Response(bytes, {
      status: 200,
      headers: {
        'content-type': filename.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
      },
    });
  };
}

async function createVmFaceRuntime(options = {}) {
  const defaults = resolveDefaultPaths();
  const faceApiBundlePath =
    options.faceApiBundlePath ?? defaults.faceApiBundlePath;
  const modelRoot = options.modelRoot ?? defaults.modelRoot;

  const descriptorVersion = await verifyPackagedArtifacts();
  const t0 = performance.now();
  const modelArtifacts = await inspectModelArtifacts(modelRoot);
  const localFetch = createLocalModelFetch(modelRoot);

  const unrefSetTimeout = (...args) => {
    const timer = setTimeout(...args);
    timer.unref();
    return timer;
  };

  const context = {
    TextEncoder,
    TextDecoder,
    console,
    setTimeout: unrefSetTimeout,
    clearTimeout,
    fetch: localFetch,
    performance,
  };
  context.self = context;
  vm.createContext(context);

  const bundleCode = await fs.promises.readFile(faceApiBundlePath, 'utf8');
  vm.runInContext(bundleCode, context, { filename: faceApiBundlePath });

  const { faceapi } = context;
  const RuntimeFloat32Array = vm.runInContext('Float32Array', context);

  faceapi.tf.setPlatform('node-vm-cpu-poc', {
    fetch: localFetch,
    now: () => performance.now(),
    encode: (text) => new TextEncoder().encode(text),
    decode: (bytes) => new TextDecoder().decode(bytes),
    isTypedArray: ArrayBuffer.isView,
  });

  faceapi.env.setEnv({
    fetch: localFetch,
    Canvas: class {},
    Image: class {},
    Video: class {},
  });

  await faceapi.tf.setBackend('cpu');
  await faceapi.tf.ready();

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('local://face-api-models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('local://face-api-models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('local://face-api-models'),
  ]);

  const loadTimeMs = performance.now() - t0;
  const baselineMemory = faceapi.tf.memory();

  function dispose() {
    faceapi.nets.tinyFaceDetector.dispose();
    faceapi.nets.faceLandmark68Net.dispose();
    faceapi.nets.faceRecognitionNet.dispose();
  }

  return {
    descriptorVersion,
    context,
    faceapi,
    RuntimeFloat32Array,
    loadTimeMs,
    backend: faceapi.tf.getBackend(),
    tfVersion: faceapi.tf.version_core ?? faceapi.tf.version?.tfjs ?? 'bundled',
    modelArtifacts,
    baselineMemory: {
      numTensors: baselineMemory.numTensors,
      numBytes: baselineMemory.numBytes,
    },
    dispose,
  };
}

async function decodeValidatedPortraitJpeg(jpegBytes) {
  const portrait = sharp(jpegBytes, {
    limitInputPixels: PORTRAIT_WIDTH * PORTRAIT_HEIGHT,
    failOn: 'error',
  });
  const meta = await portrait.metadata();
  if (
    meta.format !== 'jpeg' ||
    meta.width !== PORTRAIT_WIDTH ||
    meta.height !== PORTRAIT_HEIGHT ||
    (meta.pages ?? 1) !== 1
  ) {
    throw new FaceInputValidationError(
      'Portrait must be a valid single-frame 360x480 JPEG.',
    );
  }
  await portrait.stats();

  const { data: rgbBuffer, info } = await sharp(jpegBytes, {
    limitInputPixels: PORTRAIT_WIDTH * PORTRAIT_HEIGHT,
    failOn: 'error',
  })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const expectedByteLength =
    PORTRAIT_WIDTH * PORTRAIT_HEIGHT * PORTRAIT_CHANNELS;
  if (
    info.width !== PORTRAIT_WIDTH ||
    info.height !== PORTRAIT_HEIGHT ||
    info.channels !== PORTRAIT_CHANNELS ||
    rgbBuffer.length !== expectedByteLength
  ) {
    throw new FaceInputValidationError(
      'Decoded RGB portrait dimensions did not match 360x480x3.',
    );
  }

  return rgbBuffer;
}

async function normalizeAndDecodePortrait(photo, options = {}) {
  const t0 = performance.now();
  if (typeof photo !== 'string' || photo.length === 0) {
    throw new FaceInputValidationError('Photo must be a non-empty string.');
  }
  if (photo.length > MAX_DATA_URL_LENGTH) {
    throw new FaceInputValidationError(
      `Photo exceeds ${MAX_DATA_URL_LENGTH} character data URL budget.`,
    );
  }

  if (options.alreadyNormalized) {
    const jpegMatch = JPEG_DATA_URL_REGEX.exec(photo);
    if (!jpegMatch?.[1]) {
      throw new FaceInputValidationError(
        'Normalized portrait must be a valid base64 JPEG data URL.',
      );
    }
    const jpegBytes = Buffer.from(jpegMatch[1], 'base64');
    if (jpegBytes.length === 0) {
      throw new FaceInputValidationError('Empty JPEG payload.');
    }
    try {
      const rgbBuffer = await decodeValidatedPortraitJpeg(jpegBytes);
      return {
        normalizedDataUrl: photo,
        normalizedJpegBytes: jpegBytes,
        rgbBuffer,
        normalizeDecodeMs: performance.now() - t0,
      };
    } catch (err) {
      if (err instanceof FaceInputValidationError) {
        throw err;
      }
      throw new FaceInputValidationError(
        'Invalid or corrupted 360x480 JPEG portrait.',
      );
    }
  }

  const match = DATA_URL_REGEX.exec(photo);
  if (!match?.[1]) {
    throw new FaceInputValidationError(
      'Photo must be a base64 JPEG, PNG, or WebP data URL; external URLs are forbidden.',
    );
  }

  const inputBytes = Buffer.from(match[1], 'base64');
  if (inputBytes.length === 0) {
    throw new FaceInputValidationError('Decoded image payload is empty.');
  }

  let normalizedJpegBytes;
  try {
    const image = sharp(inputBytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')
    ) {
      throw new FaceInputValidationError('Unsupported or multi-page image.');
    }

    normalizedJpegBytes = await image
      .rotate()
      .resize(PORTRAIT_WIDTH, PORTRAIT_HEIGHT, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    if (err instanceof FaceInputValidationError) {
      throw err;
    }
    throw new FaceInputValidationError(
      'Image is malformed or exceeds the 4,000,000 pixel limit.',
    );
  }

  const normalizedDataUrl = `data:image/jpeg;base64,${normalizedJpegBytes.toString('base64')}`;
  if (normalizedDataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new FaceInputValidationError(
      'Normalized 360x480 JPEG exceeded 200,000 character data URL budget.',
    );
  }

  const rgbBuffer = await decodeValidatedPortraitJpeg(normalizedJpegBytes);
  return {
    normalizedDataUrl,
    normalizedJpegBytes,
    rgbBuffer,
    normalizeDecodeMs: performance.now() - t0,
  };
}

async function describeRgbPortrait(runtime, rgbBuffer) {
  const { faceapi, RuntimeFloat32Array } = runtime;
  const expectedLength = PORTRAIT_WIDTH * PORTRAIT_HEIGHT * PORTRAIT_CHANNELS;
  if (!rgbBuffer || rgbBuffer.length !== expectedLength) {
    throw new FaceInputValidationError(
      `RGB buffer must have length ${expectedLength}.`,
    );
  }

  const memBefore = faceapi.tf.memory();
  const tensorsBefore = memBefore.numTensors;

  const pixels = new RuntimeFloat32Array(expectedLength);
  for (let i = 0; i < expectedLength; i++) {
    pixels[i] = rgbBuffer[i];
  }

  const inputTensor = faceapi.tf.tensor3d(pixels, [
    PORTRAIT_HEIGHT,
    PORTRAIT_WIDTH,
    PORTRAIT_CHANNELS,
  ]);

  let faceCount = 0;
  let hostDescriptor = null;
  let detectMs = 0;
  let describeMs = 0;

  try {
    const tDetectStart = performance.now();
    const detections = await faceapi.detectAllFaces(
      inputTensor,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: DETECTOR_INPUT_SIZE,
        scoreThreshold: DETECTOR_SCORE_THRESHOLD,
      }),
    );
    detectMs = performance.now() - tDetectStart;
    faceCount = detections.length;

    if (faceCount === 1) {
      const tDescribeStart = performance.now();
      const described = await new faceapi.DetectAllFaceLandmarksTask(
        Promise.resolve(detections.map((detection) => ({ detection }))),
        inputTensor,
        false,
      ).withFaceDescriptors();
      describeMs = performance.now() - tDescribeStart;

      const rawDesc = described[0]?.descriptor ?? null;
      if (rawDesc !== null) {
        if (
          rawDesc.length !== DESCRIPTOR_LENGTH ||
          !Array.from(rawDesc).every(Number.isFinite)
        ) {
          throw new Error('Model produced invalid or non-finite descriptor.');
        }
        hostDescriptor = new Float32Array(DESCRIPTOR_LENGTH);
        for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
          hostDescriptor[i] = rawDesc[i];
        }
      }
    }
  } finally {
    inputTensor.dispose();
  }

  const memAfter = faceapi.tf.memory();
  const tensorsAfter = memAfter.numTensors;

  return {
    faceCount,
    descriptor: hostDescriptor,
    timings: {
      detectMs,
      describeMs,
    },
    tensorStats: {
      tensorsBefore,
      tensorsAfter,
      tensorDelta: tensorsAfter - tensorsBefore,
      numBytes: memAfter.numBytes,
    },
  };
}

module.exports = {
  PORTRAIT_WIDTH,
  PORTRAIT_HEIGHT,
  PORTRAIT_CHANNELS,
  MAX_DATA_URL_LENGTH,
  MAX_INPUT_PIXELS,
  DETECTOR_INPUT_SIZE,
  DETECTOR_SCORE_THRESHOLD,
  DESCRIPTOR_LENGTH,
  FaceInputValidationError,
  resolveDefaultPaths,
  inspectModelArtifacts,
  createVmFaceRuntime,
  normalizeAndDecodePortrait,
  describeRgbPortrait,
};
