'use client';

export interface DetectedFaceResult {
  descriptor: Float32Array;
  score: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Normalized bounding box [0..1] within the 3:4 portrait viewport for live HUD tracking */
  normalizedBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Spatial region weights for an 8x8 facial grid (64 cells).
 * Higher weights on periocular (eyes/eyebrows), nasal bridge, and mouth regions,
 * lower weights on outer corners/background.
 */
const FACE_GRID_WEIGHTS = [
  0.15,
  0.35,
  0.55,
  0.6,
  0.6,
  0.55,
  0.35,
  0.15,
  0.25,
  0.85,
  1.35,
  1.15,
  1.15,
  1.35,
  0.85,
  0.25,
  0.35,
  1.6,
  2.4,
  1.8,
  1.8,
  2.4,
  1.6,
  0.35, // Eyes & eyebrows row
  0.35,
  1.3,
  1.9,
  2.1,
  2.1,
  1.9,
  1.3,
  0.35, // Infraorbital & upper nose bridge
  0.25,
  0.85,
  1.5,
  2.1,
  2.1,
  1.5,
  0.85,
  0.25, // Nose tip & cheeks
  0.25,
  0.75,
  1.4,
  1.75,
  1.75,
  1.4,
  0.75,
  0.25, // Mouth & philtrum
  0.15,
  0.45,
  0.85,
  1.0,
  1.0,
  0.85,
  0.45,
  0.15, // Chin & jawline
  0.1,
  0.2,
  0.35,
  0.45,
  0.45,
  0.35,
  0.2,
  0.1,
];

const DESCRIPTOR_GRID = 8;
const DESCRIPTOR_BINS_PER_CELL = 20;
const PART1_LEN = DESCRIPTOR_GRID * DESCRIPTOR_GRID * DESCRIPTOR_BINS_PER_CELL; // 1280
const TEMPLATE_SIZE = 16;
const PART2_LEN = TEMPLATE_SIZE * TEMPLATE_SIZE; // 256
const PART3_LEN = DESCRIPTOR_GRID * DESCRIPTOR_GRID * 2; // 128
const TOTAL_DESCRIPTOR_LEN = PART1_LEN + PART2_LEN + PART3_LEN; // 1664

/**
 * Helper to query a 2D Summed-Area Table (Integral Image) of dimensions (W + 1) x (H + 1)
 */
function rectSum(
  sat: Float64Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (x1 <= x0 || y1 <= y0) return 0;
  const a = sat[y0 * stride + x0] ?? 0;
  const b = sat[y0 * stride + x1] ?? 0;
  const c = sat[y1 * stride + x0] ?? 0;
  const d = sat[y1 * stride + x1] ?? 0;
  return d - b - c + a;
}

function rectMean(
  sat: Float64Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return rectSum(sat, stride, x0, y0, x1, y1) / area;
}

/**
 * Multi-Scale Integral-Image Face Locator & Illumination-Invariant Biometric Descriptor Extractor.
 *
 * Pipeline:
 * 1. Center-crops input to 3:4 portrait aspect ratio and downsamples to a 96x128 search buffer.
 * 2. Builds Summed-Area Tables (Integral Images) for Luminance, Skin Chrominance, and Edge Gradients.
 * 3. Runs a sliding-window Viola-Jones / Haar-cascade style search across multiple scales and positions
 *    to dynamically lock onto the real face bounding box (eyes, nose bridge, mouth, bilateral symmetry).
 * 4. Fine-aligns the periocular eye-line and extracts a 64x64 locally illumination-normalized face patch.
 * 5. Computes a 1664D composite descriptor:
 *    - Part 1 (1280D): 8x8 spatially weighted CS-LBP + Oriented Sobel Gradient histograms
 *    - Part 2 (256D): 16x16 Zero-Mean Unit-Variance (ZNCC) structural facial geometry template
 *    - Part 3 (128D): 8x8 normalized facial contrast & relative chrominance profile
 */
export function detectSingleFaceDescriptorSync(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): DetectedFaceResult | null {
  let srcW = 0;
  let srcH = 0;

  if (input instanceof HTMLVideoElement) {
    srcW = input.videoWidth;
    srcH = input.videoHeight;
  } else if (input instanceof HTMLImageElement) {
    srcW = input.naturalWidth || input.width;
    srcH = input.naturalHeight || input.height;
  } else {
    srcW = input.width;
    srcH = input.height;
  }

  if (srcW < 32 || srcH < 32) return null;

  // 1. Crop to 3:4 portrait aspect ratio
  const targetRatio = 3 / 4;
  const srcRatio = srcW / srcH;
  let cropW = srcW;
  let cropH = srcH;
  if (srcRatio > targetRatio) {
    cropW = srcH * targetRatio;
  } else {
    cropH = srcW / targetRatio;
  }
  const cropX = (srcW - cropW) / 2;
  const cropY = (srcH - cropH) / 2;

  // 2. Render 3:4 region onto a 96x128 locator canvas
  const LOC_W = 96;
  const LOC_H = 128;
  const locCanvas = document.createElement('canvas');
  locCanvas.width = LOC_W;
  locCanvas.height = LOC_H;
  const locCtx = locCanvas.getContext('2d', { willReadFrequently: true });
  if (!locCtx) return null;

  locCtx.drawImage(input, cropX, cropY, cropW, cropH, 0, 0, LOC_W, LOC_H);
  const locRgba = locCtx.getImageData(0, 0, LOC_W, LOC_H).data;
  const locPixels = LOC_W * LOC_H;

  const locLuma = new Float32Array(locPixels);
  const locSkin = new Float32Array(locPixels);
  const locEdgeY = new Float32Array(locPixels);
  const locEdgeX = new Float32Array(locPixels);

  let totalLuma = 0;
  for (let i = 0; i < locPixels; i++) {
    const r = locRgba[i * 4] ?? 0;
    const g = locRgba[i * 4 + 1] ?? 0;
    const b = locRgba[i * 4 + 2] ?? 0;

    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    locLuma[i] = y;
    totalLuma += y;

    // Soft Gaussian-like skin chrominance likelihood (tolerant to warm/cool indoor lighting)
    if (y > 25 && y < 248) {
      const dCb = (cb - 108) / 28;
      const dCr = (cr - 152) / 28;
      const chromaDistSq = dCb * dCb + dCr * dCr;
      locSkin[i] =
        chromaDistSq <= 1.8 ? Math.max(0, 1 - chromaDistSq * 0.45) : 0;
    }
  }

  const globalMeanLuma = totalLuma / locPixels;
  let globalVarSum = 0;
  for (let i = 0; i < locPixels; i++) {
    const d = (locLuma[i] ?? 0) - globalMeanLuma;
    globalVarSum += d * d;
  }
  const globalStdLuma = Math.sqrt(globalVarSum / locPixels);
  if (globalStdLuma < 8.5) {
    // Reject blank wall, black frame, or covered camera lens
    return null;
  }

  for (let y = 1; y < LOC_H - 1; y++) {
    for (let x = 1; x < LOC_W - 1; x++) {
      const idx = y * LOC_W + x;
      locEdgeY[idx] = Math.abs(
        (locLuma[(y + 1) * LOC_W + x] ?? 0) -
          (locLuma[(y - 1) * LOC_W + x] ?? 0),
      );
      locEdgeX[idx] = Math.abs(
        (locLuma[y * LOC_W + (x + 1)] ?? 0) -
          (locLuma[y * LOC_W + (x - 1)] ?? 0),
      );
    }
  }

  // Build Summed-Area Tables (Integral Images)
  const stride = LOC_W + 1;
  const satLen = (LOC_W + 1) * (LOC_H + 1);
  const satLuma = new Float64Array(satLen);
  const satSkin = new Float64Array(satLen);
  const satEdgeY = new Float64Array(satLen);
  const satEdgeX = new Float64Array(satLen);

  for (let y = 1; y <= LOC_H; y++) {
    let rowLuma = 0;
    let rowSkin = 0;
    let rowEy = 0;
    let rowEx = 0;
    for (let x = 1; x <= LOC_W; x++) {
      const srcIdx = (y - 1) * LOC_W + (x - 1);
      rowLuma += locLuma[srcIdx] ?? 0;
      rowSkin += locSkin[srcIdx] ?? 0;
      rowEy += locEdgeY[srcIdx] ?? 0;
      rowEx += locEdgeX[srcIdx] ?? 0;

      const dstIdx = y * stride + x;
      const prevRowIdx = (y - 1) * stride + x;
      satLuma[dstIdx] = (satLuma[prevRowIdx] ?? 0) + rowLuma;
      satSkin[dstIdx] = (satSkin[prevRowIdx] ?? 0) + rowSkin;
      satEdgeY[dstIdx] = (satEdgeY[prevRowIdx] ?? 0) + rowEy;
      satEdgeX[dstIdx] = (satEdgeX[prevRowIdx] ?? 0) + rowEx;
    }
  }

  // 3. Multi-Scale Viola-Jones / Haar Sliding Window Search
  const candidateWidths = [44, 52, 60, 68, 76];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBx = Math.round(LOC_W * 0.16);
  let bestBy = Math.round(LOC_H * 0.12);
  let bestBw = Math.round(LOC_W * 0.68);
  let bestBh = Math.round(LOC_H * 0.72);
  let bestEyeEdge = 0;
  let bestSkinDensity = 0;

  for (const bw of candidateWidths) {
    const bh = Math.round(bw * 1.24);
    const maxBx = LOC_W - bw - 2;
    const maxBy = LOC_H - bh - 2;

    for (let by = 4; by <= maxBy; by += 4) {
      for (let bx = 4; bx <= maxBx; bx += 4) {
        // Sub-regions inside candidate face box
        const eyeY0 = by + Math.round(bh * 0.2);
        const eyeY1 = by + Math.round(bh * 0.44);
        const eyeX0 = bx + Math.round(bw * 0.12);
        const eyeX1 = bx + Math.round(bw * 0.88);
        const midX = bx + Math.round(bw * 0.5);

        const cheekY0 = eyeY1;
        const cheekY1 = by + Math.round(bh * 0.66);

        const mouthY0 = by + Math.round(bh * 0.54);
        const mouthY1 = by + Math.round(bh * 0.84);
        const mouthX0 = bx + Math.round(bw * 0.22);
        const mouthX1 = bx + Math.round(bw * 0.78);

        const eyeEdgeMean = rectMean(
          satEdgeY,
          stride,
          eyeX0,
          eyeY0,
          eyeX1,
          eyeY1,
        );
        if (eyeEdgeMean < 2.1) continue;

        const mouthEdgeMean = rectMean(
          satEdgeY,
          stride,
          mouthX0,
          mouthY0,
          mouthX1,
          mouthY1,
        );
        const noseVertEdgeMean = rectMean(
          satEdgeX,
          stride,
          bx + Math.round(bw * 0.34),
          eyeY0,
          bx + Math.round(bw * 0.66),
          cheekY1,
        );

        // Haar Periocular Feature: Eye sockets/brows are typically darker than cheeks
        const eyeLuma = rectMean(satLuma, stride, eyeX0, eyeY0, eyeX1, eyeY1);
        const cheekLuma = rectMean(
          satLuma,
          stride,
          eyeX0,
          cheekY0,
          eyeX1,
          cheekY1,
        );
        const haarEyeCheek = Math.max(-4, Math.min(18, cheekLuma - eyeLuma));

        // Bilateral Left-Right Symmetry of eyes and cheeks
        const leftEyeEdge = rectMean(
          satEdgeY,
          stride,
          eyeX0,
          eyeY0,
          midX,
          eyeY1,
        );
        const rightEyeEdge = rectMean(
          satEdgeY,
          stride,
          midX,
          eyeY0,
          eyeX1,
          eyeY1,
        );
        const eyeSymmetry =
          1 -
          Math.abs(leftEyeEdge - rightEyeEdge) /
            Math.max(1, leftEyeEdge + rightEyeEdge);

        const leftLuma = rectMean(satLuma, stride, eyeX0, eyeY0, midX, mouthY1);
        const rightLuma = rectMean(
          satLuma,
          stride,
          midX,
          eyeY0,
          eyeX1,
          mouthY1,
        );
        const lumaSymmetry =
          1 - Math.min(1, Math.abs(leftLuma - rightLuma) / 65);

        // Skin density inside central core
        const coreSkin = rectMean(
          satSkin,
          stride,
          eyeX0,
          eyeY0,
          eyeX1,
          mouthY1,
        );

        // Natural portrait center prior
        const cx = (bx + bw * 0.5) / LOC_W;
        const cy = (by + bh * 0.5) / LOC_H;
        const centerDistSq =
          (cx - 0.5) * (cx - 0.5) * 2.2 + (cy - 0.46) * (cy - 0.46) * 2.0;
        const centerPrior = Math.max(0.4, 1 - centerDistSq);

        const candidateScore =
          (eyeEdgeMean * 1.45 +
            mouthEdgeMean * 0.85 +
            noseVertEdgeMean * 0.75 +
            haarEyeCheek * 0.35 +
            coreSkin * 14.0) *
          (0.55 + 0.25 * eyeSymmetry + 0.2 * lumaSymmetry) *
          centerPrior;

        if (candidateScore > bestScore) {
          bestScore = candidateScore;
          bestBx = bx;
          bestBy = by;
          bestBw = bw;
          bestBh = bh;
          bestEyeEdge = eyeEdgeMean;
          bestSkinDensity = coreSkin;
        }
      }
    }
  }

  // Validate detected candidate is a genuine face
  if (bestEyeEdge < 2.2 || bestScore < 8.5) {
    return null;
  }

  // 4. Fine-align vertical eye-line within the detected box
  const eyeSearchStart = Math.max(1, bestBy + Math.round(bestBh * 0.18));
  const eyeSearchEnd = Math.min(LOC_H - 2, bestBy + Math.round(bestBh * 0.44));
  const eyeColX0 = Math.max(1, bestBx + Math.round(bestBw * 0.15));
  const eyeColX1 = Math.min(LOC_W - 1, bestBx + Math.round(bestBw * 0.85));

  let peakEyeRow = bestBy + Math.round(bestBh * 0.3);
  let maxRowEnergy = -1;
  for (let r = eyeSearchStart; r <= eyeSearchEnd; r++) {
    const e = rectMean(satEdgeY, stride, eyeColX0, r, eyeColX1, r + 2);
    if (e > maxRowEnergy) {
      maxRowEnergy = e;
      peakEyeRow = r;
    }
  }

  // Anchor eye-line to 31% from top of the aligned box
  const alignedBy = Math.max(
    0,
    Math.min(LOC_H - bestBh, Math.round(peakEyeRow - bestBh * 0.31)),
  );

  // Normalized [0..1] coordinates within the 3:4 viewport
  const normX = Math.max(0, Math.min(1, bestBx / LOC_W));
  const normY = Math.max(0, Math.min(1, alignedBy / LOC_H));
  const normW = Math.max(0.1, Math.min(1 - normX, bestBw / LOC_W));
  const normH = Math.max(0.1, Math.min(1 - normY, bestBh / LOC_H));

  // Map back to source pixel coordinates
  const faceBoxX = cropX + normX * cropW;
  const faceBoxY = cropY + normY * cropH;
  const faceBoxW = normW * cropW;
  const faceBoxH = normH * cropH;

  // 5. Extract canonical 64x64 aligned face patch
  const SIZE = 64;
  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = SIZE;
  patchCanvas.height = SIZE;
  const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true });
  if (!patchCtx) return null;

  patchCtx.drawImage(
    input,
    faceBoxX,
    faceBoxY,
    faceBoxW,
    faceBoxH,
    0,
    0,
    SIZE,
    SIZE,
  );

  const rgba = patchCtx.getImageData(0, 0, SIZE, SIZE).data;
  const pixelCount = SIZE * SIZE;
  const rawLuma = new Float32Array(pixelCount);
  const rawCb = new Float32Array(pixelCount);
  const rawCr = new Float32Array(pixelCount);

  let sumY = 0;
  let sumCb = 0;
  let sumCr = 0;

  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;

    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    rawLuma[i] = y;
    rawCb[i] = cb;
    rawCr[i] = cr;
    sumY += y;
    sumCb += cb;
    sumCr += cr;
  }

  const meanY = sumY / pixelCount;
  const meanCb = sumCb / pixelCount;
  const meanCr = sumCr / pixelCount;

  let varY = 0;
  for (let i = 0; i < pixelCount; i++) {
    const d = (rawLuma[i] ?? 0) - meanY;
    varY += d * d;
  }
  const stdY = Math.sqrt(varY / pixelCount);
  if (stdY < 9.5) return null;

  // Local Illumination Normalization (8x8 block contrast equalization + global blend)
  const luma = new Float32Array(pixelCount);
  const CELL = SIZE / DESCRIPTOR_GRID; // 8

  for (let gy = 0; gy < DESCRIPTOR_GRID; gy++) {
    for (let gx = 0; gx < DESCRIPTOR_GRID; gx++) {
      let cSum = 0;
      for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
        for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
          cSum += rawLuma[py * SIZE + px] ?? 0;
        }
      }
      const cMean = cSum / (CELL * CELL);
      let cVar = 0;
      for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
        for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
          const d = (rawLuma[py * SIZE + px] ?? 0) - cMean;
          cVar += d * d;
        }
      }
      const cStd = Math.max(8, Math.sqrt(cVar / (CELL * CELL)));

      for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
        for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
          const idx = py * SIZE + px;
          const v = rawLuma[idx] ?? 0;
          const localNorm = (v - cMean) / cStd;
          const globalNorm = (v - meanY) / stdY;
          luma[idx] = 0.6 * localNorm + 0.4 * globalNorm;
        }
      }
    }
  }

  const descriptor = new Float32Array(TOTAL_DESCRIPTOR_LEN);

  // Part 1 (0..1279): 8x8 Grid Mirror-Symmetric CS-LBP + Oriented Gradients
  for (let gy = 0; gy < DESCRIPTOR_GRID; gy++) {
    for (let gx = 0; gx < DESCRIPTOR_GRID; gx++) {
      const cellIndex = gy * DESCRIPTOR_GRID + gx;
      const weight = FACE_GRID_WEIGHTS[cellIndex] ?? 1.0;
      const baseOffset = cellIndex * DESCRIPTOR_BINS_PER_CELL;

      for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
        for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
          const y0 = Math.max(0, py - 1);
          const y2 = Math.min(SIZE - 1, py + 1);
          const x0 = Math.max(0, px - 1);
          const x2 = Math.min(SIZE - 1, px + 1);

          const c = luma[py * SIZE + px] ?? 0;
          const top = luma[y0 * SIZE + px] ?? 0;
          const bot = luma[y2 * SIZE + px] ?? 0;
          const left = luma[py * SIZE + x0] ?? 0;
          const right = luma[py * SIZE + x2] ?? 0;
          const tl = luma[y0 * SIZE + x0] ?? 0;
          const tr = luma[y0 * SIZE + x2] ?? 0;
          const bl = luma[y2 * SIZE + x0] ?? 0;
          const br = luma[y2 * SIZE + x2] ?? 0;

          // 4-bit Horizontally-Symmetric Pattern (invariant to x0 <-> x2 flip within cell)
          let symBin = 0;
          if (bot >= top) symBin |= 1;
          if (bl + br >= tl + tr) symBin |= 2;
          if (left + right >= 2 * c) symBin |= 4;
          if (top + bot >= 2 * c) symBin |= 8;

          descriptor[baseOffset + symBin] =
            (descriptor[baseOffset + symBin] ?? 0) + weight;

          const dx = right - left;
          const dy = bot - top;

          descriptor[baseOffset + 16] =
            (descriptor[baseOffset + 16] ?? 0) + Math.max(0, dx) * weight;
          descriptor[baseOffset + 17] =
            (descriptor[baseOffset + 17] ?? 0) + Math.max(0, -dx) * weight;
          descriptor[baseOffset + 18] =
            (descriptor[baseOffset + 18] ?? 0) + Math.max(0, dy) * weight;
          descriptor[baseOffset + 19] =
            (descriptor[baseOffset + 19] ?? 0) + Math.max(0, -dy) * weight;
        }
      }
    }
  }

  // Normalize Part 1 with weight sqrt(0.45)
  normalizeSubVector(descriptor, 0, PART1_LEN, Math.sqrt(0.45));

  // Part 2 (1280..1535): 16x16 Spatially-Weighted ZNCC Structural Facial Template
  const T_STEP = SIZE / TEMPLATE_SIZE; // 4x4 pixels per template cell
  for (let ty = 0; ty < TEMPLATE_SIZE; ty++) {
    for (let tx = 0; tx < TEMPLATE_SIZE; tx++) {
      let sum = 0;
      for (let py = ty * T_STEP; py < (ty + 1) * T_STEP; py++) {
        for (let px = tx * T_STEP; px < (tx + 1) * T_STEP; px++) {
          sum += luma[py * SIZE + px] ?? 0;
        }
      }
      const gridCell =
        Math.floor(ty / 2) * DESCRIPTOR_GRID + Math.floor(tx / 2);
      const w = Math.sqrt(FACE_GRID_WEIGHTS[gridCell] ?? 1.0);
      descriptor[PART1_LEN + ty * TEMPLATE_SIZE + tx] =
        (sum / (T_STEP * T_STEP)) * w;
    }
  }
  // Zero-mean & L2-normalize Part 2 with weight sqrt(0.40)
  zeroMeanAndNormalizeSubVector(
    descriptor,
    PART1_LEN,
    PART2_LEN,
    Math.sqrt(0.4),
  );

  // Part 3 (1536..1663): 8x8 Regional Relative Chrominance & Luminance Ratio Profile
  const part3Start = PART1_LEN + PART2_LEN;
  for (let gy = 0; gy < DESCRIPTOR_GRID; gy++) {
    for (let gx = 0; gx < DESCRIPTOR_GRID; gx++) {
      const cellIndex = gy * DESCRIPTOR_GRID + gx;
      const w = Math.sqrt(FACE_GRID_WEIGHTS[cellIndex] ?? 1.0);
      let cellY = 0;
      let cellCrCb = 0;
      for (let py = gy * CELL; py < (gy + 1) * CELL; py++) {
        for (let px = gx * CELL; px < (gx + 1) * CELL; px++) {
          const idx = py * SIZE + px;
          cellY += (rawLuma[idx] ?? 0) - meanY;
          cellCrCb +=
            (rawCr[idx] ?? 0) - meanCr - ((rawCb[idx] ?? 0) - meanCb) * 0.5;
        }
      }
      const scale = 1 / (CELL * CELL * stdY);
      descriptor[part3Start + cellIndex * 2] = cellY * scale * w;
      descriptor[part3Start + cellIndex * 2 + 1] = cellCrCb * scale * w * 0.5;
    }
  }
  zeroMeanAndNormalizeSubVector(
    descriptor,
    part3Start,
    PART3_LEN,
    Math.sqrt(0.15),
  );

  // Final unit L2 normalization
  normalizeSubVector(descriptor, 0, TOTAL_DESCRIPTOR_LEN, 1.0);

  const confidenceScore = Math.min(
    0.99,
    0.76 +
      Math.min(0.15, bestEyeEdge * 0.015) +
      Math.min(0.08, bestSkinDensity * 0.1),
  );

  return {
    descriptor,
    score: confidenceScore,
    box: {
      x: faceBoxX,
      y: faceBoxY,
      width: faceBoxW,
      height: faceBoxH,
    },
    normalizedBox: {
      x: normX,
      y: normY,
      width: normW,
      height: normH,
    },
  };
}

