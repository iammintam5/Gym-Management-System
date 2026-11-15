import {
  Gender,
  PaymentStatus,
  type CreateMemberRequest,
  type CreateSubscriptionRequest,
  type MemberDetail,
  type MemberFaceConflict,
  type MembershipPlanDetail,
  type SubscriptionDetail,
  type UpdateMemberRequest,
} from '@gym/contracts';

export type PhotoValidationStatus =
  'idle' | 'legacy' | 'checking' | 'valid' | 'invalid';

export interface PhotoValidationOutcome {
  valid: boolean;
  faceCount: number;
}

export interface KeyedPhotoValidationState {
  src: string;
  valid: boolean;
  faceCount: number;
  failed?: boolean;
}

export interface FaceProbeResult {
  faceCount: number;
  descriptor: Float32Array | null;
}

const SUPPORTED_DATA_URI_RE =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

export function isSupportedPhotoDataUri(src: string): boolean {
  return SUPPORTED_DATA_URI_RE.test(src.trim());
}

/**
 * Computes photo validation UI state synchronously from `(currentSrc, settled)`
 * so changing images, adjusting crop/zoom, switching members, or clearing a photo
 * resets stale green indicators immediately without synchronous setState in effects.
 */
export function resolvePhotoValidationStatus(
  currentSrc: string,
  settled: KeyedPhotoValidationState | null,
): PhotoValidationStatus {
  const trimmed = currentSrc.trim();
  if (!trimmed) return 'idle';
  if (!trimmed.startsWith('data:')) return 'legacy';
  if (!isSupportedPhotoDataUri(trimmed)) return 'invalid';
  if (!settled || settled.src !== trimmed) return 'checking';
  return settled.valid ? 'valid' : 'invalid';
}

export function formatPhotoValidationFeedback(
  status: PhotoValidationStatus,
  settled: KeyedPhotoValidationState | null,
): string | null {
  if (status === 'idle' || status === 'legacy') return null;
  if (status === 'checking') {
    return 'Đang kiểm tra khuôn mặt trong khung hình...';
  }
  if (status === 'valid') {
    return '✓ Ảnh chụp rõ một khuôn mặt.';
  }
  if (settled && settled.faceCount > 1) {
    return '⚠ Phát hiện nhiều khuôn mặt trong khung — vui lòng chỉ chụp một hội viên.';
  }
  return '⚠ Khuôn mặt trong khung chưa rõ nét — nên căn giữa hoặc chụp lại chính diện.';
}

function makeAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError');
  }
  const fallback = new Error('Aborted');
  fallback.name = 'AbortError';
  return fallback;
}

function getFallbackErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

/**
 * Deduplicates concurrent in-flight single-face checks for the same image data URI
 * and caches recent settled outcomes so submit reuses preview validation instead of
 * running duplicate expensive inference.
 */
