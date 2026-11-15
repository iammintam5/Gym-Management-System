'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  SwitchCamera,
} from 'lucide-react';
import {
  CAMERA_STATION_RULES,
  CheckinStatus,
  type CameraCheckinRequest,
  type CameraStationState,
  type CheckinDetail,
  type CameraRosterMember,
  type CameraMemberPhoto,
} from '@gym/contracts';
import { apiClient, ApiError } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { openCameraStream } from '@/lib/camera-stream';
import { capturePortraitCanvas } from '@/lib/face-recognition';
import {
  describeFacePhoto,
  describeFace,
  retainFaceRecognizer,
  loadFaceRecognizer,
} from '@/lib/trained-face-recognition';
import { selectFaceMatch } from './face-match';
import { cn, formatTimeVi } from '@/lib/utils';
import { resolveStationId } from './station';

interface IndexedFace {
  member: CameraRosterMember;
  descriptor: Float32Array;
}

export function CameraStation() {
  const stationId = resolveStationId(useSearchParams().get('station'));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const descriptorCacheRef = useRef(
    new Map<string, { version: string; descriptor: Float32Array }>(),
  );
  const pendingAttemptRef = useRef<CameraCheckinRequest | null>(null);
  const indexRef = useRef<IndexedFace[]>([]);
  const busyRef = useRef(false);
  const pendingMatchRef = useRef<{ id: string; count: number } | null>(null);
  const presentMemberRef = useRef<string | null>(null);
  const emptyFramesRef = useRef(0);
  const retryAfterRef = useRef(0);
  const feedbackUntilRef = useRef(0);
  const aliveRef = useRef(true);
  const cooldownRef = useRef(new Map<string, number>());
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [scanning, setScanning] = useState(false);
  const [indexing, setIndexing] = useState(true);
  const [indexedCount, setIndexedCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [modelError, setModelError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [message, setMessage] = useState(
    'Mời bạn nhìn thẳng vào camera. Hệ thống sẽ tự động check-in.',
  );
  const [result, setResult] = useState<CheckinDetail | null>(null);

  const roster = useQuery({
    queryKey: ['camera-members'],
    queryFn: ({ signal }) =>
      apiClient.get<CameraRosterMember[]>('/checkins/camera/members', {
        signal,
        skipCache: true,
      }),
    retry: 1,
    staleTime: 60000,
    refetchInterval: 60000,
  });

  useEffect(() => retainFaceRecognizer(), []);

  useEffect(() => {
    if (!roster.data) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setIndexing(true);
        setModelError('');
        setProcessedCount(0);
        pendingMatchRef.current = null;
        const next: IndexedFace[] = [];
        const nextCache = new Map<
          string,
          { version: string; descriptor: Float32Array }
        >();
        try {
          await loadFaceRecognizer();
          for (const member of roster.data) {
            controller.signal.throwIfAborted();
            const cached = descriptorCacheRef.current.get(member.id);
            let descriptor =
              cached?.version === member.photoVersion
                ? cached.descriptor
                : null;
            if (!descriptor) {
              try {
                const photo = await apiClient.get<CameraMemberPhoto>(
                  `/checkins/camera/members/${member.id}/photo`,
                  { signal: controller.signal, skipCache: true },
                );
                if (photo.photoVersion !== member.photoVersion) continue;
                descriptor = (
                  await describeFacePhoto(photo.idPhotoUrl, controller.signal)
                ).descriptor;
              } catch {
                controller.signal.throwIfAborted();
              }
            }
            if (descriptor) {
              next.push({ member, descriptor });
              nextCache.set(member.id, {
                version: member.photoVersion,
                descriptor,
              });
            }
            if (!controller.signal.aborted)
              setProcessedCount((count) => count + 1);
          }
          controller.signal.throwIfAborted();
          // Never recognize against a partly populated roster.
          indexRef.current = next;
          descriptorCacheRef.current = nextCache;
          setIndexedCount(next.length);
        } catch {
          if (!controller.signal.aborted)
            setModelError(
              'Không chuẩn bị được nhận diện. Kiểm tra kết nối rồi thử lại.',
            );
        } finally {
          if (!controller.signal.aborted) setIndexing(false);
        }
      })();
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [roster.data]);

  useEffect(() => {
    aliveRef.current = true;
    const videoElement = videoRef.current;
    let cancelled = false;
    let ownedStream: MediaStream | null = null;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setStarting(true);
        setReady(false);
        setActive(false);
        setCameraError('');
        try {
          if (
            !window.isSecureContext ||
            !navigator.mediaDevices?.getUserMedia
          ) {
            throw new Error(
              'Camera cần trình duyệt hỗ trợ và địa chỉ localhost hoặc HTTPS được tin cậy.',
            );
          }
          if (!videoElement)
            throw new Error('Camera chưa sẵn sàng. Vui lòng kết nối lại.');
          const stream = await openCameraStream(
            videoElement,
            navigator.mediaDevices,
            {
              audio: false,
              video: {
                facingMode: { ideal: facing },
                frameRate: { ideal: 15, max: 24 },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            },
            controller.signal,
          );
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          ownedStream = stream;
          streamRef.current = stream;
          stream.getVideoTracks().forEach((track) => {
            track.onended = () => {
              if (cancelled) return;
              setActive(false);
              setReady(false);
              setCameraError(
                'Camera đã ngắt kết nối. Nhờ lễ tân kiểm tra camera.',
              );
            };
          });
          if (!cancelled) {
            setActive(true);
            setReady(true);
          }
        } catch (error) {
          ownedStream?.getTracks().forEach((track) => track.stop());
          if (!cancelled)
            setCameraError(
              error instanceof Error &&
                (error.message.startsWith('Camera ') ||
                  error.message.startsWith('Đã kết nối camera'))
                ? error.message
                : 'Không mở được camera. Nhờ lễ tân cho phép quyền camera và kiểm tra ứng dụng đang dùng camera.',
            );
        } finally {
          if (!cancelled) setStarting(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      controller.abort();
      aliveRef.current = false;
      window.clearTimeout(timer);
      ownedStream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
    };
  }, [cameraAttempt, facing]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => {
      setResult(null);
      setMessage(
        'Mời bạn nhìn thẳng vào camera. Hệ thống sẽ tự động check-in.',
      );
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await apiClient.post<CameraStationState>(
          `/checkins/camera/${encodeURIComponent(stationId)}/heartbeat`,
          {},
        );
        if (!cancelled) setSyncError('');
      } catch {
        if (!cancelled)
          setSyncError(
            'Mất kết nối với quầy lễ tân. Kiểm tra mạng trước khi tiếp tục.',
          );
      }
    };
    void heartbeat();
    const timer = window.setInterval(
      () => void heartbeat(),
      CAMERA_STATION_RULES.heartbeatIntervalMs,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, stationId]);

  const refetchRoster = roster.refetch;
  const submitPending = useCallback(
    async (signal: AbortSignal) => {
      const payload = pendingAttemptRef.current;
      if (!payload) return;
      try {
        const checkin = await apiClient.post<CheckinDetail>(
          '/checkins/camera',
          payload,
          { signal },
        );
        pendingAttemptRef.current = null;
        presentMemberRef.current = payload.memberId;
        cooldownRef.current.set(payload.memberId, Date.now());
        for (const [id, time] of cooldownRef.current)
          if (Date.now() - time > 300000) cooldownRef.current.delete(id);
        if (!aliveRef.current || signal.aborted) return;
        feedbackUntilRef.current = Date.now() + 8000;
        setResult(checkin);
        setMessage(
          checkin.status === CheckinStatus.ACCEPTED
            ? 'Đã ghi nhận check-in. Mời hội viên vào tập.'
            : (checkin.rejectionReason ?? 'Mời liên hệ lễ tân.'),
        );
        setSyncError('');
      } catch (error) {
        if (signal.aborted || !aliveRef.current) return;
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ) {
          pendingAttemptRef.current = null;
          pendingMatchRef.current = null;
          if (error.status === 409) void refetchRoster();
          else
            setModelError(
              'Không thể ghi nhận lượt này. Nhờ lễ tân kiểm tra rồi kết nối lại.',
            );
          setSyncError(error.message);
        } else {
          retryAfterRef.current = Date.now() + 10000;
          setSyncError(
            'Chưa xác nhận được lượt vừa quét. Đang tự kết nối lại; vui lòng chờ.',
          );
        }
      }
    },
    [refetchRoster],
  );

  const scan = useCallback(
    async (source: HTMLVideoElement, signal: AbortSignal) => {
      if (busyRef.current || Date.now() < retryAfterRef.current) return;
      busyRef.current = true;
      setScanning(true);
      try {
        if (pendingAttemptRef.current) {
          await submitPending(signal);
          return;
        }
        if (indexing || roster.isError || !indexRef.current.length) return;
        const canvas = capturePortraitCanvas(
          source,
          false,
          frameCanvasRef.current ?? undefined,
        );
        if (!canvas) return;
        frameCanvasRef.current = canvas;
        const detected = await describeFace(canvas, signal);
        signal.throwIfAborted();
        if (!aliveRef.current) return;
        if (!detected.descriptor) {
          pendingMatchRef.current = null;
          emptyFramesRef.current++;
          if (emptyFramesRef.current >= 3) presentMemberRef.current = null;
          if (Date.now() >= feedbackUntilRef.current)
            setMessage(
              detected.faceCount > 1
                ? 'Mỗi lần một hội viên đứng trước camera.'
                : 'Mời bạn nhìn thẳng và giữ khuôn mặt trong khung hình.',
            );
          return;
        }
        const best = selectFaceMatch(detected.descriptor, indexRef.current);
        if (!best) {
          pendingMatchRef.current = null;
          if (++emptyFramesRef.current >= 3) presentMemberRef.current = null;
          if (Date.now() >= feedbackUntilRef.current)
            setMessage(
              'Chưa khớp ảnh hồ sơ. Mời nhìn thẳng hoặc liên hệ lễ tân.',
            );
          return;
        }
        emptyFramesRef.current = 0;
        const previous = pendingMatchRef.current;
        pendingMatchRef.current = {
          id: best.member.id,
          count: previous?.id === best.member.id ? previous.count + 1 : 1,
        };
        if (
          presentMemberRef.current === best.member.id ||
          Date.now() - (cooldownRef.current.get(best.member.id) ?? 0) < 60000
        )
          return;
        if (pendingMatchRef.current.count < 2) {
          if (Date.now() >= feedbackUntilRef.current)
            setMessage('Đang xác nhận khuôn mặt. Mời bạn giữ yên.');
          return;
        }
        const photo = canvas.toDataURL('image/jpeg', 0.85);
        if (photo.length > CAMERA_STATION_RULES.maxImageLength)
          throw new Error('Portrait too large');
        signal.throwIfAborted();
        pendingAttemptRef.current = {
          memberId: best.member.id,
          stationId,
          capturedPhoto: photo,
          photoVersion: best.member.photoVersion,
          idempotencyKey: crypto.randomUUID(),
        };
        await submitPending(signal);
      } catch {
        if (aliveRef.current && !signal.aborted)
          setModelError(
            'Không xử lý được hình ảnh. Nhờ lễ tân kết nối lại nhận diện.',
          );
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setScanning(false);
      }
    },
    [stationId, indexing, roster.isError, submitPending],
  );

  useEffect(() => {
    if (!active || !ready || roster.isPending || modelError) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: number;
    const tick = async () => {
      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        await scan(video, controller.signal);
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 1500);
    };
    timer = window.setTimeout(() => void tick(), 0);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, ready, roster.isPending, modelError, scan]);

  const photoCount = roster.data?.length ?? 0;
  const preparing = roster.isPending || indexing;
  const available =
    active && ready && !preparing && !modelError && indexedCount > 0;
  return (
    <main className="flex min-h-dvh flex-col bg-[#09090B] px-3 py-4 text-white sm:px-6 lg:px-10">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <div>
          <p className="font-display text-2xl font-bold tracking-wider text-primary">
            AURA GYM
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Check-in tự động · {stationId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            aria-label="Đổi camera"
            disabled={starting || scanning}
            onClick={() =>
              setFacing((value) => (value === 'user' ? 'environment' : 'user'))
            }
          >
            <SwitchCamera className="size-4" />
          </Button>
          <Link
            href={`/dashboard/staff?station=${encodeURIComponent(stationId)}`}
            className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="size-4" /> Màn hình lễ tân
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-5 py-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-4xl">
            Mời bạn nhìn vào camera
          </h1>
          <p className="mt-2 text-zinc-400">
            Đứng trong khung hình và giữ yên trong giây lát
          </p>
        </div>
        <section
          aria-label="Camera check-in tự động"
          className="relative mx-auto aspect-[3/4] max-h-[65dvh] sm:aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-[#141418]"
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedData={() => setReady(true)}
            onPlaying={() => setReady(true)}
            aria-label="Camera trực tiếp"
            className={cn(
              'h-full w-full object-cover',
              facing === 'user' && '-scale-x-100',
              !active && 'opacity-0',
            )}
          />
          {!active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              {starting ? (
                <Loader2 className="size-12 animate-spin text-primary" />
              ) : (
                <CameraOff className="size-12 text-zinc-600" />
              )}
              <p className="max-w-md text-sm text-zinc-300">
                {starting
                  ? 'Đang kết nối camera… Cho phép camera nếu trình duyệt yêu cầu.'
                  : 'Đang chờ camera'}
              </p>
            </div>
          )}
          {active && (
            <div className="pointer-events-none absolute inset-y-[10%] inset-x-[15%] sm:inset-x-[32%] rounded-[45%] border-2 border-dashed border-white/60" />
          )}
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-xs backdrop-blur-sm">
            <span
              className={cn(
                'size-2 rounded-full',
                available ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            {cameraError
              ? 'Camera chưa kết nối'
              : roster.isError
                ? 'Không tải được hồ sơ'
                : modelError
                  ? 'Nhận diện gặp lỗi'
                  : !active || !ready
                    ? 'Đang kết nối camera'
                    : roster.isPending
                      ? 'Đang tải danh sách hội viên'
                      : indexing
                        ? `Đang chuẩn bị ảnh (${processedCount}/${photoCount})`
                        : available
                          ? 'Nhận diện tự động'
                          : 'Chưa có hồ sơ sẵn sàng'}
          </div>
          {scanning && (
            <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-xs">
              <Loader2 className="size-3 animate-spin" /> Đang nhận diện
            </div>
          )}
        </section>
        <section
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-2xl border px-6 py-5 text-center',
            result?.status === CheckinStatus.ACCEPTED
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : result
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-white/10 bg-[#141418]',
          )}
        >
          <div className="flex items-center justify-center gap-3">
            {result ? (
              result.status === CheckinStatus.ACCEPTED ? (
                <CheckCircle2 className="size-7 text-emerald-400" />
              ) : (
                <XCircle className="size-7 text-red-400" />
              )
            ) : (
              <Camera className="size-6 text-primary" />
            )}
            <h2 className="text-xl font-semibold">
              {result
                ? result.status === CheckinStatus.ACCEPTED
                  ? `Xin chào, ${result.memberFullName}`
                  : 'Mời liên hệ lễ tân'
                : 'Check-in tự động'}
            </h2>
          </div>
          <p className="mt-2 text-sm text-zinc-300">{message}</p>
          {result && (
            <p className="mt-2 text-xs text-zinc-500">
              Lượt gần nhất · {formatTimeVi(result.checkedInAt)}
            </p>
          )}
        </section>
        {(cameraError ||
          syncError ||
          modelError ||
          roster.isError ||
          (!preparing && !indexedCount)) && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center text-sm text-amber-200"
          >
            {cameraError ||
              syncError ||
              modelError ||
              (roster.isError
                ? 'Không tải được hồ sơ hội viên. Hệ thống đang tự kết nối lại.'
                : 'Chưa có ảnh hồ sơ nhận diện được. Nhờ lễ tân kiểm tra.')}
            {(cameraError || modelError) && (
              <Button
                variant="outline"
                className="ml-3"
                onClick={() => {
                  setModelError('');
                  setSyncError('');
                  setCameraAttempt((attempt) => attempt + 1);
                  void roster.refetch();
                }}
              >
                Kết nối lại camera
              </Button>
            )}
          </div>
        )}
        <p className="text-center text-xs text-zinc-500">
          {indexedCount} hồ sơ sẵn sàng
          {indexing
            ? ` · Đang chuẩn bị ${processedCount}/${photoCount} ảnh`
            : ''}{' '}
          · Kết quả được gửi tự động tới quầy lễ tân
        </p>
      </div>
    </main>
  );
}