function normalizeSubVector(
  vec: Float32Array,
  start: number,
  length: number,
  targetNorm: number,
): void {
  let normSq = 0;
  for (let i = start; i < start + length; i++) {
    const v = vec[i] ?? 0;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-8) return;
  const factor = targetNorm / norm;
  for (let i = start; i < start + length; i++) {
    vec[i] = (vec[i] ?? 0) * factor;
  }
}

function zeroMeanAndNormalizeSubVector(
  vec: Float32Array,
  start: number,
  length: number,
  targetNorm: number,
): void {
  let sum = 0;
  for (let i = start; i < start + length; i++) {
    sum += vec[i] ?? 0;
  }
  const mean = sum / length;
  for (let i = start; i < start + length; i++) {
    vec[i] = (vec[i] ?? 0) - mean;
  }
  normalizeSubVector(vec, start, length, targetNorm);
}

/**
 * Produces the exact horizontally-mirrored twin of a 1664D biometric descriptor
 * so mirrored webcam captures (`ctx.scale(-1, 1)`) and un-mirrored video/uploaded
 * photos match with zero mirror penalty.
 */
export function createMirroredDescriptor(src: Float32Array): Float32Array {
  if (src.length !== TOTAL_DESCRIPTOR_LEN) return src;
  const dst = new Float32Array(TOTAL_DESCRIPTOR_LEN);

  // Mirror Part 1 (8x8 grid, 20 bins/cell)
  for (let gy = 0; gy < DESCRIPTOR_GRID; gy++) {
    for (let gx = 0; gx < DESCRIPTOR_GRID; gx++) {
      const srcBase = (gy * DESCRIPTOR_GRID + gx) * DESCRIPTOR_BINS_PER_CELL;
      const dstBase =
        (gy * DESCRIPTOR_GRID + (DESCRIPTOR_GRID - 1 - gx)) *
        DESCRIPTOR_BINS_PER_CELL;

      for (let b = 0; b < 16; b++) {
        dst[dstBase + b] = src[srcBase + b] ?? 0;
      }
      // Swap +dx (bin 16) and -dx (bin 17)
      dst[dstBase + 16] = src[srcBase + 17] ?? 0;
      dst[dstBase + 17] = src[srcBase + 16] ?? 0;
      dst[dstBase + 18] = src[srcBase + 18] ?? 0;
      dst[dstBase + 19] = src[srcBase + 19] ?? 0;
    }
  }

  // Mirror Part 2 (16x16 template)
  for (let ty = 0; ty < TEMPLATE_SIZE; ty++) {
    for (let tx = 0; tx < TEMPLATE_SIZE; tx++) {
      const srcIdx = PART1_LEN + ty * TEMPLATE_SIZE + tx;
      const dstIdx = PART1_LEN + ty * TEMPLATE_SIZE + (TEMPLATE_SIZE - 1 - tx);
      dst[dstIdx] = src[srcIdx] ?? 0;
    }
  }

  // Mirror Part 3 (8x8 grid, 2 values/cell)
  const part3Start = PART1_LEN + PART2_LEN;
  for (let gy = 0; gy < DESCRIPTOR_GRID; gy++) {
    for (let gx = 0; gx < DESCRIPTOR_GRID; gx++) {
      const srcIdx = part3Start + (gy * DESCRIPTOR_GRID + gx) * 2;
      const dstIdx =
        part3Start + (gy * DESCRIPTOR_GRID + (DESCRIPTOR_GRID - 1 - gx)) * 2;
      dst[dstIdx] = src[srcIdx] ?? 0;
      dst[dstIdx + 1] = src[srcIdx + 1] ?? 0;
    }
  }

  return dst;
}

function rawEuclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

/**
 * Computes mirror-invariant L2 Euclidean distance between two normalized facial descriptors.
 * `distance <= 0.48` indicates a verified biometric match.
 */
export function computeFaceEuclideanDistance(
  a: Float32Array,
  b: Float32Array,
): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  const directDist = rawEuclideanDistance(a, b);
  const mirroredDist = rawEuclideanDistance(a, createMirroredDescriptor(b));
  return Math.min(directDist, mirroredDist);
}

/**
 * Converts Euclidean distance (`0.0` to `0.48`) into a biometric match percentage (`86%` to `99%`).
 */
export function distanceToConfidencePercent(distance: number): number {
  const clamped = Math.max(0.06, Math.min(0.48, distance));
  const pct = Math.round(99 - ((clamped - 0.06) / (0.48 - 0.06)) * 13);
  return Math.max(86, Math.min(99, pct));
}

/**
 * Loads an image URL or Data URI and extracts its biometric face descriptor.
 */
export function detectSingleFaceFromImageSrc(
  src: string,
): Promise<DetectedFaceResult | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(detectSingleFaceDescriptorSync(img));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Center-crops a live video frame into a standard 3:4 (`360x480`) portrait JPEG data URL.
 */
export function capturePortraitCanvas(
  video: HTMLVideoElement,
  mirrorHorizontal = true,
  existingCanvas?: HTMLCanvasElement,
): HTMLCanvasElement | null {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  if (vw <= 0 || vh <= 0) return null;

  const canvas = existingCanvas ?? document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const targetRatio = 3 / 4;
  const srcRatio = vw / vh;
  let sw = vw;
  let sh = vh;
  if (srcRatio > targetRatio) {
    sw = vh * targetRatio;
  } else {
    sh = vw / targetRatio;
  }
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  if (mirrorHorizontal) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function capturePortrait3x4FromVideo(
  video: HTMLVideoElement,
  mirrorHorizontal = true,
): string | null {
  return (
    capturePortraitCanvas(video, mirrorHorizontal)?.toDataURL(
      'image/jpeg',
      0.85,
    ) ?? null
  );
}

/**
 * Normalizes any uploaded image into a standard 3:4 (`360x480`) portrait JPEG data URL.
 */
export function normalizeImageFileToPortrait3x4(
  file: File,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        const targetRatio = 3 / 4;
        const srcRatio = img.width / img.height;
        let sw = img.width;
        let sh = img.height;
        if (srcRatio > targetRatio) {
          sw = img.height * targetRatio;
        } else {
          sh = img.width / targetRatio;
        }
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 360, 480);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
