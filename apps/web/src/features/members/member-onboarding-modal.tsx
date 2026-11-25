'use client';

import { FaceConflicts } from './face-conflicts';

import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { ModalFrame } from '@/components/ui/modal-frame';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  X,
  Camera,
  Sparkles,
  Copy,
  Check,
  Eye,
  EyeOff,
  Flame,
  ShieldCheck,
  Banknote,
  Landmark,
  Calendar,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  FlipHorizontal,
  Timer,
  ZoomIn,
  Trash2,
  ArrowRight,
  Move,
} from 'lucide-react';
import {
  Gender,
  PaymentStatus,
  SubscriptionStatus,
  type CreateMemberRequest,
  type CreateSubscriptionRequest,
  type MemberDetail,
  type MembershipPlanDetail,
  type PlanEntitlementItem,
  type SubscriptionDetail,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { apiClient, ApiClientError } from '@/services/api-client';
import {
  canCloseOrResetOnboarding,
  captureUnmirroredVideoFrame,
  createInitialOnboardingState,
  formatPhotoValidationFeedback,
  isOnboardingIdentityLocked,
  isSupportedPhotoDataUri,
  isVideoFrameReady,
  renderCroppedPortraitDataUrl,
  resetOnboardingState,
  resolvePhotoValidationStatus,
  runOnboardingSubmission,
  updateOnboardingIdentityFields,
  updateOnboardingPlanFields,
  validateOnboardingStep1,
  type KeyedPhotoValidationState,
  type OnboardingFlowState,
  type OnboardingStep,
} from './member-photo-flow';
import { sharedMemberPhotoValidator } from './photo-validation-client';

export interface MemberOnboardingResult {
  member: MemberDetail;
  subscription: SubscriptionDetail | null;
}

interface MemberOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  availablePlans: ReadonlyArray<MembershipPlanDetail>;
  plansLoading?: boolean;
  plansError?: string;
  onRetryPlans?: () => void;
  onSuccess: (result: MemberOnboardingResult, summaryMessage: string) => void;
  onIncompleteMemberDismissed?: (member: MemberDetail) => void;
}

function getInitials(fullName: string): string {
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'HV'
  );
}

function generateStrongPassword(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const suffixes = ['Gym', 'Fit', 'Pro', 'Club'];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)] ?? 'Gym';
  return `Aura@${digits}${suffix}`;
}

function formatPriceVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

function formatDurationClean(days: number): string {
  if (days === 30) return '1 tháng';
  if (days === 60) return '2 tháng';
  if (days === 90) return '3 tháng';
  if (days === 180) return '6 tháng';
  if (days === 365) return '12 tháng';
  if (days % 30 === 0) return `${days / 30} tháng`;
  return `${days} ngày`;
}

function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw.trim();
}

