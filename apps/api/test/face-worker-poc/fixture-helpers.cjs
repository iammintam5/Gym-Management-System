'use strict';

const fs = require('node:fs');
const sharp = require('sharp');
const {
  DETECTOR_INPUT_SIZE,
  DETECTOR_SCORE_THRESHOLD,
  MAX_DATA_URL_LENGTH,
  resolveDefaultPaths,
  createVmFaceRuntime,
} = require('./face-runtime-core.cjs');

/**
 * Prepares real test fixtures strictly from on-disk upstream sample1.jpg and synthetic rasters.
 * Reuses the one-face crop box formula from apps/web/test/face-recognition.test.cjs:
 *   x = max(0, floor(box.x - box.width * 0.2))
 *   y = max(0, floor(box.y - box.height * 0.3))
 *   width = min(imgW - x, floor(box.width * 1.4))
 *   height = min(imgH - y, floor(box.height * 1.6))
 */
async function buildRealAndSyntheticFixtures(existingRuntime = null) {
  const paths = resolveDefaultPaths();
  const sampleBytes = await fs.promises.readFile(paths.upstreamSamplePath);
  const sampleMeta = await sharp(sampleBytes).metadata();

  const ownsRuntime = existingRuntime === null;
  const runtime = existingRuntime ?? (await createVmFaceRuntime());

  let cropBox;
  let upstreamFaceCount;

  try {
    const { data: rawSample, info } = await sharp(sampleBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const samplePixels = new runtime.RuntimeFloat32Array(rawSample.length);
    for (let i = 0; i < rawSample.length; i++) {
      samplePixels[i] = rawSample[i];
    }

    const sampleTensor = runtime.faceapi.tf.tensor3d(samplePixels, [
      info.height,
      info.width,
      3,
    ]);

    try {
      const detections = await runtime.faceapi.detectAllFaces(
        sampleTensor,
        new runtime.faceapi.TinyFaceDetectorOptions({
          inputSize: DETECTOR_INPUT_SIZE,
          scoreThreshold: DETECTOR_SCORE_THRESHOLD,
        }),
      );
      upstreamFaceCount = detections.length;
      if (upstreamFaceCount < 1) {
        throw new Error('Expected at least one face in upstream sample1.jpg');
      }

      const box = detections[0].box;
      const left = Math.max(0, Math.floor(box.x - box.width * 0.2));
      const top = Math.max(0, Math.floor(box.y - box.height * 0.3));
      const width = Math.min(info.width - left, Math.floor(box.width * 1.4));
      const height = Math.min(info.height - top, Math.floor(box.height * 1.6));
      cropBox = { left, top, width, height };
    } finally {
      sampleTensor.dispose();
    }
  } finally {
    if (ownsRuntime) {
      runtime.dispose();
    }
  }

  const singleFaceCropJpeg = await sharp(sampleBytes)
    .extract(cropBox)
    .jpeg({ quality: 90 })
    .toBuffer();

  const blankJpeg = await sharp({
    create: {
      width: 360,
      height: 480,
      channels: 3,
      background: '#808080',
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  // 2100x2100 = 4,410,000 pixels (> 4,000,000 limit), but solid fill compresses to ~14KB
  // so its base64 string stays well under 200,000 chars and exercises sharp pixel-limit enforcement inside worker.
  const overPixelJpeg = await sharp({
    create: {
      width: 2100,
      height: 2100,
      channels: 3,
      background: '#777777',
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  return {
    upstreamSamplePath: paths.upstreamSamplePath,
    upstreamDimensions: {
      width: sampleMeta.width,
      height: sampleMeta.height,
      byteLength: sampleBytes.byteLength,
    },
    upstreamFaceCount,
    cropBox,
    singleFaceDataUrl: `data:image/jpeg;base64,${singleFaceCropJpeg.toString('base64')}`,
    multiFaceDataUrl: `data:image/jpeg;base64,${sampleBytes.toString('base64')}`,
    blankDataUrl: `data:image/jpeg;base64,${blankJpeg.toString('base64')}`,
    overPixelBudgetDataUrl: `data:image/jpeg;base64,${overPixelJpeg.toString('base64')}`,
    overByteBudgetDataUrl: `data:image/jpeg;base64,${'A'.repeat(MAX_DATA_URL_LENGTH)}`,
  };
}

function l2Distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function maxAbsDiff(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > max) {
      max = diff;
    }
  }
  return max;
}

module.exports = {
  buildRealAndSyntheticFixtures,
  l2Distance,
  maxAbsDiff,
};
