'use client';

import { MemberProfileDrawer } from '@/features/members/member-profile-drawer';

import {
  stableStaffRequestKey,
  type StaffRequestKey,
} from '@/lib/staff-request-key';

import { FaceConflicts } from '@/features/members/face-conflicts';

import { formatVnd, formatDurationVi } from '@/lib/formatters';

import { DataState } from '@/components/shared/data-state';

import { StaffFormModal } from '@/components/ui/staff-form-modal';
import { DiscardChangesDialog } from '@/components/ui/discard-changes-dialog';
import { ModalFrame } from '@/components/ui/modal-frame';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  ChevronDown,
  Camera,
  UserRound,
  Play,
  RefreshCw,
  Ban,
  SquarePen,
  CreditCard,
  Sliders,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  PaymentStatus,
  SubscriptionStatus,
  UserRole,
  type MemberDetail,
  type MembershipPlanDetail,
  type MemberDirectorySummaryResponse,
  type MemberDirectorySubscriptionSummary,
  type PaginatedMembershipPlansResponse,
  type SubscriptionDetail,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { apiClient, ApiClientError } from '@/services/api-client';
import { MemberOnboardingModal } from '@/features/members/member-onboarding-modal';
import {
  canCloseStaffEdit,
  captureUnmirroredPortrait3x4,
  createStaffEditDraft,
  formatPhotoValidationFeedback,
  hasStaffMemberPhotoChanged,
  isSupportedPhotoDataUri,
  isVideoFrameReady,
  resolvePhotoValidationStatus,
  runStaffMemberEditSave,
  type KeyedPhotoValidationState,
  type StaffMemberEditDraft,
} from '@/features/members/member-photo-flow';
import { sharedMemberPhotoValidator } from '@/features/members/photo-validation-client';

import { TablePagination } from '@/components/shared/table-pagination';

interface StaffMemberRecord {
  memberId: string;
  subscriptionId: string | null;
  planId: string | null;
  subscriptionEndDate: string | null;
  code: string;
  name: string;
  phone: string;
  rawPhone: string;
  plan: string;
  validWindow: string;
  hasQueuedRenewal: boolean;
  classQuotaShort: string;
  rawQuotas: ReadonlyArray<SubscriptionQuotaDetail>;
  status: 'Active' | 'Upcoming' | 'Frozen' | 'Expired' | 'None';
  avatarUrl: string | null;
}

