'use client';

type FaceApi = typeof import('@vladmandic/face-api');
let recognizerPromise: Promise<FaceApi> | null = null;
let inferenceQueue: Promise<unknown> = Promise.resolve();
let consumers = 0;
let jobs = 0;
let disposalTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleDisposal() {
  clearTimeout(disposalTimer);
  if (consumers || jobs) return;
  disposalTimer = setTimeout(() => {
    void recognizerPromise
      ?.then((api) => {
        if (consumers || jobs) return;
        api.nets.tinyFaceDetector.dispose();
        api.nets.faceLandmark68Net.dispose();
        api.nets.faceRecognitionNet.dispose();
        recognizerPromise = null;
      })
      .catch(() => undefined);
  }, 60000);
}

export function retainFaceRecognizer(): () => void {
  consumers++;
  clearTimeout(disposalTimer);
  return () => {
    consumers--;
    scheduleDisposal();
  };
}

/** Only face detection, landmarks and identity descriptors are loaded. */
export function loadFaceRecognizer(): Promise<FaceApi> {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      // The bundled browser runtime exposes these methods; its published declarations omit them.
      const tf = faceapi.tf as unknown as {
        setBackend: (backend: string) => Promise<boolean>;
        ready: () => Promise<void>;
      };
      try {
        if (!(await tf.setBackend('webgl')))
          throw new Error('WebGL unavailable');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.isLoaded
          ? Promise.resolve()
          : faceapi.nets.tinyFaceDetector.loadFromUri('/models/face-api'),
        faceapi.nets.faceLandmark68Net.isLoaded
          ? Promise.resolve()
          : faceapi.nets.faceLandmark68Net.loadFromUri('/models/face-api'),
        faceapi.nets.faceRecognitionNet.isLoaded
          ? Promise.resolve()
          : faceapi.nets.faceRecognitionNet.loadFromUri('/models/face-api'),
      ]);
      return faceapi;
    })().catch((error: unknown) => {
      recognizerPromise = null;
      throw error;
    });
  }
  return recognizerPromise;
}

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(
      () => finish(new Error('Photo load timeout')),
      6000,
    );
    function finish(error?: Error) {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = '';
        reject(error);
      } else resolve(image);
    }
    image.crossOrigin = 'anonymous';
    image.onload = () =>
      finish(
        image.naturalWidth * image.naturalHeight > 4000000
          ? new Error('Photo pixel limit exceeded')
          : undefined,
      );
    image.onerror = () => finish(new Error('Photo could not be loaded'));
    image.src = src;
  });
}

export interface TrainedFaceResult {
  faceCount: number;
  descriptor: Float32Array | null;
}

/** Serialize inference so roster preparation cannot overlap a live inference. */
export async function describeFace(
  image: HTMLImageElement | HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<TrainedFaceResult> {
  jobs++;
  clearTimeout(disposalTimer);
  try {
    const faceapi = await loadFaceRecognizer();
    const inference = inferenceQueue.then(async () => {
      signal?.throwIfAborted();
      const faces = await faceapi.detectAllFaces(
        image,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5,
        }),
      );
      signal?.throwIfAborted();
      if (faces.length !== 1)
        return { faceCount: faces.length, descriptor: null };
      // Compute the expensive identity embedding only after rejecting multi-face images.
      const described = await new faceapi.DetectAllFaceLandmarksTask(
        Promise.resolve(faces.map((detection) => ({ detection }))),
        image,
        false,
      ).withFaceDescriptors();
      signal?.throwIfAborted();
      return {
        faceCount: faces.length,
        descriptor: described[0]?.descriptor ?? null,
      };
    });
    inferenceQueue = inference.catch(() => undefined);
    return await inference;
  } finally {
    jobs--;
    scheduleDisposal();
  }
}

export async function describeFacePhoto(
  src: string,
  signal?: AbortSignal,
): Promise<TrainedFaceResult> {
  signal?.throwIfAborted();
  const image = await readImage(src);
  return describeFace(image, signal);
}
