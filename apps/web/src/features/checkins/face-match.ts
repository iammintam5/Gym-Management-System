export interface FaceCandidate<T> {
  member: T;
  descriptor: Float32Array;
}

/** Thresholds apply exclusively to the trained 128-dimensional recognition model. */
export function selectFaceMatch<T>(
  descriptor: Float32Array,
  candidates: FaceCandidate<T>[],
): FaceCandidate<T> | null {
  if (descriptor.length !== 128 || !descriptor.every(Number.isFinite))
    return null;
  let best: FaceCandidate<T> | null = null;
  let bestDistance = Infinity;
  let secondDistance = Infinity;
  for (const candidate of candidates) {
    if (
      candidate.descriptor.length !== 128 ||
      !candidate.descriptor.every(Number.isFinite)
    )
      continue;
    let sum = 0;
    for (let index = 0; index < 128; index++)
      sum += (descriptor[index]! - candidate.descriptor[index]!) ** 2;
    const distance = Math.sqrt(sum);
    if (distance < bestDistance) {
      secondDistance = bestDistance;
      bestDistance = distance;
      best = candidate;
    } else secondDistance = Math.min(secondDistance, distance);
  }
  // Reject unknown and ambiguous identities rather than guessing the nearest member.
  return bestDistance <= 0.5 && secondDistance - bestDistance >= 0.05
    ? best
    : null;
}
