export interface FaceWorkerResult {
  descriptorVersion: string;
  faceCount: number;
  descriptor: Float32Array | null;
  mirroredDescriptor: Float32Array | null;
  normalizedDataUrl: string;
}
export class FaceWorkerController {
  constructor(options?: {
    maxQueueSize?: number;
    defaultTimeoutMs?: number;
    idleTimeoutMs?: number;
    eagerStart?: boolean;
  });
  analyzePhoto(
    photo: string,
    options?: { signal?: AbortSignal },
  ): Promise<FaceWorkerResult>;
  shutdown(): Promise<void>;
}