export function createPhotoValidationCache(
  describeFn: (src: string, signal?: AbortSignal) => Promise<FaceProbeResult>,
  maxEntries = 6,
) {
  interface ValidationSubscriber {
    resolve: (value: PhotoValidationOutcome) => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  }

  interface InflightValidationEntry {
    readonly key: string;
    readonly generation: number;
    retired: boolean;
    readonly controller: AbortController;
    readonly subscribers: Set<ValidationSubscriber>;
  }

  let cacheGeneration = 0;
  const settledCache = new Map<string, PhotoValidationOutcome>();
  const inflight = new Map<string, InflightValidationEntry>();

  function remember(key: string, outcome: PhotoValidationOutcome): void {
    if (settledCache.has(key)) {
      settledCache.delete(key);
    } else if (settledCache.size >= maxEntries) {
      const oldestKey = settledCache.keys().next().value;
      if (oldestKey !== undefined) settledCache.delete(oldestKey);
    }
    settledCache.set(key, outcome);
  }

  function isCurrentOwner(entry: InflightValidationEntry): boolean {
    return (
      !entry.retired &&
      entry.generation === cacheGeneration &&
      inflight.get(entry.key) === entry
    );
  }

  return {
    peek(src: string): PhotoValidationOutcome | undefined {
      const key = src.trim();
      const existing = settledCache.get(key);
      if (!existing) return undefined;
      settledCache.delete(key);
      settledCache.set(key, existing);
      return { ...existing };
    },

    validate(
      src: string,
      signal?: AbortSignal,
    ): Promise<PhotoValidationOutcome> {
      if (signal?.aborted) {
        return Promise.reject(makeAbortError(signal));
      }

      const key = src.trim();
      if (!isSupportedPhotoDataUri(key)) {
        return Promise.resolve({ valid: false, faceCount: 0 });
      }

      const cached = this.peek(key);
      if (cached) {
        return Promise.resolve(cached);
      }

      let entry = inflight.get(key);
      if (!entry || entry.retired) {
        const controller = new AbortController();
        const subscribers = new Set<ValidationSubscriber>();
        const createdEntry: InflightValidationEntry = {
          key,
          generation: cacheGeneration,
          retired: false,
          controller,
          subscribers,
        };
        entry = createdEntry;
        inflight.set(key, createdEntry);

        let probePromise: Promise<FaceProbeResult>;
        try {
          probePromise = describeFn(key, controller.signal);
        } catch (syncError: unknown) {
          probePromise = Promise.reject(syncError);
        }

        void probePromise
          .then((probe) => {
            if (!isCurrentOwner(createdEntry) || controller.signal.aborted) {
              return;
            }
            createdEntry.retired = true;
            inflight.delete(key);

            const outcome: PhotoValidationOutcome = {
              valid: probe.faceCount === 1 && Boolean(probe.descriptor),
              faceCount: probe.faceCount,
            };
            remember(key, outcome);

            const pending = Array.from(subscribers);
            subscribers.clear();
            for (const sub of pending) {
              sub.cleanup();
              sub.resolve({ ...outcome });
            }
          })
          .catch((error: unknown) => {
            if (!isCurrentOwner(createdEntry)) {
              return;
            }
            createdEntry.retired = true;
            inflight.delete(key);

            const pending = Array.from(subscribers);
            subscribers.clear();
            for (const sub of pending) {
              sub.cleanup();
              sub.reject(error);
            }
          });
      }

      const activeEntry = entry;
      return new Promise<PhotoValidationOutcome>((resolve, reject) => {
        let onAbort: (() => void) | null = null;
        const cleanup = () => {
          if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
            onAbort = null;
          }
        };

        const sub: ValidationSubscriber = { resolve, reject, cleanup };
        activeEntry.subscribers.add(sub);

        if (signal) {
          onAbort = () => {
            onAbort = null;
            if (!activeEntry.subscribers.delete(sub)) return;
            reject(makeAbortError(signal));
            if (activeEntry.subscribers.size === 0 && !activeEntry.retired) {
              activeEntry.retired = true;
              if (inflight.get(key) === activeEntry) {
                inflight.delete(key);
              }
              activeEntry.controller.abort();
            }
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    },

    clear(): void {
      cacheGeneration += 1;
      settledCache.clear();
      const activeEntries = Array.from(inflight.values());
      inflight.clear();
      for (const entry of activeEntries) {
        entry.retired = true;
        const pending = Array.from(entry.subscribers);
        entry.subscribers.clear();
        entry.controller.abort();
        const abortError = makeAbortError(entry.controller.signal);
        for (const sub of pending) {
          sub.cleanup();
          sub.reject(abortError);
        }
      }
    },
  };
}

export interface VideoFrameSource {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  ended?: boolean;
}

export interface Canvas2DContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number,
  ): void;
}

export interface CanvasElementLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): Canvas2DContextLike | null;
  toDataURL(type?: string, quality?: number): string;
}

function defaultCreateCanvas(): CanvasElementLike {
  return document.createElement('canvas') as unknown as CanvasElementLike;
}

export function isVideoFrameReady(
  video: VideoFrameSource | null | undefined,
): video is VideoFrameSource {
  return Boolean(
    video &&
    !video.ended &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0,
  );
}

/**
 * Captures the live video frame in its true unmirrored orientation for cropping/zooming,
 * even when the `<video>` preview uses CSS `-scale-x-100`. Returns `null` when the
 * video stream has not produced a real frame yet (never fabricates 720x960 blank frames).
 */
