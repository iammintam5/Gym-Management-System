/** Bound camera startup and release streams that arrive after cancellation. */
export async function openCameraStream(
  video: HTMLVideoElement,
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
  constraints: MediaStreamConstraints,
  signal: AbortSignal,
  timeoutMs = 15000,
): Promise<MediaStream> {
  signal.throwIfAborted();
  let stream: MediaStream | undefined;
  let finished = false;
  let stage = 'device';
  let timer: ReturnType<typeof setTimeout>;
  let cleanup = () => {};
  try {
    return await new Promise<MediaStream>((resolve, reject) => {
      const stop = (error: unknown) => {
        if (finished) return;
        finished = true;
        stream?.getTracks().forEach((track) => track.stop());
        if (stream && video.srcObject === stream) video.srcObject = null;
        cleanup();
        reject(error);
      };
      const ready = () => {
        if (
          finished ||
          !stream ||
          video.readyState < 2 ||
          !video.videoWidth ||
          !video.videoHeight
        )
          return;
        finished = true;
        cleanup();
        resolve(stream);
      };
      const abort = () =>
        stop(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      const failed = () =>
        stop(
          new Error(
            'Camera không phát được hình. Kiểm tra camera trong ứng dụng Camera của Windows rồi kết nối lại.',
          ),
        );
      cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('canplay', ready);
        video.removeEventListener('playing', ready);
        video.removeEventListener('error', failed);
      };
      timer = setTimeout(
        () =>
          stop(
            new Error(
              stage === 'device'
                ? 'Camera chưa trả về luồng hình sau 15 giây. Kiểm tra quyền camera và đóng ứng dụng hoặc tab khác đang dùng camera.'
                : 'Đã kết nối camera nhưng chưa nhận được hình sau 15 giây. Kiểm tra camera trong ứng dụng Camera của Windows rồi kết nối lại.',
            ),
          ),
        timeoutMs,
      );
      signal.addEventListener('abort', abort, { once: true });
      video.addEventListener('loadeddata', ready);
      video.addEventListener('canplay', ready);
      video.addEventListener('playing', ready);
      video.addEventListener('error', failed);
      void mediaDevices.getUserMedia(constraints).then((received) => {
        if (finished || signal.aborted) {
          received.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = received;
        stage = 'video';
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        // Some drivers leave play() pending. A real video frame is sufficient;
        // don't hide a working stream while waiting for that promise to settle.
        try {
          void video.play().then(ready, (error: unknown) => stop(error));
          ready();
        } catch (error) {
          stop(error);
        }
      }, stop);
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