const PAGE_SIZE = 10;

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

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatPhoneVi(phone?: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

function mapSubStatusToUi(
  status?: SubscriptionStatus,
): StaffMemberRecord['status'] {
  if (!status) return 'None';
  if (status === SubscriptionStatus.UPCOMING) return 'Upcoming';
  if (status === SubscriptionStatus.SUSPENDED) return 'Frozen';
  if (
    status === SubscriptionStatus.EXPIRED ||
    status === SubscriptionStatus.CANCELLED
  ) {
    return 'Expired';
  }
  return 'Active';
}

function formatServiceLabelVi(code: string, fallback?: string): string {
  if (code === 'CLASS') return 'Group Class';
  if (code === 'PT') return 'PT 1-1';
  if (code === 'GYM_ACCESS') return 'Check-in Full Gym';
  return fallback || code;
}

export default function StaffMembersDirectoryPage() {
  const { user } = useAuthStore();
  const isAdmin = Boolean(user?.roles?.includes(UserRole.ADMIN));

  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const renewalRequestKey = useRef<StaffRequestKey | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersReady, setFiltersReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search =
        new URLSearchParams(window.location.search).get('search') ?? '';
      setSearchQuery(search);
      setDebouncedSearch(search);
      setFiltersReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const directoryLoadSeq = useRef(0);

  const [membersList, setMembersList] = useState<
    ReadonlyArray<StaffMemberRecord>
  >([]);
  const [availablePlans, setAvailablePlans] = useState<MembershipPlanDetail[]>(
    [],
  );
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Register Member Modal
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Unified Edit Profile & Webcam ID Photo Modal (`PATCH /members/:id`)
  const [editDraft, setEditDraft] = useState<StaffMemberEditDraft | null>(null);
  const [editPhotoValidation, setEditPhotoValidation] =
    useState<KeyedPhotoValidationState | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFrameReady, setCameraFrameReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Renew / Register Plan Modal
  const [renewTarget, setRenewTarget] = useState<StaffMemberRecord | null>(
    null,
  );
  const [renewPlanId, setRenewPlanId] = useState('');
  const [renewMethod, setRenewMethod] = useState<'CASH' | 'TRANSFER'>(
    'TRANSFER',
  );
  const [renewNote, setRenewNote] = useState(
    'Đăng ký gia hạn nối tiếp tại quầy lễ tân',
  );

  // Cancel Modal
  const [cancelTarget, setCancelTarget] = useState<StaffMemberRecord | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState(
    'Hội viên yêu cầu huỷ gói tập trực tiếp tại quầy lễ tân',
  );

  // Admin quota adjustment. Session history is displayed inside the member profile.
  const [quotaTarget, setQuotaTarget] = useState<StaffMemberRecord | null>(
    null,
  );
  const [adjustQuotaId, setAdjustQuotaId] = useState('');
  const [adjustDeltaInput, setAdjustDeltaInput] = useState('+2');
  const [adjustReasonInput, setAdjustReasonInput] = useState(
    'Bù buổi tập cho hội viên do bảo trì phòng chức năng',
  );
  const [profileMember, setProfileMember] = useState<StaffMemberRecord | null>(
    null,
  );
  const returnProfile = useRef<StaffMemberRecord | null>(null);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const renewBaseline = useRef<{
    target: StaffMemberRecord;
    plan: string;
    method: string;
    note: string;
  } | null>(null);
  const quotaBaseline = useRef<{
    target: StaffMemberRecord;
    quota: string;
    delta: string;
    reason: string;
  } | null>(null);
  const cancelBaseline = useRef<{
    target: StaffMemberRecord;
    reason: string;
  } | null>(null);
  const [cancelContext, setCancelContext] = useState<SubscriptionDetail | null>(
    null,
  );
  const [cancelNextCount, setCancelNextCount] = useState(0);
  const [cancelContextError, setCancelContextError] = useState('');
  useEffect(() => {
    if (!renewTarget) {
      renewBaseline.current = null;
      return;
    }
    if (renewBaseline.current?.target !== renewTarget)
      renewBaseline.current = {
        target: renewTarget,
        plan: renewPlanId,
        method: renewMethod,
        note: renewNote,
      };
  }, [renewTarget, renewPlanId, renewMethod, renewNote]);
  useEffect(() => {
    if (!cancelTarget) {
      cancelBaseline.current = null;
      return;
    }
    if (cancelBaseline.current?.target !== cancelTarget)
      cancelBaseline.current = { target: cancelTarget, reason: cancelReason };
  }, [cancelTarget, cancelReason]);
  useEffect(() => {
    if (!cancelTarget?.subscriptionId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setCancelContext(null);
      setCancelNextCount(0);
      setCancelContextError('');
      void apiClient
        .get<SubscriptionDetail[]>(
          '/members/' + cancelTarget.memberId + '/subscriptions',
        )
        .then((history) => {
          if (!active) return;
          setCancelContext(
            history.find((sub) => sub.id === cancelTarget.subscriptionId) ??
              null,
          );
          setCancelNextCount(
            history.filter(
              (sub) =>
                sub.id !== cancelTarget.subscriptionId &&
                sub.effectiveStatus === SubscriptionStatus.UPCOMING,
            ).length,
          );
        })
        .catch(() => {
          if (active)
            setCancelContextError('Chưa tải được thông tin thanh toán.');
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cancelTarget]);
  const restoreProfile = () => {
    if (returnProfile.current) {
      setProfileMember(returnProfile.current);
      returnProfile.current = null;
    }
  };
  const requestClose = (dirty: boolean, busy: boolean, action: () => void) => {
    if (busy) return;
    if (dirty) setDiscardAction(() => action);
    else action();
  };
  useEffect(() => {
    if (!quotaTarget) {
      quotaBaseline.current = null;
      return;
    }
    if (quotaBaseline.current?.target !== quotaTarget)
      quotaBaseline.current = {
        target: quotaTarget,
        quota: adjustQuotaId,
        delta: adjustDeltaInput,
        reason: adjustReasonInput,
      };
  }, [quotaTarget, adjustQuotaId, adjustDeltaInput, adjustReasonInput]);
  const closeQuotaAdjustmentModal = () => {
    const initial = quotaBaseline.current;
    const dirty =
      isAdmin &&
      Boolean(
        initial &&
        (initial.quota !== adjustQuotaId ||
          initial.delta !== adjustDeltaInput ||
          initial.reason !== adjustReasonInput),
      );
    requestClose(dirty, isSubmitting, () => {
      setQuotaTarget(null);
      restoreProfile();
    });
  };
  const closeRenewModal = () => {
    const initial = renewBaseline.current;
    requestClose(
      Boolean(
        initial &&
        (initial.plan !== renewPlanId ||
          initial.method !== renewMethod ||
          initial.note !== renewNote),
      ),
      isSubmitting,
      () => {
        setRenewTarget(null);
        restoreProfile();
      },
    );
  };
  const closeCancelModal = () =>
    requestClose(
      Boolean(
        cancelBaseline.current &&
        cancelBaseline.current.reason !== cancelReason,
      ),
      isSubmitting,
      () => {
        setCancelTarget(null);
        restoreProfile();
      },
    );
  const hasLoadedRef = useRef(false);
  const profileAction = useRef<{ memberId: string; action: string } | null>(
    null,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const search = query.get('search');
      if (search) setSearchQuery(search);
      const memberId = query.get('memberId');
      const action = query.get('action');
      if (memberId && (action === 'edit' || action === 'renew'))
        profileAction.current = { memberId, action };
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const intent = profileAction.current;
    if (!intent) return;
    const target = membersList.find(
      (item) => item.memberId === intent.memberId,
    );
    if (!target) return;
    profileAction.current = null;
    setFeedbackBanner(null);
    if (intent.action === 'edit') {
      setEditPhotoValidation(null);
      setEditDraft(createStaffEditDraft(target));
    } else {
      setRenewPlanId('');
      setRenewNote('Đăng ký gia hạn nối tiếp tại quầy lễ tân');
      setRenewTarget(target);
    }
  }, [membersList]);

  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);

  useEffect(() => {
    if (!(isRegisterOpen || Boolean(renewTarget))) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      setCatalogError('');
      void apiClient
        .get<PaginatedMembershipPlansResponse>('/membership-plans?limit=50', {
          signal: controller.signal,
          skipCache: true,
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          const activePlans = result.data.filter((plan) => plan.isActive);
          setAvailablePlans(activePlans);
          setRenewPlanId((previous) =>
            activePlans.some((plan) => plan.id === previous)
              ? previous
              : renewTarget?.subscriptionId
                ? ''
                : (activePlans[0]?.id ?? ''),
          );
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setCatalogError('Không thể tải gói tập. Vui lòng thử lại.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setCatalogLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isRegisterOpen, renewTarget, catalogRetry]);

  useEffect(() => {
    if (!filtersReady || searchQuery === debouncedSearch) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, debouncedSearch, filtersReady]);
  const loadMembersDirectory = useCallback(
    async (signal?: AbortSignal) => {
      const loadSeq = ++directoryLoadSeq.current;
      if (!hasLoadedRef.current) {
        setLoading(true);
      }
      setLoadError('');
      try {
        if (!hasLoadedRef.current) {
          setIsLoading(true);
        }

        const result = await apiClient.get<MemberDirectorySummaryResponse>(
          `/members/directory?summary=true&limit=${PAGE_SIZE}&page=${currentPage}&search=${encodeURIComponent(debouncedSearch)}&directoryStatus=${encodeURIComponent(statusFilter)}`,
          { signal },
        );
        if (signal?.aborted || loadSeq !== directoryLoadSeq.current) return;
        const rawMembers: MemberDetail[] = result.data;
        const rawSubs = result.subscriptions;
        setDirectoryTotal(result.meta.total);
        setCurrentPage((previous) =>
          Math.min(previous, Math.max(1, result.meta.totalPages)),
        );
        const primarySubByMember = new Map<
          string,
          MemberDirectorySubscriptionSummary
        >();
        const hasUpcomingByMember = new Set<string>();

        for (const sub of rawSubs) {
          if (sub.effectiveStatus === SubscriptionStatus.UPCOMING) {
            hasUpcomingByMember.add(sub.memberId);
          }
          const existing = primarySubByMember.get(sub.memberId);
          if (
            !existing ||
            existing.effectiveStatus === SubscriptionStatus.EXPIRED ||
            sub.effectiveStatus === SubscriptionStatus.ACTIVE
          ) {
            primarySubByMember.set(sub.memberId, sub);
          }
        }

        setMembersList(
          rawMembers.map((mem) => {
            const sub = primarySubByMember.get(mem.id);
            const classQ = sub?.quotas.find((q) => q.service === 'CLASS');

            const classShort = classQ
              ? classQ.allocated === null
                ? 'Class: KGH'
                : `Class: ${Math.max(0, classQ.allocated - classQ.used - classQ.reserved)}/${classQ.allocated}`
              : 'Class: 0/0';

            const uiStatus = sub
              ? mapSubStatusToUi(sub.effectiveStatus)
              : 'None';
            const hasQueuedRenewal =
              uiStatus === 'Active' && hasUpcomingByMember.has(mem.id);

            return {
              memberId: mem.id,
              subscriptionId: sub?.id || null,
              planId: sub?.planId ?? null,
              subscriptionEndDate: sub?.endDate ?? null,
              code: mem.memberCode,
              name: mem.fullName,
              phone: formatPhoneVi(mem.phone),
              rawPhone: mem.phone ?? '',
              plan: sub ? sub.plan.name : 'Chưa có gói tập',
              validWindow: sub
                ? `${formatShortDate(sub.startDate)} – ${formatShortDate(sub.endDate)}`
                : 'Chưa đăng ký',
              hasQueuedRenewal,
              classQuotaShort: classShort,
              rawQuotas: (sub?.quotas ?? [])
                .filter((q) => q.service !== 'PT')
                .map((q) => ({
                  id: q.id,
                  subscriptionId: sub?.id ?? '',
                  service: q.service,
                  serviceName: q.serviceName,
                  allocated: q.allocated,
                  used: q.used,
                  reserved: q.reserved,
                  unlimited: q.allocated === null,
                  remaining:
                    q.allocated === null
                      ? null
                      : Math.max(0, q.allocated - q.used - q.reserved),
                  updatedAt: '',
                })),
              status: uiStatus,
              avatarUrl: mem.idPhotoUrl ?? null,
            };
          }),
        );

        hasLoadedRef.current = true;
      } catch {
        if (signal?.aborted || loadSeq !== directoryLoadSeq.current) return;
        setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
      } finally {
        if (!signal?.aborted && loadSeq === directoryLoadSeq.current) {
          setLoading(false);
          setIsLoading(false);
        }
      }
    },
    [currentPage, debouncedSearch, statusFilter],
  );

  useEffect(() => {
    if (!filtersReady) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadMembersDirectory(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMembersDirectory, filtersReady]);

  const currentEditPhotoSrc = editDraft?.photoInput ?? '';
  const editPhotoStatus = resolvePhotoValidationStatus(
    currentEditPhotoSrc,
    editPhotoValidation,
  );
  const editPhotoFeedback = formatPhotoValidationFeedback(
    editPhotoStatus,
    editPhotoValidation,
  );

  const stopWebcam = useCallback(() => {
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
  }, []);

  const markEditVideoReady = useCallback(() => {
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
          markEditVideoReady();
        })
        .catch(() => undefined);
    }
  }, [cameraActive, markEditVideoReady]);

  useEffect(() => {
    const trimmed = currentEditPhotoSrc.trim();
    if (!isSupportedPhotoDataUri(trimmed)) return;
    if (editPhotoValidation?.src === trimmed) return;

    const controller = new AbortController();
    const delayMs = sharedMemberPhotoValidator.peek(trimmed) ? 0 : 320;
    const timer = window.setTimeout(() => {
      void sharedMemberPhotoValidator
        .validate(trimmed, controller.signal)
        .then((outcome) => {
          if (!controller.signal.aborted) {
            setEditPhotoValidation({
              src: trimmed,
              valid: outcome.valid,
              faceCount: outcome.faceCount,
            });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setEditPhotoValidation({
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
  }, [currentEditPhotoSrc, editPhotoValidation?.src]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const startWebcam = async () => {
    setCameraError(null);
    setCameraFrameReady(false);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        'Trình duyệt không hỗ trợ truy cập Camera. Vui lòng dùng trình duyệt có hỗ trợ webcam.',
      );
      return;
    }
    try {
      stopWebcam();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 960 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current
          .play()
          .then(() => {
            markEditVideoReady();
          })
          .catch(() => undefined);
      }
      setCameraActive(true);
    } catch {
      setCameraError(
        'Không thể mở Webcam. Vui lòng kiểm tra quyền Camera và kết nối thiết bị rồi thử lại.',
      );
    }
  };

  const handleCaptureFrame = () => {
    const dataUrl = captureUnmirroredPortrait3x4(videoRef.current);
    if (!dataUrl) {
      setCameraError(
        'Camera đang khởi động khung hình, vui lòng chờ giây lát rồi chụp lại.',
      );
      return;
    }

    setEditDraft((prev) =>
      prev
        ? { ...prev, photoInput: dataUrl, submitError: null, conflicts: [] }
        : prev,
    );
    setCameraError(null);
    stopWebcam();
  };

  const openEditMemberModal = (member: StaffMemberRecord) => {
    stopWebcam();
    setCameraError(null);
    setEditPhotoValidation(null);
    setEditDraft(createStaffEditDraft(member));
  };

  const closeEditMemberModal = () => {
    if (!canCloseStaffEdit(editDraft)) return;

    const dirty = Boolean(
      editDraft &&
      (editDraft.fullName.trim() !== editDraft.target.name.trim() ||
        editDraft.phone.trim() !== editDraft.target.rawPhone.trim() ||
        hasStaffMemberPhotoChanged(editDraft)),
    );
    requestClose(dirty, Boolean(editDraft?.isSubmitting), () => {
      stopWebcam();
      setCameraError(null);
      setEditPhotoValidation(null);
      setEditDraft(null);
      restoreProfile();
    });
  };

  const handleSaveMemberProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDraft) return;
    setCameraError(null);
    const outcome = await runStaffMemberEditSave({
      draft: editDraft,
      setDraft: setEditDraft,
      validatePhoto: (src) => sharedMemberPhotoValidator.validate(src),
      updateMember: (memberId, payload) =>
        apiClient.patch(`/members/${memberId}`, payload),
      extractErrorMessage: (err) =>
        err instanceof ApiClientError
          ? err.message
          : 'Không thể cập nhật hồ sơ hội viên.',
    });
    if (outcome.status === 'saved') {
      stopWebcam();
      setEditPhotoValidation(null);
      setFeedbackBanner(outcome.bannerMessage);
      await loadMembersDirectory();
      restoreProfile();
    }
  };

  const handleActivateNow = async (member: StaffMemberRecord) => {
    if (!member.subscriptionId) return;
    try {
      await apiClient.post(
        `/subscriptions/${member.subscriptionId}/activate-now`,
      );
      setFeedbackBanner(
        `Đã kích hoạt sớm gói tập ngay hôm nay cho hội viên ${member.name}.`,
      );
      await loadMembersDirectory();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể kích hoạt gói tập cho ${member.name}.`,
      );
    }
  };

  const handleRenewSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewTarget || isSubmitting || catalogLoading || catalogError) return;
    const keyPayload = {
      memberId: renewTarget.memberId,
      subscriptionId: renewTarget.subscriptionId,
      planId: renewPlanId,
      method: renewMethod,
      note: renewNote,
    };
    const idempotencyKey = stableStaffRequestKey(renewalRequestKey, keyPayload);
    setIsSubmitting(true);
    try {
      if (renewTarget.subscriptionId) {
        await apiClient.post(
          `/subscriptions/${renewTarget.subscriptionId}/renew`,
          {
            idempotencyKey,
            planId: renewPlanId || undefined,
            paymentMethod: renewMethod,
            paymentStatus: PaymentStatus.PAID,
            note: renewNote.trim(),
          },
        );
        setFeedbackBanner(
          `Đã xếp hàng gói gia hạn cho ${renewTarget.name}. Gói mới sẽ tự động nối tiếp khi gói hiện tại kết thúc.`,
        );
      } else {
        const targetPlanId = renewPlanId || availablePlans[0]?.id;
        if (!targetPlanId) {
          setFeedbackBanner('Vui lòng chọn gói tập để đăng ký cho hội viên.');
          setIsSubmitting(false);
          return;
        }
        await apiClient.post('/subscriptions', {
          idempotencyKey,
          memberId: renewTarget.memberId,
          planId: targetPlanId,
          paymentMethod: renewMethod,
          paymentStatus: PaymentStatus.PAID,
          note: renewNote.trim() || 'Đăng ký gói tập trực tiếp tại quầy lễ tân',
        });
        setFeedbackBanner(
          `Đã đăng ký gói tập và kích hoạt cho hội viên ${renewTarget.name} (${renewTarget.code}).`,
        );
      }
      renewalRequestKey.current = null;
      setRenewTarget(null);
      await loadMembersDirectory();
      restoreProfile();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể xử lý gói tập cho ${renewTarget.name}.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openQuotaAdjustmentModal = (member: StaffMemberRecord) => {
    if (!isAdmin) return;
    setFeedbackBanner(null);
    setQuotaTarget(member);
    setAdjustQuotaId(
      member.rawQuotas.find((quota) => quota.allocated !== null)?.id ?? '',
    );
  };

  const handleAdjustMemberQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !quotaTarget || !adjustQuotaId) return;
    const allocatedDelta = Number(adjustDeltaInput);
    if (!Number.isInteger(allocatedDelta) || allocatedDelta === 0) {
      setFeedbackBanner(
        'Số buổi điều chỉnh phải là số nguyên khác 0 (ví dụ: +2 hoặc -1).',
      );
      return;
    }
    if (!adjustReasonInput.trim()) return;
    setIsSubmitting(true);
    try {
      await apiClient.post(`/quotas/${adjustQuotaId}/adjust`, {
        allocatedDelta,
        reason: adjustReasonInput.trim(),
      });
      setFeedbackBanner(
        `Đã điều chỉnh ${allocatedDelta > 0 ? `+${allocatedDelta}` : allocatedDelta} buổi cho hội viên ${quotaTarget.name} (${quotaTarget.code}).`,
      );
      setQuotaTarget(null);
      await loadMembersDirectory();
      restoreProfile();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể điều chỉnh hạn mức buổi tập.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !cancelTarget?.subscriptionId || !cancelReason.trim())
      return;
    setIsSubmitting(true);
    try {
      await apiClient.post(
        `/subscriptions/${cancelTarget.subscriptionId}/cancel`,
        {
          reason: cancelReason.trim(),
        },
      );
      setFeedbackBanner(`Đã huỷ gói tập của hội viên ${cancelTarget.name}.`);
      setCancelTarget(null);
      await loadMembersDirectory();
      restoreProfile();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể huỷ gói tập của ${cancelTarget.name}.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(directoryTotal / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedMembers = membersList;

  if (loading || loadError)
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              Quản lý Hồ sơ Hội viên
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setIsRegisterOpen(true)}
            className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Đăng ký hội viên mới
          </button>
        </div>
        <DataState
          loading={loading}
          error={loadError}
          variant="table"
          onRetry={() => void loadMembersDirectory()}
        />
      </div>
    );

  const renewalPlan = availablePlans.find(
    (plan) => plan.id === (renewPlanId || renewTarget?.planId),
  );
  const renewalStart =
    renewTarget?.status === 'Active' && renewTarget.subscriptionEndDate
      ? new Date(renewTarget.subscriptionEndDate)
      : new Date();
  const renewalEnd = new Date(renewalStart);
  if (renewalPlan)
    renewalEnd.setUTCDate(renewalEnd.getUTCDate() + renewalPlan.durationDays);
  const formatRenewalDate = (value: Date) =>
    value.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="space-y-6">
      {/* Header & Single Primary CTA */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Quản lý Hồ sơ Hội viên
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsRegisterOpen(true)}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Đăng ký hội viên mới
        </button>
      </div>

      {feedbackBanner && (
        <div className="flex items-center justify-between rounded-xl border border-[#FF5500]/30 bg-[#FF5500]/10 px-4 py-3 text-[13px] text-white">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-zinc-400 hover:text-white"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Member Directory Table Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        {/* Search & Single Status Filter Toolbar */}
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              placeholder="Tìm theo họ tên, mã MEM-XXXXXXXX hoặc số điện thoại..."
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] pl-10 pr-4 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
            />
          </div>

          <div className="relative self-start sm:self-auto">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Lọc hội viên theo trạng thái"
              className="h-10 appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-4 pr-9 text-[13px] text-zinc-200 focus:border-[#FF5500] focus:outline-none"
            >
              <option value="All">Tất cả trạng thái</option>
              <option value="Active">Đang tập</option>
              <option value="Upcoming">Chờ kích hoạt</option>
              <option value="Frozen">Đang bảo lưu</option>
              <option value="Expired">Đã hết hạn</option>
              <option value="None">Chưa có gói</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          </div>
        </div>

        {/* Streamlined 5-Column Members Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-4">Hội viên</th>
                <th className="pb-4">Gói tập &amp; Thời hạn</th>
                <th className="pb-4">Hạn mức buổi tập</th>
                <th className="pb-4">Trạng thái</th>
                <th className="pb-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-10 text-center text-[13px] text-zinc-500"
                  >
                    Đang tải danh sách hồ sơ hội viên...
                  </td>
                </tr>
              ) : paginatedMembers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-10 text-center text-[13px] text-zinc-500"
                  >
                    Không tìm thấy hội viên nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedMembers.map((member) => (
                  <tr
                    key={member.code}
                    className={cn(
                      'transition-colors hover:bg-white/[0.02]',
                      profileMember?.memberId === member.memberId &&
                        'bg-[#FF5500]/5 [&>td:first-child]:border-l-2 [&>td:first-child]:border-[#FF5500]',
                    )}
                  >
                    {/* Column 1: Member Identity (Click avatar to edit profile/photo) */}
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEditMemberModal(member)}
                          title="Cập nhật hồ sơ & Ảnh thẻ 3:4"
                          className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-full focus:outline-none"
                        >
                          {member.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.avatarUrl}
                              alt={member.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center bg-[#FF5500]/15 text-[13px] font-bold text-[#FF5500]">
                              {getInitials(member.name)}
                            </span>
                          )}
                          <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover:flex">
                            <Camera className="h-3.5 w-3.5" />
                          </span>
                        </button>
                        <div>
                          <button
                            type="button"
                            onClick={() => setProfileMember(member)}
                            aria-label={`Xem hồ sơ ${member.name}`}
                            className="text-left font-semibold text-white hover:text-[#FF5500] hover:underline focus-visible:outline-2 focus-visible:outline-[#FF5500]"
                          >
                            {member.name}
                          </button>
                          <p className="text-[13px] text-zinc-500">
                            <span className="font-mono text-zinc-400">
                              {member.code}
                            </span>{' '}
                            •{' '}
                            <span className="tabular-nums">{member.phone}</span>
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Plan Name & Validity Dates */}
                    <td className="py-4">
                      <p className="font-semibold text-zinc-200">
                        {member.plan}
                      </p>
                      <p className="text-[13px] tabular-nums text-zinc-500">
                        {member.validWindow}
                      </p>
                      {member.hasQueuedRenewal && (
                        <span className="mt-1 inline-block text-[13px] font-medium text-[#FF5500]">
                          + Đã nối tiếp gói gia hạn
                        </span>
                      )}
                    </td>

                    {/* Column 3: Clickable Session Quotas */}
                    <td className="py-4">
                      {member.subscriptionId ? (
                        <button
                          type="button"
                          onClick={() => setProfileMember(member)}
                          title="Bấm để xem chi tiết hạn mức & lịch sử buổi tập"
                          className="group inline-flex flex-wrap items-center gap-1.5 text-left text-[13px] tabular-nums"
                        >
                          <span className="inline-flex items-center rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 py-1 font-mono text-zinc-200 transition-colors group-hover:border-[#FF5500]/50 group-hover:text-white">
                            {member.classQuotaShort}
                          </span>
                        </button>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>

                    {/* Column 4: Subscription Status */}
                    <td className="py-4">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-medium',
                          member.status === 'Active' &&
                            'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
                          member.status === 'Upcoming' &&
                            'border-[#FF5500]/40 bg-[#FF5500]/10 text-[#FF5500]',
                          member.status === 'Frozen' &&
                            'border-amber-500/40 bg-amber-500/10 text-amber-400',
                          member.status === 'Expired' &&
                            'border-red-500/40 bg-red-500/10 text-red-400',
                          member.status === 'None' &&
                            'border-zinc-500/40 bg-zinc-500/10 text-zinc-400',
                        )}
                      >
                        {member.status === 'Active'
                          ? 'Đang tập'
                          : member.status === 'Upcoming'
                            ? 'Chờ kích hoạt'
                            : member.status === 'Frozen'
                              ? 'Đang bảo lưu'
                              : member.status === 'None'
                                ? 'Chưa có gói'
                                : 'Hết hạn'}
                      </span>
                    </td>

                    {/* Column 5: Streamlined Actions (Max 3 buttons) */}
                    <td className="py-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditMemberModal(member)}
                          title="Cập nhật họ tên, số điện thoại & ảnh thẻ 3:4"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          <SquarePen className="h-3 w-3 text-zinc-400" />
                          Sửa
                        </button>

                        {member.status === 'None' && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenewPlanId(availablePlans[0]?.id ?? '');
                              setRenewNote(
                                'Đăng ký gói tập trực tiếp tại quầy lễ tân',
                              );
                              setFeedbackBanner(null);
                              setRenewTarget(member);
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#FF5500] px-2.5 text-[13px] font-semibold text-white hover:bg-[#E64D00]"
                          >
                            <CreditCard className="h-3 w-3" />
                            Đăng ký gói
                          </button>
                        )}

                        {member.status === 'Upcoming' && (
                          <button
                            type="button"
                            onClick={() => void handleActivateNow(member)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#FF5500]/15 px-2.5 text-[13px] font-semibold text-[#FF5500] hover:bg-[#FF5500]/25"
                          >
                            <Play className="h-3 w-3" />
                            Kích hoạt
                          </button>
                        )}

                        {(member.status === 'Active' ||
                          member.status === 'Expired') &&
                          member.subscriptionId &&
                          !member.hasQueuedRenewal && (
                            <button
                              type="button"
                              onClick={() => {
                                setRenewPlanId('');
                                setRenewNote(
                                  'Đăng ký gia hạn nối tiếp tại quầy lễ tân',
                                );
                                setFeedbackBanner(null);
                                setRenewTarget(member);
                              }}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] font-medium text-zinc-200 hover:border-[#FF5500] hover:text-[#FF5500]"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Gia hạn
                            </button>
                          )}

                        {member.status !== 'Expired' &&
                          member.subscriptionId && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(member)}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-red-500/25 bg-red-500/10 px-2 text-[13px] font-medium text-red-400 hover:bg-red-500/20"
                            >
                              <Ban className="h-3 w-3" />
                              Huỷ gói
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Pagination */}
        <TablePagination
          totalItems={directoryTotal}
          pageSize={PAGE_SIZE}
          currentPage={safePage}
          onPageChange={setCurrentPage}
          itemLabel="hội viên"
        />
      </div>

      {/* Modal 1: All-in-One Member Onboarding */}
      {profileMember && (
        <MemberProfileDrawer
          key={profileMember.memberId}
          memberId={profileMember.memberId}
          onClose={() => setProfileMember(null)}
          onEdit={(member) => {
            returnProfile.current = profileMember;
            const target = {
              ...profileMember,
              name: member.fullName,
              rawPhone: member.phone ?? '',
              avatarUrl: member.idPhotoUrl ?? null,
            };
            setProfileMember(null);
            openEditMemberModal(target);
          }}
          onAdjustQuota={(member, sub) => {
            returnProfile.current = profileMember;
            setProfileMember(null);
            void openQuotaAdjustmentModal({
              ...profileMember,
              name: member.fullName,
              subscriptionId: sub.id,
              plan: sub.plan.name,
              rawQuotas: sub.quotas
                .filter((q) => q.service !== 'PT')
                .map((quota) => ({
                  ...quota,
                  subscriptionId: sub.id,
                  unlimited: quota.allocated === null,
                  updatedAt: sub.updatedAt,
                  remaining:
                    quota.allocated === null
                      ? null
                      : Math.max(
                          0,
                          quota.allocated - quota.used - quota.reserved,
                        ),
                })),
            });
          }}
          onCancel={(member, sub) => {
            returnProfile.current = profileMember;
            setProfileMember(null);
            setFeedbackBanner(null);
            setCancelTarget({
              ...profileMember,
              name: member.fullName,
              subscriptionId: sub.id,
              plan: sub.plan.name,
            });
          }}
          onRenew={(member, sub) => {
            returnProfile.current = profileMember;
            const target: StaffMemberRecord = {
              ...profileMember,
              name: member.fullName,
              subscriptionId: sub?.id ?? null,
              planId: sub?.planId ?? null,
              subscriptionEndDate: sub?.endDate ?? null,
              plan: sub?.plan.name ?? 'Chưa có gói tập',
              validWindow: sub
                ? formatShortDate(sub.startDate) +
                  ' – ' +
                  formatShortDate(sub.endDate)
                : 'Chưa đăng ký',
              status: sub ? mapSubStatusToUi(sub.effectiveStatus) : 'None',
            };
            setProfileMember(null);
            setRenewPlanId(sub ? '' : (availablePlans[0]?.id ?? ''));
            setRenewNote('Đăng ký gia hạn nối tiếp tại quầy lễ tân');
            setFeedbackBanner(null);
            setRenewTarget(target);
          }}
        />
      )}

      {discardAction && (
        <DiscardChangesDialog
          onKeepEditing={() => setDiscardAction(null)}
          onDiscard={() => {
            const action = discardAction;
            setDiscardAction(null);
            action();
          }}
        />
      )}

      <MemberOnboardingModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        availablePlans={availablePlans}
        plansLoading={catalogLoading}
        plansError={catalogError}
        onRetryPlans={() => setCatalogRetry((value) => value + 1)}
        onSuccess={(_result, summaryMessage) => {
          setFeedbackBanner(summaryMessage);
          void loadMembersDirectory();
        }}
        onIncompleteMemberDismissed={() => {
          void loadMembersDirectory();
        }}
      />

      {/* Modal 2: Unified Edit Profile & Webcam 3:4 ID Photo */}
      {editDraft && (
        <StaffFormModal
          title="Sửa thông tin hội viên"
          subtitle={editDraft.target.code}
          busy={editDraft.isSubmitting}
          onClose={closeEditMemberModal}
          onSubmit={handleSaveMemberProfile}
          footer={
            <>
              <button
                type="button"
                disabled={!canCloseStaffEdit(editDraft)}
                onClick={closeEditMemberModal}
                className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={editDraft.isSubmitting || !editDraft.fullName.trim()}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {editDraft.isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </>
          }
        >
          {editDraft.submitError && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-200"
            >
              {editDraft.submitError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[140px_minmax(0,1fr)]">
            <div>
              <p className="mb-2 text-[13px] font-medium text-zinc-300">
                Ảnh nhận diện
              </p>{' '}
              <div className="space-y-3">
                <div className="space-y-3">
                  <div className="aspect-[3/4] w-[120px] shrink-0 overflow-hidden rounded-lg border border-white/15 bg-zinc-900">
                    {cameraActive ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        onLoadedData={markEditVideoReady}
                        onCanPlay={markEditVideoReady}
                        onPlaying={markEditVideoReady}
                        className="h-full w-full -scale-x-100 object-cover"
                      />
                    ) : editDraft.photoInput ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={editDraft.photoInput}
                        alt={editDraft.target.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500">
                        <UserRound
                          className="h-8 w-8"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                        <span className="text-xs">Chưa có ảnh</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {!cameraActive ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={editDraft.isSubmitting}
                          onClick={() => void startWebcam()}
                          className="inline-flex h-9 w-[120px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#141418] px-2 text-xs font-semibold text-white hover:border-[#FF5500] disabled:opacity-50"
                        >
                          <Camera className="h-3.5 w-3.5 text-[#FF5500]" />
                          {hasStaffMemberPhotoChanged(editDraft) &&
                          editDraft.photoInput
                            ? 'Chụp lại'
                            : 'Chụp ảnh mới'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!cameraFrameReady || editDraft.isSubmitting}
                          onClick={handleCaptureFrame}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#FF5500] px-3 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          {cameraFrameReady ? 'Chụp ảnh' : 'Đang mở cam...'}
                        </button>
                        <button
                          type="button"
                          disabled={editDraft.isSubmitting}
                          onClick={stopWebcam}
                          className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-[#141418] px-2.5 text-[13px] font-medium text-zinc-300 hover:text-white disabled:opacity-50"
                        >
                          Dừng camera
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <FaceConflicts conflicts={editDraft.conflicts} />
                {cameraError && (
                  <p className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[13px] leading-relaxed text-amber-300">
                    {cameraError}
                  </p>
                )}

                {!cameraActive && editPhotoFeedback && (
                  <p
                    className={cn(
                      'mt-2.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium',
                      editPhotoStatus === 'valid'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : editPhotoStatus === 'checking'
                          ? 'border-white/10 bg-[#141418] text-zinc-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                    )}
                  >
                    {editPhotoFeedback}
                  </p>
                )}

                {!cameraActive &&
                  (editDraft.photoInput ||
                    hasStaffMemberPhotoChanged(editDraft)) && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {hasStaffMemberPhotoChanged(editDraft) &&
                          editDraft.target.avatarUrl && (
                            <button
                              type="button"
                              disabled={editDraft.isSubmitting}
                              onClick={() => {
                                setCameraError(null);
                                setEditDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        photoInput: prev.target.avatarUrl ?? '',
                                        submitError: null,
                                      }
                                    : prev,
                                );
                              }}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Dùng ảnh hiện tại
                            </button>
                          )}
                        {editDraft.photoInput && (
                          <button
                            type="button"
                            disabled={editDraft.isSubmitting}
                            onClick={() => {
                              setCameraError(null);
                              setEditDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      photoInput: '',
                                      submitError: null,
                                    }
                                  : prev,
                              );
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Xoá ảnh
                          </button>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="edit-member-name"
                  className="mb-1 block text-[13px] font-medium text-zinc-300"
                >
                  Họ và tên
                </label>
                <input
                  id="edit-member-name"
                  type="text"
                  required
                  disabled={editDraft.isSubmitting}
                  value={editDraft.fullName}
                  onChange={(e) =>
                    setEditDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            fullName: e.target.value,
                            submitError: null,
                          }
                        : prev,
                    )
                  }
                  className="h-9 w-full rounded-lg border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none disabled:opacity-60"
                />
              </div>
              <div>
                <label
                  htmlFor="edit-member-phone"
                  className="mb-1 block text-[13px] font-medium text-zinc-300"
                >
                  Số điện thoại
                </label>
                <input
                  id="edit-member-phone"
                  type="tel"
                  disabled={editDraft.isSubmitting}
                  value={editDraft.phone}
                  onChange={(e) =>
                    setEditDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            phone: e.target.value,
                            submitError: null,
                          }
                        : prev,
                    )
                  }
                  placeholder="0901234567"
                  className="h-9 w-full rounded-lg border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        </StaffFormModal>
      )}

      {/* Modal 3: Queue Renewal OR Register First Plan */}
      {renewTarget && (
        <StaffFormModal
          title={renewTarget.subscriptionId ? 'Gia hạn gói' : 'Đăng ký gói'}
          subtitle={renewTarget.name + ' · ' + renewTarget.code}
          busy={isSubmitting}
          onClose={closeRenewModal}
          onSubmit={handleRenewSubscription}
          footer={
            <>
              <button
                type="button"
                onClick={closeRenewModal}
                disabled={isSubmitting}
                className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !renewalPlan ||
                  catalogLoading ||
                  Boolean(catalogError)
                }
                className="min-h-9 rounded-xl bg-[#FF5500] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {isSubmitting
                  ? 'Đang xử lý…'
                  : `Xác nhận và thu ${formatVnd(renewalPlan?.price ?? 0)}`}
              </button>
            </>
          }
        >
          {catalogLoading && (
            <p role="status" className="text-sm text-zinc-400">
              Đang tải gói tập…
            </p>
          )}
          {catalogError && (
            <p role="alert" className="text-sm text-amber-300">
              {catalogError}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setCatalogRetry((value) => value + 1)}
              >
                Thử lại
              </button>
            </p>
          )}
          {feedbackBanner && (
            <p
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
            >
              {feedbackBanner}
            </p>
          )}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-zinc-300">
              {renewTarget.subscriptionId
                ? 'Chọn gói gia hạn'
                : 'Chọn gói đăng ký'}
            </label>
            <select
              value={renewPlanId}
              onChange={(e) => setRenewPlanId(e.target.value)}
              aria-label="Chọn gói tập"
              className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            >
              {renewTarget.subscriptionId && (
                <option value="">Giữ nguyên theo gói hiện tại</option>
              )}
              {availablePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatDurationVi(p.durationDays)} —{' '}
                  {formatVnd(p.price)})
                </option>
              ))}
            </select>
          </div>
          {renewTarget.subscriptionId && (
            <div className="border-b border-white/10 pb-3 text-sm">
              <p className="text-zinc-500">Gói hiện tại</p>
              <p className="mt-1 text-white">{renewTarget.plan}</p>
              <p className="mt-1 text-zinc-400">{renewTarget.validWindow}</p>
            </div>
          )}
          {renewalPlan ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-zinc-500">Bắt đầu dự kiến</dt>
                <dd className="mt-1 text-zinc-200">
                  {formatRenewalDate(renewalStart)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Kết thúc dự kiến</dt>
                <dd className="mt-1 text-zinc-200">
                  {formatRenewalDate(renewalEnd)}
                </dd>
              </div>
            </dl>
          ) : (
            <p role="alert" className="text-sm text-amber-300">
              Vui lòng chọn một gói đang bán để xem thời hạn và số tiền thu.
            </p>
          )}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-zinc-300">
              Hình thức thanh toán
            </label>
            <select
              value={renewMethod}
              onChange={(e) =>
                setRenewMethod(e.target.value as 'CASH' | 'TRANSFER')
              }
              aria-label="Hình thức thanh toán"
              className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            >
              <option value="TRANSFER">Chuyển khoản ngân hàng</option>
              <option value="CASH">Tiền mặt tại quầy</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-zinc-300">
              Ghi chú biên lai
            </label>
            <input
              type="text"
              value={renewNote}
              onChange={(e) => setRenewNote(e.target.value)}
              aria-label="Ghi chú biên lai"
              className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            />
          </div>
        </StaffFormModal>
      )}

      {/* Modal 4: Cancel Subscription */}
      {cancelTarget && (
        <StaffFormModal
          title={'Hủy gói'}
          subtitle={cancelTarget.name + ' · ' + cancelTarget.code}
          busy={isSubmitting}
          onClose={closeCancelModal}
          onSubmit={handleCancelSubscription}
          footer={
            <>
              <button
                type="button"
                onClick={closeCancelModal}
                disabled={isSubmitting}
                className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300"
              >
                Quay lại
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="h-9 rounded-xl bg-red-500 px-4 text-[13px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                Xác nhận huỷ gói
              </button>
            </>
          }
        >
          <div className="border-b border-white/10 pb-4 text-sm">
            <p className="font-medium text-zinc-200">{cancelTarget.plan}</p>
            <p className="mt-1 text-zinc-500">{cancelTarget.validWindow}</p>
            {cancelContext?.id === cancelTarget.subscriptionId ? (
              <>
                <p className="mt-3 text-zinc-300">
                  Đã thu{' '}
                  {formatVnd(
                    (cancelContext.payments ?? [])
                      .filter(
                        (payment) => payment.status === PaymentStatus.PAID,
                      )
                      .reduce((sum, payment) => sum + payment.amount, 0),
                  )}
                </p>
                <p className="mt-1 text-zinc-500">
                  Hoàn tiền được xử lý riêng bởi quản trị viên.
                </p>
              </>
            ) : (
              <p className="mt-3 text-zinc-500">
                {cancelContextError || 'Đang tải thông tin thanh toán…'}
              </p>
            )}
            {cancelContext?.id === cancelTarget.subscriptionId &&
              cancelNextCount > 0 && (
                <p className="mt-3 text-amber-300">
                  Có {cancelNextCount} gói sắp tới. Sau khi hủy, cần kiểm tra
                  lịch nối tiếp.
                </p>
              )}
          </div>
          {feedbackBanner && (
            <p
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
            >
              {feedbackBanner}
            </p>
          )}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-zinc-300">
              Lý do huỷ gói
            </label>
            <textarea
              rows={3}
              maxLength={500}
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              aria-label="Lý do huỷ gói"
              className="min-h-24 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            />
          </div>
        </StaffFormModal>
      )}

      {/* Admin quota adjustment modal */}
      {isAdmin && quotaTarget && (
        <ModalFrame
          onClose={closeQuotaAdjustmentModal}
          labelledBy="app-dashboard-staff-members-page-heading-9"
          maxWidthClassName="max-w-2xl"
        >
          <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#141418] px-5 pt-5 shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#141418] pb-4">
              <div>
                <h3
                  className="text-base font-bold text-white"
                  id="app-dashboard-staff-members-page-heading-9"
                >
                  Điều chỉnh số buổi
                </h3>
                <p className="mt-0.5 text-[13px] text-zinc-400">
                  <strong className="text-white">{quotaTarget.name}</strong> (
                  <span className="font-mono text-[#FF5500]">
                    {quotaTarget.code}
                  </span>
                  ) • {quotaTarget.plan}
                </p>
              </div>
              <button
                type="button"
                onClick={closeQuotaAdjustmentModal}
                disabled={isSubmitting}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Section 1: Dual-Phase Quota Progress Meters */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quotaTarget.rawQuotas
                .filter((q) => q.service === 'CLASS')
                .map((q) => (
                  <div
                    key={q.id}
                    className="flex items-baseline justify-between gap-4 border-b border-white/10 py-3 text-sm"
                  >
                    <span className="text-zinc-400">
                      {formatServiceLabelVi(q.service, q.serviceName)}
                    </span>
                    <span className="tabular-nums text-zinc-100">
                      {q.allocated === null
                        ? 'Không giới hạn'
                        : Math.max(0, q.allocated - q.used - q.reserved) +
                          ' / ' +
                          q.allocated +
                          ' lượt còn lại'}
                    </span>
                  </div>
                ))}
            </div>

            {/* Section 2: Admin Quota Adjustment Form (Admin Only) */}
            {isAdmin &&
              quotaTarget.rawQuotas.some((q) => q.allocated !== null) && (
                <details className="mt-4" open={isAdmin}>
                  <summary className="cursor-pointer text-sm font-medium text-zinc-300">
                    Điều chỉnh số buổi
                  </summary>{' '}
                  <form
                    onSubmit={handleAdjustMemberQuota}
                    className="mt-4 rounded-xl border border-[#FF5500]/25 bg-[#18181C] p-4"
                  >
                    <fieldset disabled={isSubmitting} className="min-w-0">
                      {feedbackBanner && (
                        <p
                          role="alert"
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                        >
                          {feedbackBanner}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
                        <Sliders className="h-3.5 w-3.5 text-[#FF5500]" />
                        <span>Điều chỉnh số buổi cấp phát (+/-)</span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                        <div className="sm:col-span-4">
                          <select
                            value={adjustQuotaId}
                            onChange={(e) => setAdjustQuotaId(e.target.value)}
                            aria-label="Chọn dịch vụ cần điều chỉnh"
                            className="h-9 w-full rounded-lg border border-white/10 bg-[#141418] px-2.5 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                          >
                            {quotaTarget.rawQuotas
                              .filter((q) => q.allocated !== null)
                              .map((q) => (
                                <option key={q.id} value={q.id}>
                                  {formatServiceLabelVi(
                                    q.service,
                                    q.serviceName,
                                  )}{' '}
                                  ({q.allocated} buổi)
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            type="text"
                            required
                            value={adjustDeltaInput}
                            onChange={(e) =>
                              setAdjustDeltaInput(e.target.value)
                            }
                            placeholder="+2 / -1"
                            aria-label="Số buổi cộng hoặc trừ"
                            className="h-9 w-full rounded-lg border border-white/10 bg-[#141418] px-2.5 font-mono text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            required
                            value={adjustReasonInput}
                            onChange={(e) =>
                              setAdjustReasonInput(e.target.value)
                            }
                            placeholder="Lý do điều chỉnh..."
                            aria-label="Lý do điều chỉnh"
                            className="h-9 w-full rounded-lg border border-white/10 bg-[#141418] px-2.5 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="h-9 w-full rounded-lg bg-[#FF5500] px-3 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
                          >
                            Áp dụng
                          </button>
                        </div>
                      </div>
                    </fieldset>
                  </form>
                </details>
              )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeQuotaAdjustmentModal}
                disabled={isSubmitting}
                className="h-9 rounded-xl border border-white/10 bg-[#18181C] px-4 text-[13px] font-semibold text-zinc-200 hover:text-white"
              >
                Đóng
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