export function captureUnmirroredVideoFrame(
  video: VideoFrameSource | null | undefined,
  createCanvas: () => CanvasElementLike = defaultCreateCanvas,
): string | null {
  if (!isVideoFrameReady(video)) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const canvas = createCanvas();
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, vw, vh);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Center-crops a live video frame into a `360x480` (3:4) JPEG data URI in true
 * unmirrored orientation. Returns `null` if the video has no loaded frame.
 */
export function captureUnmirroredPortrait3x4(
  video: VideoFrameSource | null | undefined,
  createCanvas: () => CanvasElementLike = defaultCreateCanvas,
): string | null {
  if (!isVideoFrameReady(video)) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const canvas = createCanvas();
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

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function renderCroppedPortraitDataUrl(
  img: { width: number; height: number },
  zoom: number,
  offsetX: number,
  offsetY: number,
  createCanvas: () => CanvasElementLike = defaultCreateCanvas,
): string {
  if (img.width <= 0 || img.height <= 0) return '';
  const canvas = createCanvas();
  canvas.width = 360;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const targetRatio = 3 / 4;
  const srcRatio = img.width / img.height;
  let baseSw = img.width;
  let baseSh = img.height;

  if (srcRatio > targetRatio) {
    baseSw = img.height * targetRatio;
  } else {
    baseSh = img.width / targetRatio;
  }

  const safeZoom = Math.max(1, zoom);
  const sw = baseSw / safeZoom;
  const sh = baseSh / safeZoom;

  const maxPanX = Math.max(0, (img.width - sw) / 2);
  const maxPanY = Math.max(0, (img.height - sh) / 2);

  const cx = img.width / 2 - offsetX * maxPanX;
  const cy = img.height / 2 - offsetY * maxPanY;

  const sx = Math.min(Math.max(0, cx - sw / 2), img.width - sw);
  const sy = Math.min(Math.max(0, cy - sh / 2), img.height - sh);

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 360, 480);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export type OnboardingStep = 1 | 2 | 3;

export function getFaceConflicts(error: unknown): MemberFaceConflict[] {
  const details = (error as { details?: { conflicts?: unknown } } | null)
    ?.details;
  if (!Array.isArray(details?.conflicts)) return [];
  return details.conflicts.filter(
    (item): item is MemberFaceConflict =>
      typeof item?.memberId === 'string' &&
      typeof item?.memberCode === 'string' &&
      typeof item?.fullName === 'string',
  );
}

export interface OnboardingFieldErrors {
  conflicts?: MemberFaceConflict[];
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  general?: string;
}

export interface OnboardingFormFields {
  fullName: string;
  email: string;
  phone: string;
  gender: Gender;
  dob: string;
  password: string;
  photoDataUrl: string;
  attachPlan: boolean;
  selectedPlanId: string;
  activationMode: 'TODAY' | 'SCHEDULED';
  scheduledStartDate: string;
  paymentMethod: 'CASH' | 'TRANSFER';
  paymentStatus: PaymentStatus;
  posNote: string;
}

export interface OnboardingCompletedOutcome {
  member: MemberDetail;
  subscription: SubscriptionDetail | null;
}

export interface OnboardingFlowState {
  activeStep: OnboardingStep;
  fields: OnboardingFormFields;
  fieldErrors: OnboardingFieldErrors;
  cameraNotice: string | null;
  isSubmitting: boolean;
  createdMemberCache: MemberDetail | null;
  completedResult: OnboardingCompletedOutcome | null;
  sessionId: number;
  subscriptionRequest?: { fingerprint: string; key: string } | null;
}

export function defaultTomorrowIsoDate(nowMs = Date.now()): string {
  return new Date(nowMs + 7 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function createInitialOnboardingState(
  sessionId = 1,
  scheduledStartDate = defaultTomorrowIsoDate(),
): OnboardingFlowState {
  return {
    activeStep: 1,
    fields: {
      fullName: '',
      email: '',
      phone: '',
      gender: Gender.MALE,
      dob: '',
      password: 'Member@123456',
      photoDataUrl: '',
      attachPlan: true,
      selectedPlanId: '',
      activationMode: 'TODAY',
      scheduledStartDate,
      paymentMethod: 'TRANSFER',
      paymentStatus: PaymentStatus.PAID,
      posNote: '',
    },
    fieldErrors: {},
    cameraNotice: null,
    isSubmitting: false,
    createdMemberCache: null,
    completedResult: null,
    sessionId,
  };
}

export function canCloseOrResetOnboarding(
  state: Pick<OnboardingFlowState, 'isSubmitting'>,
): boolean {
  return !state.isSubmitting;
}

/**
 * Identity and ID photo fields are locked while a request is in flight OR after
 * `POST /members` already persisted the member and Step 3 (`POST /subscriptions`)
 * is being retried, preventing silent loss of unpersisted edits.
 */
export function isOnboardingIdentityLocked(
  state: Pick<OnboardingFlowState, 'isSubmitting' | 'createdMemberCache'>,
): boolean {
  return state.isSubmitting || Boolean(state.createdMemberCache);
}

export function resetOnboardingState(
  prev: OnboardingFlowState,
  scheduledStartDate = defaultTomorrowIsoDate(),
): OnboardingFlowState {
  if (!canCloseOrResetOnboarding(prev)) {
    return prev;
  }
  return createInitialOnboardingState(prev.sessionId + 1, scheduledStartDate);
}

export type OnboardingIdentityPatch = Partial<
  Pick<
    OnboardingFormFields,
    | 'fullName'
    | 'email'
    | 'phone'
    | 'gender'
    | 'dob'
    | 'password'
    | 'photoDataUrl'
  >
>;

export type OnboardingPlanPatch = Partial<
  Pick<
    OnboardingFormFields,
    | 'attachPlan'
    | 'selectedPlanId'
    | 'activationMode'
    | 'scheduledStartDate'
    | 'paymentMethod'
    | 'paymentStatus'
    | 'posNote'
  >
>;

export function updateOnboardingIdentityFields(
  state: OnboardingFlowState,
  patch: OnboardingIdentityPatch,
): OnboardingFlowState {
  if (isOnboardingIdentityLocked(state)) {
    return state;
  }
  const nextErrors = { ...state.fieldErrors };
  if ('fullName' in patch) delete nextErrors.fullName;
  if ('email' in patch) delete nextErrors.email;
  if ('phone' in patch) delete nextErrors.phone;
  if ('password' in patch) delete nextErrors.password;
  if ('photoDataUrl' in patch) {
    delete nextErrors.conflicts;
    delete nextErrors.general;
  }
  return {
    ...state,
    fields: {
      ...state.fields,
      ...patch,
    },
    fieldErrors: nextErrors,
    cameraNotice: 'photoDataUrl' in patch ? null : state.cameraNotice,
  };
}

export function updateOnboardingPlanFields(
  state: OnboardingFlowState,
  patch: OnboardingPlanPatch,
): OnboardingFlowState {
  if (state.isSubmitting) {
    return state;
  }
  return {
    ...state,
    fields: {
      ...state.fields,
      ...patch,
    },
  };
}

export function validateOnboardingStep1(
  fields: Pick<
    OnboardingFormFields,
    'fullName' | 'email' | 'phone' | 'password'
  >,
): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  const trimmedName = fields.fullName.trim();
  const trimmedEmail = fields.email.trim();
  const trimmedPhone = fields.phone.trim();

  if (trimmedName.length < 2) {
    errors.fullName = 'Vui lòng nhập họ và tên hội viên.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = 'Địa chỉ email không hợp lệ.';
  }
  if (
    trimmedPhone &&
    !/^(\+84|0)[35789][0-9]{8}$/.test(trimmedPhone.replace(/[\s.-]/g, ''))
  ) {
    errors.phone = 'Số điện thoại gồm 10 chữ số (VD: 0903 123 456).';
  }
  if (fields.password.length < 8) {
    errors.password = 'Mật khẩu cần tối thiểu 8 ký tự.';
  }
  return errors;
}

export type OnboardingSubmissionResult =
  | { status: 'ignored_in_flight' }
  | { status: 'validation_failed'; fieldErrors: OnboardingFieldErrors }
  | { status: 'photo_invalid'; message: string; faceCount: number }
  | {
      status: 'completed';
      result: OnboardingCompletedOutcome;
      summaryMessage: string;
    }
  | {
      status: 'subscription_failed';
      member: MemberDetail;
      errorMessage: string;
    }
  | { status: 'member_failed'; errorMessage: string }
  | { status: 'abandoned_session' };

export async function runOnboardingSubmission(params: {
  snapshot: OnboardingFlowState;
  getCurrentSessionId?: () => number;
  setState: (
    updater: (prev: OnboardingFlowState) => OnboardingFlowState,
  ) => void;
  selectedPlan: Pick<MembershipPlanDetail, 'id' | 'name'> | null;
  validatePhoto: (src: string) => Promise<PhotoValidationOutcome>;
  createMember: (payload: CreateMemberRequest) => Promise<MemberDetail>;
  createSubscription: (
    payload: CreateSubscriptionRequest,
  ) => Promise<SubscriptionDetail>;
  extractErrorMessage?: (error: unknown) => string;
}): Promise<OnboardingSubmissionResult> {
  const { snapshot } = params;
  if (snapshot.isSubmitting) {
    return { status: 'ignored_in_flight' };
  }

  const ownedSessionId = snapshot.sessionId;
  const isSessionActive = (): boolean =>
    params.getCurrentSessionId
      ? params.getCurrentSessionId() === ownedSessionId
      : true;

  const commit = (
    updater: (prev: OnboardingFlowState) => OnboardingFlowState,
  ): boolean => {
    if (!isSessionActive()) return false;
    params.setState((prev) =>
      prev.sessionId === ownedSessionId ? updater(prev) : prev,
    );
    return true;
  };

  if (!snapshot.createdMemberCache) {
    const step1Errors = validateOnboardingStep1(snapshot.fields);
    if (Object.keys(step1Errors).length > 0) {
      commit((prev) => ({
        ...prev,
        activeStep: 1,
        fieldErrors: step1Errors,
      }));
      return { status: 'validation_failed', fieldErrors: step1Errors };
    }
  }

  commit((prev) => ({
    ...prev,
    isSubmitting: true,
    fieldErrors: {},
    cameraNotice: null,
  }));

  let activeMember: MemberDetail | null = snapshot.createdMemberCache;

  try {
    if (!activeMember) {
      const trimmedPhoto = snapshot.fields.photoDataUrl.trim();
      if (trimmedPhoto) {
        const photoCheck = await params.validatePhoto(trimmedPhoto);
        if (!photoCheck.valid) {
          const message =
            photoCheck.faceCount > 1
              ? 'Ảnh có nhiều hơn một khuôn mặt. Vui lòng chỉ chụp một hội viên.'
              : 'Ảnh cần có đúng một khuôn mặt rõ để dùng nhận diện.';
          const applied = commit((prev) => ({
            ...prev,
            isSubmitting: false,
            activeStep: 2,
            cameraNotice: message,
          }));
          return applied
            ? {
                status: 'photo_invalid',
                message,
                faceCount: photoCheck.faceCount,
              }
            : { status: 'abandoned_session' };
        }
      }

      const cleanPhone = snapshot.fields.phone.trim().replace(/[\s.-]/g, '');
      const memberPayload: CreateMemberRequest = {
        fullName: snapshot.fields.fullName.trim(),
        email: snapshot.fields.email.trim().toLowerCase(),
        password: snapshot.fields.password || 'Member@123456',
        phone: cleanPhone || undefined,
        gender: snapshot.fields.gender,
        dateOfBirth: snapshot.fields.dob
          ? new Date(snapshot.fields.dob).toISOString()
          : undefined,
        idPhotoUrl: trimmedPhoto || undefined,
      };

      activeMember = await params.createMember(memberPayload);
      if (!isSessionActive()) {
        return { status: 'abandoned_session' };
      }

      if (snapshot.fields.attachPlan && params.selectedPlan) {
        const createdSnapshot = activeMember;
        commit((prev) => ({
          ...prev,
          createdMemberCache: createdSnapshot,
        }));
      }
    }

    let createdSub: SubscriptionDetail | null = null;
    if (snapshot.fields.attachPlan && params.selectedPlan) {
      const subPayload: CreateSubscriptionRequest = {
        memberId: activeMember.id,
        planId: params.selectedPlan.id,
        startDate:
          snapshot.fields.activationMode === 'SCHEDULED' &&
          snapshot.fields.scheduledStartDate
            ? `${snapshot.fields.scheduledStartDate}T00:00:00+07:00`
            : undefined,
        paymentMethod: snapshot.fields.paymentMethod,
        paymentStatus: snapshot.fields.paymentStatus,
        note:
          snapshot.fields.posNote.trim() ||
          'Đăng ký hội viên mới và thu tiền tại quầy lễ tân',
      };
      const fingerprint = JSON.stringify(subPayload);
      const key = snapshot.subscriptionRequest?.key ?? crypto.randomUUID();
      commit((prev) => ({
        ...prev,
        subscriptionRequest: { fingerprint, key },
      }));
      createdSub = await params.createSubscription({
        ...subPayload,
        idempotencyKey: key,
      });
    }

    const result: OnboardingCompletedOutcome = {
      member: activeMember,
      subscription: createdSub,
    };
    const summaryMessage = createdSub
      ? `Đã cấp thẻ cho ${activeMember.fullName} (${activeMember.memberCode}) kèm gói ${params.selectedPlan?.name ?? ''}.`
      : `Đã tạo hồ sơ hội viên ${activeMember.fullName} (${activeMember.memberCode}).`;

    const applied = commit((prev) => ({
      ...prev,
      isSubmitting: false,
      createdMemberCache: null,
      completedResult: result,
      fieldErrors: {},
      cameraNotice: null,
    }));

    return applied
      ? { status: 'completed', result, summaryMessage }
      : { status: 'abandoned_session' };
  } catch (error: unknown) {
    const message = params.extractErrorMessage
      ? params.extractErrorMessage(error)
      : getFallbackErrorMessage(error, 'Không thể hoàn tất đăng ký hội viên.');

    if (activeMember) {
      const persistedMember = activeMember;
      const applied = commit((prev) => ({
        ...prev,
        isSubmitting: false,
        activeStep: 3,
        createdMemberCache: persistedMember,
        fieldErrors: { general: message },
      }));
      return applied
        ? {
            status: 'subscription_failed',
            member: persistedMember,
            errorMessage: message,
          }
        : { status: 'abandoned_session' };
    }

    const lower = message.toLowerCase();
    const applied = commit((prev) => {
      if (lower.includes('email')) {
        return {
          ...prev,
          isSubmitting: false,
          activeStep: 1,
          fieldErrors: { email: message, general: message },
        };
      }
      if (lower.includes('phone') || lower.includes('điện thoại')) {
        return {
          ...prev,
          isSubmitting: false,
          activeStep: 1,
          fieldErrors: { phone: message, general: message },
        };
      }
      if (
        getFaceConflicts(error).length ||
        lower.includes('ảnh') ||
        lower.includes('photo')
      ) {
        return {
          ...prev,
          isSubmitting: false,
          activeStep: 2,
          fieldErrors: { general: message, conflicts: getFaceConflicts(error) },
        };
      }
      return {
        ...prev,
        isSubmitting: false,
        fieldErrors: { general: message },
      };
    });

    return applied
      ? { status: 'member_failed', errorMessage: message }
      : { status: 'abandoned_session' };
  }
}

export interface EditableStaffMemberTarget {
  memberId: string;
  code: string;
  name: string;
  rawPhone: string;
  avatarUrl: string | null;
}

export interface StaffMemberEditDraft {
  target: EditableStaffMemberTarget;
  fullName: string;
  phone: string;
  photoInput: string;
  submitError: string | null;
  conflicts?: MemberFaceConflict[];
  isSubmitting: boolean;
}

export function createStaffEditDraft(
  target: EditableStaffMemberTarget,
): StaffMemberEditDraft {
  return {
    target,
    fullName: target.name,
    phone: target.rawPhone,
    photoInput: target.avatarUrl ?? '',
    submitError: null,
    isSubmitting: false,
  };
}

export function canCloseStaffEdit(draft: StaffMemberEditDraft | null): boolean {
  return !draft?.isSubmitting;
}

export function hasStaffMemberPhotoChanged(
  draft: Pick<StaffMemberEditDraft, 'target' | 'photoInput'>,
): boolean {
  return draft.photoInput.trim() !== (draft.target.avatarUrl ?? '').trim();
}

export type StaffMemberEditSaveResult =
  | { status: 'ignored' }
  | { status: 'validation_failed'; errorMessage: string }
  | { status: 'save_failed'; errorMessage: string }
  | { status: 'saved'; bannerMessage: string };

export async function runStaffMemberEditSave(params: {
  draft: StaffMemberEditDraft | null;
  setDraft: (
    updater: (prev: StaffMemberEditDraft | null) => StaffMemberEditDraft | null,
  ) => void;
  validatePhoto: (src: string) => Promise<PhotoValidationOutcome>;
  updateMember: (
    memberId: string,
    payload: UpdateMemberRequest,
  ) => Promise<unknown>;
  extractErrorMessage?: (error: unknown) => string;
}): Promise<StaffMemberEditSaveResult> {
  const current = params.draft;
  if (!current || current.isSubmitting) {
    return { status: 'ignored' };
  }

  const targetMemberId = current.target.memberId;
  const trimmedName = current.fullName.trim();
  if (trimmedName.length < 2) {
    const errorMessage =
      'Vui lòng nhập họ và tên hội viên (tối thiểu 2 ký tự).';
    params.setDraft((prev) =>
      prev && prev.target.memberId === targetMemberId
        ? { ...prev, isSubmitting: false, submitError: errorMessage }
        : prev,
    );
    return { status: 'validation_failed', errorMessage };
  }

  params.setDraft((prev) =>
    prev && prev.target.memberId === targetMemberId
      ? { ...prev, isSubmitting: true, submitError: null, conflicts: [] }
      : prev,
  );

  try {
    const photoChanged = hasStaffMemberPhotoChanged(current);
    const trimmedPhoto = current.photoInput.trim();

    if (photoChanged && trimmedPhoto) {
      if (!isSupportedPhotoDataUri(trimmedPhoto)) {
        const errorMessage = 'Vui lòng chụp ảnh trực tiếp qua Webcam.';
        params.setDraft((prev) =>
          prev && prev.target.memberId === targetMemberId
            ? { ...prev, isSubmitting: false, submitError: errorMessage }
            : prev,
        );
        return { status: 'validation_failed', errorMessage };
      }

      const check = await params.validatePhoto(trimmedPhoto);
      if (!check.valid) {
        const errorMessage =
          check.faceCount > 1
            ? 'Ảnh có nhiều hơn một khuôn mặt. Vui lòng chụp lại chỉ một hội viên.'
            : 'Ảnh cần có đúng một khuôn mặt rõ để dùng nhận diện.';
        params.setDraft((prev) =>
          prev && prev.target.memberId === targetMemberId
            ? { ...prev, isSubmitting: false, submitError: errorMessage }
            : prev,
        );
        return { status: 'validation_failed', errorMessage };
      }
    }

    const trimmedPhone = current.phone.trim();
    const payload: UpdateMemberRequest = {
      fullName: trimmedName,
      phone: trimmedPhone || (current.target.rawPhone ? '' : undefined),
      idPhotoUrl: photoChanged ? trimmedPhoto || null : undefined,
    };

    await params.updateMember(targetMemberId, payload);

    const bannerMessage = `Đã cập nhật hồ sơ cho hội viên ${trimmedName} (${current.target.code}).`;
    params.setDraft((prev) =>
      prev && prev.target.memberId === targetMemberId ? null : prev,
    );
    return { status: 'saved', bannerMessage };
  } catch (error: unknown) {
    const errorMessage = params.extractErrorMessage
      ? params.extractErrorMessage(error)
      : getFallbackErrorMessage(error, 'Không thể cập nhật hồ sơ hội viên.');

    params.setDraft((prev) =>
      prev && prev.target.memberId === targetMemberId
        ? {
            ...prev,
            isSubmitting: false,
            submitError: errorMessage,
            conflicts: getFaceConflicts(error),
          }
        : prev,
    );
    return { status: 'save_failed', errorMessage };
  }
}