function formatDateVn(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatCompactEntitlement(ent: PlanEntitlementItem): string {
  if (ent.service === 'GYM_ACCESS') {
    return ent.limitType === 'UNLIMITED'
      ? 'Full Gym'
      : `${ent.limitValue ?? 0} buổi Gym`;
  }
  if (ent.service === 'CLASS') {
    return ent.limitType === 'UNLIMITED'
      ? 'Full Group Class'
      : `${ent.limitValue ?? 0} buổi Group Class`;
  }
  if (ent.service === 'PT') {
    return ent.limitType === 'UNLIMITED'
      ? 'Full PT 1-1'
      : `${ent.limitValue ?? 0} buổi PT 1-1`;
  }
  const label = ent.serviceName || ent.service;
  if (ent.limitType === 'UNLIMITED') return `Full ${label}`;
  if (ent.limitType === 'COUNT' && ent.limitValue !== null) {
    return `${ent.limitValue} buổi ${label}`;
  }
  return label;
}

export function MemberOnboardingModal({
  isOpen,
  onClose,
  availablePlans,
  onSuccess,
  onIncompleteMemberDismissed,
  plansLoading = false,
  plansError = '',
  onRetryPlans,
}: MemberOnboardingModalProps) {
  const [flow, setFlow] = useState<OnboardingFlowState>(() =>
    createInitialOnboardingState(),
  );
  const [showDiscard, setShowDiscard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Keyed validation result tied to exact photoDataUrl string
  const [photoValidation, setPhotoValidation] =
    useState<KeyedPhotoValidationState | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFrameReady, setCameraFrameReady] = useState(false);
  const [mirrorCamera, setMirrorCamera] = useState(true);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const rawImageRef = useRef<HTMLImageElement | null>(null);
  const [hasEditableSource, setHasEditableSource] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const photoLoadSeqRef = useRef(0);
  const activeSessionIdRef = useRef(1);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (canCloseOrResetOnboarding(flow)) {
      setFlow((prev) => resetOnboardingState(prev));
      setPhotoValidation(null);
      setHasEditableSource(false);
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      setShowPassword(false);
      setCopiedPwd(false);
      setCopiedSummary(false);
    }
  }

  useEffect(() => {
    activeSessionIdRef.current = flow.sessionId;
  }, [flow.sessionId]);

  const {
    activeStep,
    fields,
    fieldErrors,
    cameraNotice,
    isSubmitting,
    createdMemberCache,
    completedResult,
  } = flow;

  const {
    fullName,
    email,
    phone,
    gender,
    dob,
    password,
    photoDataUrl,
    attachPlan,
    selectedPlanId,
    activationMode,
    scheduledStartDate,
    paymentMethod,
    paymentStatus,
    posNote,
  } = fields;

  const identityLocked = isOnboardingIdentityLocked(flow);
  const photoValidationStatus = resolvePhotoValidationStatus(
    photoDataUrl,
    photoValidation,
  );
  const photoValidationMessage = formatPhotoValidationFeedback(
    photoValidationStatus,
    photoValidation,
  );

  const firstAvailablePlanId = availablePlans[0]?.id ?? '';
  const effectivePlanId = selectedPlanId || firstAvailablePlanId;
  const selectedPlan =
    availablePlans.find((p) => p.id === effectivePlanId) ??
    availablePlans[0] ??
    null;

  const setActiveStep = useCallback((step: OnboardingStep) => {
    setFlow((prev) =>
      prev.isSubmitting ? prev : { ...prev, activeStep: step },
    );
  }, []);

  const setCameraNotice = useCallback((notice: string | null) => {
    setFlow((prev) => ({ ...prev, cameraNotice: notice }));
  }, []);

  const stopWebcam = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraFrameReady(false);
    setCountdownSec(null);
  }, []);

  const markVideoReadyIfLoaded = useCallback(() => {
    if (isVideoFrameReady(videoRef.current)) {
      setCameraFrameReady(true);
    }
  }, []);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current
        .play()
        .then(() => {
          markVideoReadyIfLoaded();
        })
        .catch(() => undefined);
    }
  }, [cameraActive, activeStep, markVideoReadyIfLoaded]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!isOpen) {
      rawImageRef.current = null;
      photoLoadSeqRef.current += 1;
    }
    return () => {
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoEl && videoEl.srcObject) {
        const stream = videoEl.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const trimmed = photoDataUrl.trim();
    if (!isSupportedPhotoDataUri(trimmed)) return;
    if (photoValidation?.src === trimmed) return;

    const controller = new AbortController();
    const delayMs = sharedMemberPhotoValidator.peek(trimmed) ? 0 : 400;
    const timer = window.setTimeout(() => {
      void sharedMemberPhotoValidator
        .validate(trimmed, controller.signal)
        .then((outcome) => {
          if (!controller.signal.aborted) {
            setPhotoValidation({
              src: trimmed,
              valid: outcome.valid,
              faceCount: outcome.faceCount,
            });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPhotoValidation({
              src: trimmed,
              valid: false,
              faceCount: 0,
              failed: true,
            });
          }
        });
    }, delayMs);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [photoDataUrl, photoValidation?.src]);

  const loadSourceImageForCrop = useCallback(
    (dataUri: string) => {
      const seq = ++photoLoadSeqRef.current;
      const img = new Image();
      img.onload = () => {
        if (photoLoadSeqRef.current !== seq) return;
        if (img.naturalWidth * img.naturalHeight > 4000000) {
          setCameraNotice(
            'Ảnh tối đa 4 triệu điểm ảnh. Vui lòng chọn ảnh nhỏ hơn.',
          );
          img.src = '';
          return;
        }
        rawImageRef.current = img;
        setHasEditableSource(true);
        setCropZoom(1);
        setCropOffset({ x: 0, y: 0 });
        const cropped = renderCroppedPortraitDataUrl(img, 1, 0, 0);
        setFlow((prev) =>
          updateOnboardingIdentityFields(prev, { photoDataUrl: cropped }),
        );
      };
      img.onerror = () => {
        if (photoLoadSeqRef.current !== seq) return;
        setCameraNotice('Không thể đọc dữ liệu ảnh. Vui lòng chọn ảnh khác.');
      };
      img.src = dataUri;
    },
    [setCameraNotice],
  );

  const handleZoomChange = (nextZoom: number) => {
    if (identityLocked) return;
    setCropZoom(nextZoom);
    if (rawImageRef.current) {
      const cropped = renderCroppedPortraitDataUrl(
        rawImageRef.current,
        nextZoom,
        cropOffset.x,
        cropOffset.y,
      );
      setFlow((prev) =>
        updateOnboardingIdentityFields(prev, { photoDataUrl: cropped }),
      );
    }
  };

  const handlePointerDownFrame = (e: React.PointerEvent<HTMLDivElement>) => {
    if (identityLocked || !hasEditableSource || cameraActive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPanning(true);
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: cropOffset.x,
      startY: cropOffset.y,
    };
  };

  const handlePointerMoveFrame = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      identityLocked ||
      !isPanning ||
      !panStartRef.current ||
      !rawImageRef.current
    ) {
      return;
    }
    const dx = (e.clientX - panStartRef.current.clientX) / 90;
    const dy = (e.clientY - panStartRef.current.clientY) / 110;
    const nextX = Math.max(-1, Math.min(1, panStartRef.current.startX + dx));
    const nextY = Math.max(-1, Math.min(1, panStartRef.current.startY + dy));
    setCropOffset({ x: nextX, y: nextY });
    const cropped = renderCroppedPortraitDataUrl(
      rawImageRef.current,
      cropZoom,
      nextX,
      nextY,
    );
    setFlow((prev) =>
      updateOnboardingIdentityFields(prev, { photoDataUrl: cropped }),
    );
  };

  const handlePointerUpFrame = () => {
    setIsPanning(false);
    panStartRef.current = null;
  };

  const resetForm = () => {
    if (!canCloseOrResetOnboarding(flow)) return;
    setShowDiscard(false);
    const dismissedIncomplete = flow.createdMemberCache;
    stopWebcam();
    rawImageRef.current = null;
    photoLoadSeqRef.current += 1;
    const nextSessionId = flow.sessionId + 1;
    activeSessionIdRef.current = nextSessionId;
    setFlow((prev) => resetOnboardingState(prev));
    setPhotoValidation(null);
    setHasEditableSource(false);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setShowPassword(false);
    setCopiedPwd(false);
    setCopiedSummary(false);
    if (dismissedIncomplete) {
      onIncompleteMemberDismissed?.(dismissedIncomplete);
    }
  };

  const finishClose = () => {
    if (!canCloseOrResetOnboarding(flow)) return;
    resetForm();
    onClose();
  };
  const handleClose = () => {
    if (!canCloseOrResetOnboarding(flow)) return;
    const dirty = Boolean(
      fullName ||
      email ||
      phone ||
      dob ||
      photoDataUrl ||
      posNote ||
      password !== 'Member@123456' ||
      gender !== Gender.MALE ||
      !attachPlan ||
      activationMode === 'SCHEDULED' ||
      paymentMethod !== 'TRANSFER' ||
      paymentStatus !== PaymentStatus.PAID,
    );
    if (!completedResult && (dirty || createdMemberCache)) setShowDiscard(true);
    else finishClose();
  };

  const startWebcam = async (deviceIdOverride?: string) => {
    if (identityLocked) return;
    setCameraNotice(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraNotice(
        'Trình duyệt không hỗ trợ truy cập Camera. Vui lòng dùng trình duyệt có hỗ trợ webcam.',
      );
      return;
    }
    try {
      stopWebcam();
      const targetDevice = deviceIdOverride ?? selectedDeviceId;
      const constraints: MediaStreamConstraints = {
        video: targetDevice
          ? {
              deviceId: { exact: targetDevice },
              width: { ideal: 720 },
              height: { ideal: 960 },
            }
          : { width: { ideal: 720 }, height: { ideal: 960 } },
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setCameraFrameReady(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current
          .play()
          .then(() => {
            markVideoReadyIfLoaded();
          })
          .catch(() => undefined);
      }
      setCameraActive(true);

      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setCameraDevices(videoInputs);
        if (!selectedDeviceId && videoInputs[0]?.deviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      }
    } catch {
      setCameraNotice(
        'Không thể mở Webcam. Vui lòng kiểm tra quyền Camera và kết nối thiết bị rồi thử lại.',
      );
    }
  };

  const executeFrameCapture = useCallback(() => {
    if (identityLocked) return;
    const rawDataUri = captureUnmirroredVideoFrame(videoRef.current);
    if (!rawDataUri) {
      setCameraNotice(
        'Camera đang khởi động khung hình, vui lòng chờ hình ảnh hiện rõ rồi chụp lại.',
      );
      return;
    }
    setCameraNotice(null);
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 180);
    loadSourceImageForCrop(rawDataUri);
    stopWebcam();
  }, [identityLocked, loadSourceImageForCrop, setCameraNotice, stopWebcam]);

  const handleCountdownCapture = () => {
    if (
      identityLocked ||
      !cameraActive ||
      !cameraFrameReady ||
      countdownSec !== null
    ) {
      return;
    }
    setCountdownSec(3);
    let current = 3;
    countdownTimerRef.current = window.setInterval(() => {
      current -= 1;
      if (current > 0) {
        setCountdownSec(current);
      } else {
        if (countdownTimerRef.current !== null) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdownSec(null);
        executeFrameCapture();
      }
    }, 850);
  };

  const handleClearPhoto = () => {
    if (identityLocked) return;
    photoLoadSeqRef.current += 1;
    rawImageRef.current = null;
    setPhotoValidation(null);
    setHasEditableSource(false);
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setFlow((prev) =>
      updateOnboardingIdentityFields(prev, { photoDataUrl: '' }),
    );
  };

  const validateStep1 = (): boolean => {
    if (createdMemberCache) return true;
    const nextErrors = validateOnboardingStep1(fields);
    setFlow((prev) => ({ ...prev, fieldErrors: nextErrors }));
    return Object.keys(nextErrors).length === 0;
  };

  const handleNextStep = () => {
    if (activeStep === 1) {
      if (!validateStep1()) return;
      setActiveStep(2);
    } else if (activeStep === 2) {
      stopWebcam();
      setActiveStep(3);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (attachPlan && (plansLoading || plansError)) return;
    stopWebcam();

    const submission = await runOnboardingSubmission({
      snapshot: flow,
      getCurrentSessionId: () => activeSessionIdRef.current,
      setState: setFlow,
      selectedPlan,
      validatePhoto: async (src) => {
        const outcome = await sharedMemberPhotoValidator.validate(src);
        setPhotoValidation({
          src: src.trim(),
          valid: outcome.valid,
          faceCount: outcome.faceCount,
        });
        return outcome;
      },
      createMember: (memberPayload: CreateMemberRequest) =>
        apiClient.post<MemberDetail>('/members', memberPayload),
      createSubscription: (subPayload: CreateSubscriptionRequest) =>
        apiClient.post<SubscriptionDetail>('/subscriptions', subPayload),
      extractErrorMessage: (err) =>
        err instanceof ApiClientError
          ? err.message
          : 'Không thể hoàn tất đăng ký hội viên.',
    });

    if (submission.status === 'completed') {
      onSuccess(submission.result, submission.summaryMessage);
    }
  };

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopiedPwd(true);
      window.setTimeout(() => setCopiedPwd(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyCredentialsSummary = async () => {
    if (!completedResult) return;
    const text = [
      `THẺ HỘI VIÊN AURA GYM`,
      `Mã thẻ: ${completedResult.member.memberCode}`,
      `Họ và tên: ${completedResult.member.fullName}`,
      `Email đăng nhập: ${completedResult.member.email}`,
      `Mật khẩu khởi tạo: ${password}`,
      completedResult.subscription
        ? `Gói tập: ${completedResult.subscription.plan.name}`
        : `Gói tập: Chưa đăng ký gói`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (!isOpen) return null;

  const previewStart =
    activationMode === 'SCHEDULED' && scheduledStartDate
      ? new Date(scheduledStartDate)
      : new Date();
  const previewEnd = selectedPlan
    ? new Date(
        previewStart.getTime() +
          selectedPlan.durationDays * 24 * 60 * 60 * 1000,
      )
    : null;

  return (
    <>
      <ModalFrame
        onClose={handleClose}
        labelledBy="features-members-member-onboarding-modal-heading-0"
        maxWidthClassName="max-w-[1080px]"
      >
        {/* KHUNG MODAL CỐ ĐỊNH KÍCH THƯỚC: 1080px x 600px */}
        <div className="relative flex w-full max-w-[1080px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121216] shadow-2xl lg:h-[600px]">
          {/* Header cố định 64px */}
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0D0D10] px-6">
            <div className="flex items-center gap-3">
              <div>
                <h2
                  className="text-lg font-semibold text-white"
                  id="features-members-member-onboarding-modal-heading-0"
                >
                  {completedResult ? 'Đăng ký hoàn tất' : 'Đăng ký hội viên'}
                </h2>
                <p className="text-[11px] text-zinc-400">
                  {completedResult
                    ? 'Hồ sơ hội viên, ảnh định danh cổng và gói tập đã sẵn sàng.'
                    : 'Khởi tạo hồ sơ, chụp ảnh thẻ định danh và kích hoạt gói tập tại quầy'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              aria-label="Đóng cửa sổ đăng ký hội viên"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Thân Modal 2 cột cố định 536px */}
          <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
            {/* CỘT TRÁI (7 cột): Khung thao tác 3 bước */}
            <div className="flex flex-col justify-between border-b border-white/[0.07] px-6 py-5 lg:col-span-7 lg:h-[536px] lg:border-r lg:border-b-0">
              {completedResult ? (
                <div className="flex h-full flex-col justify-between">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                          <Check className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                            Hoàn tất cấp thẻ
                          </p>
                          <h3 className="text-base font-bold text-white tabular-nums">
                            {completedResult.member.fullName} •{' '}
                            {completedResult.member.memberCode}
                          </h3>
                        </div>
                      </div>
                    </div>

                    {/* Thông tin bàn giao tài khoản */}
                    <div className="rounded-xl border border-white/10 bg-[#18181C] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          Thông tin tài khoản bàn giao
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyCredentialsSummary()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-[#FF5500] hover:text-white"
                        >
                          {copiedSummary ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                              <span>Đã sao chép</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-[#FF5500]" />
                              <span>Sao chép thông tin thẻ</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="rounded-lg border border-white/[0.06] bg-[#121216] p-2.5">
                          <p className="text-[10px] text-zinc-500">
                            Mã hội viên
                          </p>
                          <p className="mt-0.5 text-sm font-bold text-[#FF5500] tabular-nums">
                            {completedResult.member.memberCode}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-[#121216] p-2.5">
                          <p className="text-[10px] text-zinc-500">
                            Ảnh định danh cổng
                          </p>
                          <p className="mt-0.5 font-semibold text-white">
                            {completedResult.member.idPhotoUrl
                              ? 'Đã xác thực tại quầy'
                              : 'Chụp bổ sung sau'}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-[#121216] p-2.5">
                          <p className="text-[10px] text-zinc-500">
                            Email đăng nhập
                          </p>
                          <p className="mt-0.5 truncate font-medium text-zinc-200">
                            {completedResult.member.email}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-[#121216] p-2.5">
                          <p className="text-[10px] text-zinc-500">
                            Mật khẩu khởi tạo
                          </p>
                          <p className="mt-0.5 font-medium text-zinc-200 tabular-nums">
                            {password}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Trạng thái gói tập */}
                    <div className="rounded-xl border border-white/10 bg-[#18181C] p-3.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Trạng thái gói tập
                          </p>
                          <p className="mt-0.5 text-sm font-bold text-white">
                            {completedResult.subscription
                              ? completedResult.subscription.plan.name
                              : 'Chỉ tạo hồ sơ (Chưa gắn gói tập)'}
                          </p>
                        </div>
                        {completedResult.subscription && (
                          <span
                            className={cn(
                              'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                              completedResult.subscription.effectiveStatus ===
                                SubscriptionStatus.ACTIVE
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                                : 'border-amber-500/40 bg-amber-500/15 text-amber-400',
                            )}
                          >
                            {completedResult.subscription.effectiveStatus ===
                            SubscriptionStatus.ACTIVE
                              ? 'Kích hoạt hôm nay'
                              : 'Hẹn ngày kích hoạt'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-white/[0.07] pt-3.5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#18181C] px-4 text-xs font-semibold text-zinc-200 hover:border-white/25 hover:text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Đăng ký hội viên tiếp theo
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#FF5500] px-5 text-xs font-semibold text-white hover:bg-[#E64D00]"
                    >
                      <Check className="h-4 w-4" />
                      Hoàn tất
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleCompleteOnboarding}
                  className="flex h-full flex-col justify-between"
                  noValidate
                >
                  {/* Thanh chuyển bước */}
                  <div className="grid shrink-0 grid-cols-3 gap-2 rounded-xl border border-white/[0.07] bg-[#0D0D10] p-1">
                    {[
                      { step: 1 as const, label: '1. Hồ sơ' },
                      { step: 2 as const, label: '2. Ảnh nhận diện' },
                      { step: 3 as const, label: '3. Gói & thanh toán' },
                    ].map((item) => {
                      const isCurrent = activeStep === item.step;
                      const isDone = activeStep > item.step;
                      return (
                        <button
                          key={item.step}
                          disabled={isSubmitting}
                          type="button"
                          onClick={() => {
                            if (item.step > 1 && !validateStep1()) return;
                            if (item.step !== 2) stopWebcam();
                            setActiveStep(item.step);
                          }}
                          className={cn(
                            'flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all',
                            isCurrent
                              ? 'bg-[#FF5500] text-white shadow'
                              : isDone
                                ? 'bg-white/[0.05] text-emerald-400 hover:bg-white/[0.08]'
                                : 'text-zinc-400 hover:text-zinc-200',
                          )}
                        >
                          {isDone && <Check className="h-3.5 w-3.5" />}
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Vùng nội dung từng bước cố định chiều cao */}
                  <div className="my-3 flex min-h-0 flex-1 flex-col justify-center overflow-y-auto pr-0.5">
                    {createdMemberCache && (
                      <div
                        role="status"
                        className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200"
                      >
                        <span className="leading-relaxed">
                          Hồ sơ{' '}
                          <strong className="text-white">
                            {createdMemberCache.fullName}
                          </strong>{' '}
                          (
                          <span className="font-mono text-[#FF5500] tabular-nums">
                            {createdMemberCache.memberCode}
                          </span>
                          ) đã được lưu. Thông tin cá nhân và ảnh thẻ đã khóa để
                          không mất dữ liệu; bấm thử lại ở Bước 3 để hoàn tất
                          gói tập cho hội viên này.
                        </span>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={resetForm}
                          className="shrink-0 rounded-lg border border-white/15 bg-[#18181C] px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Tạo hồ sơ người mới
                        </button>
                      </div>
                    )}

                    {fieldErrors.general && (
                      <div
                        role="alert"
                        className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs text-red-300"
                      >
                        {fieldErrors.general}
                        <FaceConflicts conflicts={fieldErrors.conflicts} />
                      </div>
                    )}

                    {/* BƯỚC 1: HỒ SƠ & TÀI KHOẢN */}
                    {activeStep === 1 && (
                      <div className="space-y-4">
                        {/* Hàng 1: Họ tên + Số điện thoại */}
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-12">
                          <div className="sm:col-span-7">
                            <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                              Họ và tên{' '}
                              <span className="text-[#FF5500]">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              disabled={identityLocked}
                              value={fullName}
                              onChange={(e) =>
                                setFlow((prev) =>
                                  updateOnboardingIdentityFields(prev, {
                                    fullName: e.target.value,
                                  }),
                                )
                              }
                              placeholder="Nguyễn Minh Quân"
                              className={cn(
                                'h-10 w-full rounded-xl border bg-[#18181C] px-3.5 text-xs text-white placeholder-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                                fieldErrors.fullName
                                  ? 'border-red-500 focus:border-red-500'
                                  : 'border-white/10 focus:border-[#FF5500]',
                              )}
                            />
                            {fieldErrors.fullName && (
                              <p className="mt-1 text-[11px] text-red-400">
                                {fieldErrors.fullName}
                              </p>
                            )}
                          </div>

                          <div className="sm:col-span-5">
                            <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                              Số điện thoại
                            </label>
                            <input
                              type="tel"
                              disabled={identityLocked}
                              value={phone}
                              onChange={(e) =>
                                setFlow((prev) =>
                                  updateOnboardingIdentityFields(prev, {
                                    phone: e.target.value,
                                  }),
                                )
                              }
                              placeholder="0903 123 456"
                              className={cn(
                                'h-10 w-full rounded-xl border bg-[#18181C] px-3.5 text-xs text-white tabular-nums placeholder-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                                fieldErrors.phone
                                  ? 'border-red-500 focus:border-red-500'
                                  : 'border-white/10 focus:border-[#FF5500]',
                              )}
                            />
                            {fieldErrors.phone && (
                              <p className="mt-1 text-[11px] text-red-400">
                                {fieldErrors.phone}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Hàng 2: Email + Ngày sinh */}
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-12">
                          <div className="sm:col-span-7">
                            <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                              Địa chỉ Email{' '}
                              <span className="text-[#FF5500]">*</span>
                            </label>
                            <input
                              type="email"
                              required
                              disabled={identityLocked}
                              value={email}
                              onChange={(e) =>
                                setFlow((prev) =>
                                  updateOnboardingIdentityFields(prev, {
                                    email: e.target.value,
                                  }),
                                )
                              }
                              placeholder="hoivien@auragym.vn"
                              className={cn(
                                'h-10 w-full rounded-xl border bg-[#18181C] px-3.5 text-xs text-white placeholder-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                                fieldErrors.email
                                  ? 'border-red-500 focus:border-red-500'
                                  : 'border-white/10 focus:border-[#FF5500]',
                              )}
                            />
                            {fieldErrors.email && (
                              <p className="mt-1 text-[11px] text-red-400">
                                {fieldErrors.email}
                              </p>
                            )}
                          </div>

                          <div className="sm:col-span-5">
                            <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                              Ngày sinh
                            </label>
                            <input
                              type="date"
                              disabled={identityLocked}
                              value={dob}
                              onChange={(e) =>
                                setFlow((prev) =>
                                  updateOnboardingIdentityFields(prev, {
                                    dob: e.target.value,
                                  }),
                                )
                              }
                              aria-label="Ngày sinh hội viên"
                              className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-xs text-white tabular-nums focus:border-[#FF5500] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                        </div>

                        {/* Hàng 3: Giới tính + Mật khẩu khởi tạo */}
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-12">
                          <div className="sm:col-span-5">
                            <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                              Giới tính
                            </label>
                            <div className="grid h-10 grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#18181C] p-1">
                              {[
                                { value: Gender.MALE, label: 'Nam' },
                                { value: Gender.FEMALE, label: 'Nữ' },
                                { value: Gender.OTHER, label: 'Khác' },
                              ].map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  disabled={identityLocked}
                                  onClick={() =>
                                    setFlow((prev) =>
                                      updateOnboardingIdentityFields(prev, {
                                        gender: opt.value,
                                      }),
                                    )
                                  }
                                  className={cn(
                                    'rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    gender === opt.value
                                      ? 'bg-[#FF5500] text-white'
                                      : 'text-zinc-400 hover:text-white',
                                  )}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="sm:col-span-7">
                            <div className="mb-1.5 flex items-center justify-between">
                              <label className="text-xs font-medium text-zinc-300">
                                Mật khẩu khởi tạo
                              </label>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={identityLocked}
                                  onClick={() =>
                                    setFlow((prev) =>
                                      updateOnboardingIdentityFields(prev, {
                                        password: generateStrongPassword(),
                                      }),
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#18181C] px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:border-[#FF5500] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Sparkles className="h-2.5 w-2.5 text-[#FF5500]" />
                                  Tạo ngẫu nhiên
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyPassword()}
                                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#18181C] px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:border-white/25 hover:text-white"
                                >
                                  {copiedPwd ? (
                                    <>
                                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                                      <span>Đã chép</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-2.5 w-2.5" />
                                      <span>Sao chép</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="relative">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                disabled={identityLocked}
                                value={password}
                                onChange={(e) =>
                                  setFlow((prev) =>
                                    updateOnboardingIdentityFields(prev, {
                                      password: e.target.value,
                                    }),
                                  )
                                }
                                aria-label="Mật khẩu khởi tạo"
                                className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] pr-9 pl-3.5 text-xs text-white tabular-nums focus:border-[#FF5500] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((prev) => !prev)}
                                aria-label="Ẩn hoặc hiện mật khẩu"
                                className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 hover:text-white"
                              >
                                {showPassword ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            {fieldErrors.password && (
                              <p className="mt-1 text-[11px] text-red-400">
                                {fieldErrors.password}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* BƯỚC 2: BUỒNG CHỤP & CĂN CHỈNH ẢNH THẺ */}
                    {activeStep === 2 && (
                      <div className="grid grid-cols-1 gap-5 rounded-2xl border border-white/[0.08] bg-[#16161B] p-4 sm:grid-cols-12 sm:items-center">
                        {/* Khung ngắm chân dung bên trái */}
                        <div className="flex flex-col items-center sm:col-span-5">
                          <div
                            onPointerDown={handlePointerDownFrame}
                            onPointerMove={handlePointerMoveFrame}
                            onPointerUp={handlePointerUpFrame}
                            onPointerCancel={handlePointerUpFrame}
                            className={cn(
                              'relative aspect-[3/4] w-44 select-none overflow-hidden rounded-2xl border-2 bg-[#09090B] shadow-inner transition-colors',
                              cameraActive
                                ? 'border-[#FF5500]'
                                : photoValidationStatus === 'valid'
                                  ? 'border-emerald-500/60'
                                  : photoValidationStatus === 'invalid'
                                    ? 'border-amber-500/60'
                                    : photoDataUrl
                                      ? 'border-white/25'
                                      : 'border-white/15',
                              hasEditableSource &&
                                !cameraActive &&
                                !identityLocked
                                ? 'cursor-grab active:cursor-grabbing'
                                : '',
                            )}
                          >
                            {cameraActive ? (
                              <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                onLoadedData={markVideoReadyIfLoaded}
                                onCanPlay={markVideoReadyIfLoaded}
                                onPlaying={markVideoReadyIfLoaded}
                                className={cn(
                                  'h-full w-full object-cover',
                                  mirrorCamera && '-scale-x-100',
                                )}
                              />
                            ) : photoDataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={photoDataUrl}
                                alt={fullName || 'Ảnh thẻ hội viên'}
                                draggable={false}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
                                <svg
                                  viewBox="0 0 120 160"
                                  className="h-28 w-20 text-white/15"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeDasharray="4 4"
                                >
                                  <ellipse cx="60" cy="54" rx="24" ry="30" />
                                  <path d="M18 142 C18 106, 102 106, 102 142" />
                                </svg>
                                <span className="mt-1 text-[10px] font-medium text-zinc-400">
                                  Kéo thả ảnh hoặc bật camera
                                </span>
                              </div>
                            )}

                            {cameraActive && (
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                <svg
                                  viewBox="0 0 120 160"
                                  className="h-full w-full text-white/30"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.2"
                                  strokeDasharray="3 3"
                                >
                                  <ellipse cx="60" cy="58" rx="27" ry="34" />
                                  <path d="M16 148 C16 110, 104 110, 104 148" />
                                </svg>
                              </div>
                            )}

                            {cameraActive && !cameraFrameReady && (
                              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                                <span className="rounded-full bg-black/75 px-2.5 py-0.5 text-[10px] font-medium text-zinc-200">
                                  Đang mở khung hình camera...
                                </span>
                              </div>
                            )}

                            <div className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 border-t-2 border-l-2 border-[#FF5500]" />
                            <div className="pointer-events-none absolute top-2.5 right-2.5 h-3.5 w-3.5 border-t-2 border-r-2 border-[#FF5500]" />
                            <div className="pointer-events-none absolute bottom-2.5 left-2.5 h-3.5 w-3.5 border-b-2 border-l-2 border-[#FF5500]" />
                            <div className="pointer-events-none absolute right-2.5 bottom-2.5 h-3.5 w-3.5 border-r-2 border-b-2 border-[#FF5500]" />

                            {countdownSec !== null && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[1px]">
                                <span className="font-heading text-5xl font-bold text-[#FF5500] animate-ping">
                                  {countdownSec}
                                </span>
                              </div>
                            )}

                            {shutterFlash && (
                              <div className="absolute inset-0 bg-white/90 transition-opacity" />
                            )}

                            {hasEditableSource &&
                              !cameraActive &&
                              !identityLocked && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-medium text-zinc-200">
                                    <Move className="h-2.5 w-2.5 text-[#FF5500]" />
                                    Kéo để căn mặt
                                  </span>
                                </div>
                              )}
                          </div>
                        </div>

                        {/* Điều khiển Camera & Zoom bên phải */}
                        <div className="space-y-3.5 sm:col-span-7">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-white">
                                Ảnh ID Check-in tại cổng
                              </span>
                              <p className="text-[11px] text-zinc-400">
                                Chụp Webcam đối chiếu khuôn mặt khi Check-in qua
                                cổng
                              </p>
                            </div>
                            {photoDataUrl &&
                              !cameraActive &&
                              !identityLocked && (
                                <button
                                  type="button"
                                  onClick={handleClearPhoto}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Xoá ảnh
                                </button>
                              )}
                          </div>

                          {!cameraActive ? (
                            <div className="grid gap-2.5">
                              <button
                                type="button"
                                disabled={identityLocked}
                                onClick={() => void startWebcam()}
                                className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-[#FF5500]/50 bg-[#FF5500]/15 p-3 text-xs font-semibold text-white transition-colors hover:bg-[#FF5500]/25 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Camera className="h-4 w-4 text-[#FF5500]" />
                                <span>
                                  {photoDataUrl
                                    ? 'Chụp lại Webcam'
                                    : 'Mở Webcam quầy'}
                                </span>
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2 rounded-xl border border-white/10 bg-[#121216] p-2.5">
                              {cameraDevices.length > 1 && (
                                <select
                                  value={selectedDeviceId}
                                  onChange={(e) => {
                                    setSelectedDeviceId(e.target.value);
                                    void startWebcam(e.target.value);
                                  }}
                                  aria-label="Chọn thiết bị camera"
                                  className="h-8 w-full rounded-lg border border-white/10 bg-[#18181C] px-2.5 text-xs text-white focus:border-[#FF5500] focus:outline-none"
                                >
                                  {cameraDevices.map((dev, i) => (
                                    <option
                                      key={dev.deviceId}
                                      value={dev.deviceId}
                                    >
                                      {dev.label || `Camera ${i + 1}`}
                                    </option>
                                  ))}
                                </select>
                              )}

                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={executeFrameCapture}
                                  disabled={
                                    countdownSec !== null || !cameraFrameReady
                                  }
                                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-[#FF5500] px-2.5 text-xs font-semibold text-white hover:bg-[#E64D00] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Camera className="h-3.5 w-3.5" />
                                  {cameraFrameReady
                                    ? 'Chụp ngay'
                                    : 'Đang mở...'}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCountdownCapture}
                                  disabled={
                                    countdownSec !== null || !cameraFrameReady
                                  }
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-[#18181C] px-2.5 text-xs font-semibold text-zinc-200 hover:border-[#FF5500] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Timer className="h-3.5 w-3.5 text-[#FF5500]" />
                                  Đếm ngược
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMirrorCamera((prev) => !prev)
                                  }
                                  aria-label="Lật gương xem trước camera"
                                  className={cn(
                                    'inline-flex h-8 items-center rounded-lg border px-2 text-xs',
                                    mirrorCamera
                                      ? 'border-[#FF5500]/50 bg-[#FF5500]/10 text-[#FF5500]'
                                      : 'border-white/10 bg-[#18181C] text-zinc-400',
                                  )}
                                >
                                  <FlipHorizontal className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={stopWebcam}
                                  className="inline-flex h-8 items-center rounded-lg border border-white/10 px-2 text-xs text-zinc-400 hover:text-white"
                                >
                                  Đóng
                                </button>
                              </div>
                            </div>
                          )}

                          {hasEditableSource &&
                            !cameraActive &&
                            !identityLocked && (
                              <div className="rounded-xl border border-white/[0.08] bg-[#121216] px-3 py-2 space-y-1.5">
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-300">
                                  <ZoomIn className="h-3 w-3 text-[#FF5500]" />
                                  Phóng to &amp; căn khung chân dung
                                </span>
                                <input
                                  type="range"
                                  min={1}
                                  max={2.5}
                                  step={0.05}
                                  value={cropZoom}
                                  onChange={(e) =>
                                    handleZoomChange(Number(e.target.value))
                                  }
                                  aria-label="Mức phóng to ảnh chân dung"
                                  className="h-1.5 w-full cursor-pointer accent-[#FF5500]"
                                />
                              </div>
                            )}

                          {cameraNotice && (
                            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
                              {cameraNotice}
                            </p>
                          )}

                          {photoDataUrl &&
                            !cameraActive &&
                            photoValidationMessage && (
                              <p
                                className={cn(
                                  'rounded-lg border px-3 py-1.5 text-[11px] font-medium',
                                  photoValidationStatus === 'valid'
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                    : photoValidationStatus === 'checking'
                                      ? 'border-white/10 bg-white/[0.04] text-zinc-300'
                                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                                )}
                              >
                                {photoValidationMessage}
                              </p>
                            )}

                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[11px] text-zinc-500">
                              Hội viên chưa có mặt tại quầy?
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                stopWebcam();
                                setActiveStep(3);
                              }}
                              className="text-xs font-semibold text-[#FF5500] hover:underline"
                            >
                              Bỏ qua &amp; chụp khi check-in →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* BƯỚC 3: CHỌN GÓI TẬP & THU NGÂN POS */}
                    {activeStep === 3 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-zinc-300">
                            Chọn hạng gói tập
                          </span>
                          <div className="inline-flex rounded-lg border border-white/10 bg-[#16161B] p-0.5">
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() =>
                                setFlow((prev) =>
                                  updateOnboardingPlanFields(prev, {
                                    attachPlan: true,
                                  }),
                                )
                              }
                              className={cn(
                                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                attachPlan
                                  ? 'bg-[#FF5500] text-white'
                                  : 'text-zinc-400 hover:text-white',
                              )}
                            >
                              Đăng ký gói ngay
                            </button>
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() =>
                                setFlow((prev) =>
                                  updateOnboardingPlanFields(prev, {
                                    attachPlan: false,
                                  }),
                                )
                              }
                              className={cn(
                                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                !attachPlan
                                  ? 'bg-white/15 text-white'
                                  : 'text-zinc-400 hover:text-white',
                              )}
                            >
                              Chỉ tạo hồ sơ
                            </button>
                          </div>
                        </div>

                        {attachPlan ? (
                          <div className="space-y-3">
                            {plansLoading && (
                              <p
                                role="status"
                                className="text-sm text-zinc-400"
                              >
                                Đang tải gói tập…
                              </p>
                            )}
                            {plansError && (
                              <p
                                role="alert"
                                className="text-sm text-amber-300"
                              >
                                {plansError}{' '}
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={onRetryPlans}
                                >
                                  Thử lại
                                </button>
                              </p>
                            )}
                            {/* Lưới hiển thị toàn bộ danh sách gói tập đang mở bán */}
                            <div className="grid max-h-[168px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-3">
                              {availablePlans.map((plan) => {
                                const isSelected =
                                  plan.id === (selectedPlan?.id ?? '');
                                return (
                                  <button
                                    key={plan.id}
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() =>
                                      setFlow((prev) =>
                                        updateOnboardingPlanFields(prev, {
                                          selectedPlanId: plan.id,
                                        }),
                                      )
                                    }
                                    className={cn(
                                      'flex flex-col justify-between rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60',
                                      isSelected
                                        ? 'border-[#FF5500] bg-[#FF5500]/10 shadow-[0_0_16px_rgba(255,85,0,0.12)]'
                                        : 'border-white/10 bg-[#18181C] hover:border-white/25',
                                    )}
                                  >
                                    <div>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-bold text-white">
                                          {plan.name}
                                        </span>
                                        <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-zinc-300 tabular-nums">
                                          {formatDurationClean(
                                            plan.durationDays,
                                          )}
                                        </span>
                                      </div>
                                      <p className="mt-1 font-heading text-base font-bold tracking-wide text-[#FF5500] tabular-nums">
                                        {formatPriceVnd(plan.price)}
                                      </p>
                                    </div>

                                    {plan.entitlements &&
                                      plan.entitlements.length > 0 && (
                                        <p className="mt-2 truncate text-[10px] text-zinc-400 tabular-nums">
                                          {plan.entitlements
                                            .map((e) =>
                                              formatCompactEntitlement(e),
                                            )
                                            .join(' • ')}
                                        </p>
                                      )}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Thanh thời hạn gói */}
                            <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-white/[0.08] bg-[#16161B] p-2.5 sm:grid-cols-12 sm:items-center">
                              <div className="flex items-center gap-1.5 sm:col-span-5">
                                <div className="inline-flex rounded-lg border border-white/10 bg-[#121216] p-0.5">
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() =>
                                      setFlow((prev) =>
                                        updateOnboardingPlanFields(prev, {
                                          activationMode: 'TODAY',
                                        }),
                                      )
                                    }
                                    className={cn(
                                      'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                      activationMode === 'TODAY'
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : 'text-zinc-400 hover:text-white',
                                    )}
                                  >
                                    Hôm nay
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() =>
                                      setFlow((prev) =>
                                        updateOnboardingPlanFields(prev, {
                                          activationMode: 'SCHEDULED',
                                        }),
                                      )
                                    }
                                    className={cn(
                                      'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                      activationMode === 'SCHEDULED'
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'text-zinc-400 hover:text-white',
                                    )}
                                  >
                                    Hẹn ngày
                                  </button>
                                </div>

                                {activationMode === 'SCHEDULED' && (
                                  <input
                                    type="date"
                                    disabled={isSubmitting}
                                    value={scheduledStartDate}
                                    min={new Date().toISOString().slice(0, 10)}
                                    onChange={(e) =>
                                      setFlow((prev) =>
                                        updateOnboardingPlanFields(prev, {
                                          scheduledStartDate: e.target.value,
                                        }),
                                      )
                                    }
                                    aria-label="Ngày bắt đầu gói tập"
                                    className="h-7 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#121216] px-2 text-[11px] text-white tabular-nums focus:border-[#FF5500] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                  />
                                )}
                              </div>

                              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#121216] px-3 py-1.5 text-xs tabular-nums sm:col-span-7">
                                <span className="text-[11px] font-medium text-white">
                                  {formatDateVn(previewStart)}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#FF5500]">
                                  {selectedPlan
                                    ? formatDurationClean(
                                        selectedPlan.durationDays,
                                      )
                                    : ''}
                                  <ArrowRight className="h-3 w-3" />
                                </span>
                                <span className="text-[11px] font-semibold text-emerald-400">
                                  {previewEnd ? formatDateVn(previewEnd) : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Phương thức thanh toán + Trạng thái thu ngân */}
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                              <div className="grid grid-cols-2 gap-1.5 sm:col-span-7">
                                {[
                                  {
                                    id: 'TRANSFER' as const,
                                    label: 'Chuyển khoản',
                                    icon: Landmark,
                                  },
                                  {
                                    id: 'CASH' as const,
                                    label: 'Tiền mặt',
                                    icon: Banknote,
                                  },
                                ].map((m) => {
                                  const Icon = m.icon;
                                  const active = paymentMethod === m.id;
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() =>
                                        setFlow((prev) =>
                                          updateOnboardingPlanFields(prev, {
                                            paymentMethod: m.id,
                                          }),
                                        )
                                      }
                                      className={cn(
                                        'flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60',
                                        active
                                          ? 'border-[#FF5500] bg-[#FF5500]/15 text-white'
                                          : 'border-white/10 bg-[#18181C] text-zinc-400 hover:text-white',
                                      )}
                                    >
                                      <Icon className="h-3.5 w-3.5 text-[#FF5500]" />
                                      <span>{m.label}</span>
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="grid h-9 grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#18181C] p-1 sm:col-span-5">
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    setFlow((prev) =>
                                      updateOnboardingPlanFields(prev, {
                                        paymentStatus: PaymentStatus.PAID,
                                      }),
                                    )
                                  }
                                  className={cn(
                                    'rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    paymentStatus === PaymentStatus.PAID
                                      ? 'bg-[#FF5500] text-white'
                                      : 'text-zinc-400 hover:text-white',
                                  )}
                                >
                                  Đã thu tiền
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    setFlow((prev) =>
                                      updateOnboardingPlanFields(prev, {
                                        paymentStatus: PaymentStatus.PENDING,
                                      }),
                                    )
                                  }
                                  className={cn(
                                    'rounded-lg text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    paymentStatus === PaymentStatus.PENDING
                                      ? 'bg-white/15 text-white'
                                      : 'text-zinc-400 hover:text-white',
                                  )}
                                >
                                  Thu sau
                                </button>
                              </div>
                            </div>

                            <input
                              type="text"
                              disabled={isSubmitting}
                              value={posNote}
                              onChange={(e) =>
                                setFlow((prev) =>
                                  updateOnboardingPlanFields(prev, {
                                    posNote: e.target.value,
                                  }),
                                )
                              }
                              aria-label="Ghi chú thu ngân"
                              placeholder="Ghi chú biên lai (không bắt buộc)..."
                              className="h-9 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-xs text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                        ) : (
                          <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-[#16161B] p-6 text-center">
                            <p className="text-xs font-semibold text-white">
                              {createdMemberCache
                                ? `Hoàn tất hồ sơ ${createdMemberCache.memberCode} chưa gắn gói tập`
                                : 'Chỉ tạo hồ sơ hội viên'}
                            </p>
                            <p className="mt-1 max-w-sm text-xs text-zinc-400">
                              {createdMemberCache
                                ? 'Hồ sơ hội viên đã được tạo. Bạn có thể đóng quy trình với trạng thái chưa có gói và đăng ký gói sau tại quầy thu ngân.'
                                : 'Cấp tài khoản và mã hội viên trước. Lễ tân có thể gắn gói tập và thu tiền sau tại quầy thu ngân.'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Thanh điều hướng dưới cùng */}
                  <div className="flex shrink-0 items-center justify-between border-t border-white/[0.07] pt-3.5">
                    <div>
                      {activeStep > 1 ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            stopWebcam();
                            setActiveStep(activeStep === 3 ? 2 : 1);
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 px-3.5 text-xs font-semibold text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                          Quay lại
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={handleClose}
                          className="inline-flex h-9 items-center rounded-xl border border-white/10 px-3.5 text-xs font-semibold text-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Huỷ bỏ
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {activeStep < 3 ? (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={handleNextStep}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#FF5500] px-4 text-xs font-semibold text-white hover:bg-[#E64D00] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>
                            {activeStep === 1
                              ? 'Tiếp theo: Ảnh thẻ'
                              : 'Tiếp theo: Chọn gói tập'}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={
                            isSubmitting ||
                            (attachPlan &&
                              (plansLoading || Boolean(plansError)))
                          }
                          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#FF5500] px-5 text-xs font-semibold text-white shadow-lg shadow-[#FF5500]/25 hover:bg-[#E64D00] disabled:opacity-50"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          <span className="tabular-nums">
                            {isSubmitting
                              ? 'Đang xử lý...'
                              : createdMemberCache
                                ? attachPlan && selectedPlan
                                  ? `Thử lại cấp gói • ${formatPriceVnd(selectedPlan.price)}`
                                  : 'Hoàn tất hồ sơ đã tạo'
                                : attachPlan && selectedPlan
                                  ? `Hoàn tất đăng ký • ${formatPriceVnd(selectedPlan.price)}`
                                  : 'Tạo hồ sơ hội viên'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              )}
            </div>

            {/* CỘT PHẢI (5 cột): Xem trước Thẻ Hội Viên & Tóm tắt Thu ngân */}
            <div className="flex flex-col justify-between bg-[#09090B] px-6 py-5 lg:col-span-5 lg:h-[536px]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                    Xem trước Member Pass
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold',
                      completedResult
                        ? completedResult.member.idPhotoUrl
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : photoValidationStatus === 'valid'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : photoValidationStatus === 'checking'
                            ? 'border-white/15 bg-white/[0.05] text-zinc-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                    )}
                  >
                    {completedResult
                      ? completedResult.member.idPhotoUrl
                        ? 'Đã lưu ảnh ID'
                        : 'Chưa có ảnh ID'
                      : photoValidationStatus === 'valid'
                        ? 'Ảnh hợp lệ (1 khuôn mặt)'
                        : photoValidationStatus === 'checking'
                          ? 'Đang kiểm tra ảnh...'
                          : photoDataUrl
                            ? 'Ảnh cần kiểm tra lại'
                            : 'Chưa có ảnh ID'}
                  </span>
                </div>

                {/* THẺ HỘI VIÊN AURA GYM */}
                <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-[#18181F] via-[#121216] to-[#09090B] p-5 shadow-xl">
                  <div className="inset-x-0 top-0 h-1 bg-[#FF5500] absolute" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Flame className="h-4 w-4 fill-[#FF5500] text-[#FF5500]" />
                      <span className="font-heading text-sm font-bold tracking-wider uppercase text-white">
                        AURA<span className="text-[#FF5500]">GYM</span>
                      </span>
                    </div>
                    <span className="text-xs font-semibold tracking-wider text-[#FF5500] tabular-nums">
                      {completedResult?.member.memberCode ??
                        createdMemberCache?.memberCode ??
                        'MEMBER PASS'}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-4">
                    <div className="aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-zinc-900">
                      {photoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photoDataUrl}
                          alt="Ảnh chân dung hội viên"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#FF5500]/15 font-heading text-xl font-bold text-[#FF5500]">
                          {getInitials(fullName || 'Hội Viên')}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-heading text-lg font-bold uppercase tracking-wide text-white">
                        {fullName.trim() || 'HỌ VÀ TÊN HỘI VIÊN'}
                      </p>
                      <p className="truncate text-xs text-zinc-400 tabular-nums">
                        {phone.trim()
                          ? formatPhoneDisplay(phone)
                          : email.trim() || 'Số điện thoại / Email'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="rounded bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          {gender === Gender.MALE
                            ? 'Nam'
                            : gender === Gender.FEMALE
                              ? 'Nữ'
                              : 'Khác'}
                        </span>
                        {dob && (
                          <span className="rounded bg-white/[0.07] px-2 py-0.5 text-[10px] text-zinc-300 tabular-nums">
                            {formatDateVn(dob)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-white/[0.08] pt-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Hạng gói tập
                      </p>
                      <p className="font-semibold text-white">
                        {attachPlan && selectedPlan
                          ? `${selectedPlan.name} (${formatDurationClean(selectedPlan.durationDays)})`
                          : 'Chưa gắn gói tập'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Thời hạn thẻ
                      </p>
                      <p className="text-[11px] font-medium text-zinc-300 tabular-nums">
                        {attachPlan && previewEnd
                          ? `${formatDateVn(previewStart)} – ${formatDateVn(previewEnd)}`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tóm tắt thanh toán tại quầy */}
                <div className="rounded-xl border border-white/[0.08] bg-[#141418] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-[#FF5500]" />
                      Kích hoạt
                    </span>
                    <span className="font-medium text-white tabular-nums">
                      {!attachPlan
                        ? 'Chỉ tạo hồ sơ'
                        : activationMode === 'TODAY'
                          ? 'Kích hoạt ngay hôm nay'
                          : `Hẹn ngày (${formatDateVn(scheduledStartDate)})`}
                    </span>
                  </div>

                  {attachPlan && selectedPlan && (
                    <>
                      <div className="flex items-center justify-between text-zinc-400">
                        <span>Thanh toán</span>
                        <span className="font-medium text-white">
                          {paymentMethod === 'TRANSFER'
                            ? 'Chuyển khoản'
                            : 'Tiền mặt'}{' '}
                          •{' '}
                          {paymentStatus === PaymentStatus.PAID
                            ? 'Đã thu tiền'
                            : 'Thu sau'}
                        </span>
                      </div>
                      <div className="border-t border-white/[0.07] pt-2 flex items-center justify-between">
                        <span className="font-semibold text-zinc-200">
                          Tổng thanh toán tại quầy
                        </span>
                        <span className="font-heading text-lg font-bold tracking-wide text-[#FF5500] tabular-nums">
                          {formatPriceVnd(selectedPlan.price)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-500">
                Cổng kiểm soát yêu cầu hội viên có gói tập đang hoạt động, đã
                thanh toán và đã xác thực ảnh chân dung tại quầy lễ tân.
              </p>
            </div>
          </div>
        </div>
      </ModalFrame>
      {showDiscard && (
        <DiscardChangesDialog
          onKeepEditing={() => setShowDiscard(false)}
          onDiscard={finishClose}
          message={
            createdMemberCache
              ? 'Hồ sơ ' +
                createdMemberCache.fullName +
                ' đã được tạo. Đóng bước đăng ký gói đang làm?'
              : undefined
          }
        />
      )}
    </>
  );
}
