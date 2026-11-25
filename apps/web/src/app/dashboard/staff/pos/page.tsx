'use client';

import { MemberQuickView } from '@/features/members/member-quick-view';

import { staffDate } from '@/lib/staff-date';

import {
  stableStaffRequestKey,
  type StaffRequestKey,
} from '@/lib/staff-request-key';

import { PaymentStatusBadge } from '@/components/shared/domain-status-badge';

import { formatVnd, formatDurationVi } from '@/lib/formatters';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Receipt,
  Check,
  Eye,
  X,
  UserPlus,
  Search,
  ChevronDown,
  Printer,
  RotateCcw,
} from 'lucide-react';
import {
  PaymentStatus,
  UserRole,
  type MembershipPlanDetail,
  type PaginatedMembersResponse,
  type PaginatedMembershipPlansResponse,
  type PaginatedPaymentsResponse,
  type PaymentReceipt,
  type PaymentRecordDetail,
  type SubscriptionDetail,
} from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { DataState } from '@/components/shared/data-state';
import { apiClient, ApiClientError } from '@/services/api-client';
import { formatReceiptNumber } from '@/lib/utils';
import { MemberOnboardingModal } from '@/features/members/member-onboarding-modal';
import { TablePagination } from '@/components/shared/table-pagination';

const PAGE_SIZE = 10;

interface ReceiptRow {
  isLegacyPt: boolean;
  id: string;
  memberId: string;
  receiptNo: string;
  memberCode: string;
  memberName: string;
  planName: string;
  methodCode: 'CASH' | 'TRANSFER' | 'CARD';
  methodLabel: string;
  amount: string;
  status: 'Paid' | 'Pending' | 'Refunded';
  createdAt: string;
}

function mapMethodLabel(method: string | null): string {
  if (method === 'TRANSFER') return 'Chuyển khoản';
  if (method === 'CARD') return 'Thẻ POS';
  return 'Tiền mặt';
}

function normalizeMethodCode(
  method: string | null,
): 'CASH' | 'TRANSFER' | 'CARD' {
  if (method === 'TRANSFER') return 'TRANSFER';
  if (method === 'CARD') return 'CARD';
  return 'CASH';
}

export default function StaffPosCashierPage() {
  const { user } = useAuthStore();
  const isAdmin = Boolean(user?.roles?.includes(UserRole.ADMIN));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [receipts, setReceipts] = useState<ReadonlyArray<ReceiptRow>>([]);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Toolbar Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersReady, setFiltersReady] = useState(false);
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'CASH' | 'TRANSFER'>(
    'ALL',
  );
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'Paid' | 'Pending' | 'Refunded'
  >('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const posLoadSeq = useRef(0);

  // Member & Plan options for New Subscription Receipt Modal (`POST /subscriptions`)
  const [memberOptions, setMemberOptions] = useState<
    ReadonlyArray<{ id: string; code: string; name: string }>
  >([]);
  const [planOptions, setPlanOptions] = useState<
    ReadonlyArray<{
      id: string;
      name: string;
      price: number;
      durationDays: number;
    }>
  >([]);

  // Modal 0: All-in-One Member Onboarding
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [rawActivePlans, setRawActivePlans] = useState<
    ReadonlyArray<MembershipPlanDetail>
  >([]);

  // Modal 1: New Subscription Sale & Receipt (`POST /subscriptions`)
  const posRequestKey = useRef<StaffRequestKey | null>(null);
  const [quickViewMemberId, setQuickViewMemberId] = useState<string | null>(
    null,
  );
  const [posModalOpen, setPosModalOpen] = useState(false);
  const [posMemberId, setPosMemberId] = useState('');
  const [posPlanId, setPosPlanId] = useState('');
  const [posMemberSearch, setPosMemberSearch] = useState('');
  const [posActivationMode, setPosActivationMode] = useState<
    'TODAY' | 'SCHEDULED'
  >('TODAY');
  const [posStartDate, setPosStartDate] = useState(() => staffDate());
  const [posMethod, setPosMethod] = useState<'CASH' | 'TRANSFER'>('TRANSFER');
  const [posNote, setPosNote] = useState('');
  const [posSubmitting, setPosSubmitting] = useState(false);

  // Modal 2: View Official Receipt (`GET /payments/:id/receipt`)
  const [viewingReceipt, setViewingReceipt] = useState<PaymentReceipt | null>(
    null,
  );

  // Modal 3: Refund Payment (`POST /payments/:id/refund` — Admin only)
  const [refundTarget, setRefundTarget] = useState<ReceiptRow | null>(null);
  const [refundReason, setRefundReason] = useState(
    'Hoàn tiền theo yêu cầu khách hàng được phê duyệt',
  );
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const hasLoadedRef = useRef(false);
  const [profileMemberId, setProfileMemberId] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      setProfileMemberId(query.get('memberId') ?? '');
      setSearchQuery(query.get('search') ?? '');
      setDebouncedSearch(query.get('search') ?? '');
      setFiltersReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);

  useEffect(() => {
    if (!(posModalOpen || onboardingModalOpen)) return;
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
          setRawActivePlans(activePlans);
          setPlanOptions(
            activePlans.map((plan) => ({
              id: plan.id,
              name:
                plan.name + ' (' + formatDurationVi(plan.durationDays) + ')',
              price: plan.price,
              durationDays: plan.durationDays,
            })),
          );
          setPosPlanId((previous) =>
            activePlans.some((plan) => plan.id === previous)
              ? previous
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
  }, [posModalOpen, onboardingModalOpen, catalogRetry]);

  useEffect(() => {
    if (!filtersReady || searchQuery === debouncedSearch) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, debouncedSearch, filtersReady]);
  const loadPosData = useCallback(
    async (signal?: AbortSignal) => {
      const loadSeq = ++posLoadSeq.current;
      if (!hasLoadedRef.current) setLoading(true);
      setLoadError('');
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        page: String(currentPage),
        search: debouncedSearch,
      });
      if (profileMemberId) query.set('memberId', profileMemberId);
      if (methodFilter !== 'ALL') query.set('method', methodFilter);
      if (statusFilter !== 'ALL')
        query.set('status', statusFilter.toUpperCase());
      try {
        const result = await apiClient<PaginatedPaymentsResponse>(
          '/payments?' + query,
          { signal, skipCache: true },
        );
        if (signal?.aborted || loadSeq !== posLoadSeq.current) return;
        const data = result.data;
        setReceiptTotal(result.meta.total);
        setCurrentPage((previous) =>
          Math.min(previous, Math.max(1, result.meta.totalPages)),
        );
        setReceipts(
          data.map((p: PaymentRecordDetail) => ({
            id: p.id,
            receiptNo: formatReceiptNumber(p.id, p.confirmedAt ?? p.createdAt),
            memberCode: p.memberCode,
            memberName: p.memberFullName,
            memberId: p.memberId,
            isLegacyPt: Boolean(p.ptPurchase),
            planName:
              p.subscription?.planName ??
              p.ptPurchase?.packageName ??
              'Gói hội viên',
            methodCode: normalizeMethodCode(p.method),
            methodLabel: mapMethodLabel(p.method),
            amount: formatVnd(p.amount),
            status:
              p.status === PaymentStatus.PAID
                ? 'Paid'
                : p.status === PaymentStatus.REFUNDED
                  ? 'Refunded'
                  : 'Pending',
            createdAt: `${new Date(p.createdAt).toLocaleDateString('vi-VN')} ${new Date(
              p.createdAt,
            ).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            })}`,
          })),
        );
        hasLoadedRef.current = true;
      } catch {
        if (!signal?.aborted && loadSeq === posLoadSeq.current)
          setLoadError('Không thể tải biên lai. Vui lòng thử lại.');
      } finally {
        if (!signal?.aborted && loadSeq === posLoadSeq.current)
          setLoading(false);
      }
    },
    [currentPage, debouncedSearch, methodFilter, statusFilter, profileMemberId],
  );

  useEffect(() => {
    if (!filtersReady) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadPosData(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPosData, filtersReady]);

  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState('');
  const [memberSearchRetry, setMemberSearchRetry] = useState(0);
  const previousMemberSearch = useRef('');
  useEffect(() => {
    if (!posModalOpen) return;
    const controller = new AbortController();
    const delay = previousMemberSearch.current === posMemberSearch ? 0 : 250;
    previousMemberSearch.current = posMemberSearch;
    const timer = window.setTimeout(() => {
      setMemberSearchLoading(true);
      setMemberSearchError('');
      void apiClient
        .get<PaginatedMembersResponse>(
          `/members?limit=20&includePhoto=false&search=${encodeURIComponent(posMemberSearch)}`,
          { signal: controller.signal },
        )
        .then((response) => {
          if (!controller.signal.aborted)
            setMemberOptions(
              response.data.map((member) => ({
                id: member.id,
                code: member.memberCode,
                name: member.fullName,
              })),
            );
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setMemberSearchError('Không thể tìm hội viên. Vui lòng thử lại.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setMemberSearchLoading(false);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [posMemberSearch, posModalOpen, memberSearchRetry]);

  const handleCreatePosSubscription = async () => {
    if (
      !posMemberId ||
      !posPlanId ||
      posSubmitting ||
      catalogLoading ||
      catalogError ||
      memberSearchLoading ||
      memberSearchError
    )
      return;
    const selMember = memberOptions.find((m) => m.id === posMemberId);
    if (!selMember) {
      setFeedbackMsg('Vui lòng chọn lại hội viên từ kết quả tìm kiếm.');
      return;
    }
    setPosSubmitting(true);

    const payload = {
      memberId: posMemberId,
      planId: posPlanId,
      startDate:
        posActivationMode === 'SCHEDULED' && posStartDate
          ? new Date(`${posStartDate}T00:00:00+07:00`).toISOString()
          : undefined,
      paymentMethod: posMethod,
      paymentStatus: PaymentStatus.PAID,
      note: posNote || 'Đăng ký & thu tiền trực tiếp tại quầy lễ tân',
    };

    try {
      await apiClient<SubscriptionDetail>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          idempotencyKey: stableStaffRequestKey(posRequestKey, payload),
        }),
      });

      posRequestKey.current = null;
      await loadPosData();
      setPosModalOpen(false);
      setPosNote('');
      setPosActivationMode('TODAY');
      setFeedbackMsg(
        `Đã tạo gói tập và xuất biên lai cho hội viên ${selMember?.name ?? ''}.`,
      );
    } catch (err) {
      setFeedbackMsg(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể tạo gói tập và xuất biên lai.',
      );
    } finally {
      setPosSubmitting(false);
    }
  };

  const handleConfirmPaid = async (rec: ReceiptRow) => {
    try {
      await apiClient(`/payments/${rec.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          method: rec.methodCode === 'CARD' ? 'TRANSFER' : rec.methodCode,
        }),
      });
      await loadPosData();
      setFeedbackMsg(`Đã xác nhận thu tiền cho biên lai ${rec.receiptNo}.`);
    } catch (err) {
      setFeedbackMsg(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể xác nhận thanh toán.',
      );
    }
  };

  const handleOpenReceiptModal = async (rec: ReceiptRow) => {
    try {
      const detail = await apiClient<PaymentReceipt>(
        `/payments/${rec.id}/receipt`,
      );
      setViewingReceipt(detail);
    } catch (err) {
      setFeedbackMsg(
        err instanceof ApiClientError
          ? err.message
          : 'Biên lai chính thức chỉ khả dụng cho các giao dịch đã thu tiền.',
      );
    }
  };

  const handleConfirmRefund = async () => {
    if (!refundTarget || !refundReason.trim()) return;
    setRefundSubmitting(true);
    try {
      await apiClient(`/payments/${refundTarget.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason.trim() }),
      });
      const targetNo = refundTarget.receiptNo;
      const targetMember = refundTarget.memberName;
      setRefundTarget(null);
      await loadPosData();
      setFeedbackMsg(
        `Đã hoàn tiền biên lai ${targetNo} cho hội viên ${targetMember}.`,
      );
    } catch (err) {
      setFeedbackMsg(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể hoàn tiền cho giao dịch này.',
      );
    } finally {
      setRefundSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(receiptTotal / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedReceipts = receipts;

  if (loading || loadError)
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              Thu ngân
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setOnboardingModalOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-[#18181C] px-4 text-[13px] font-semibold text-white transition-colors hover:border-[#FF5500] hover:bg-white/[0.04]"
            >
              <UserPlus className="h-4 w-4 text-[#FF5500]" />
              Đăng ký hội viên mới
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedbackMsg('');
                setPosModalOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00]"
            >
              <Receipt className="h-4 w-4" />
              Bán gói / Gia hạn
            </button>
          </div>
        </div>
        <DataState
          loading={loading}
          error={loadError}
          variant="dashboard"
          onRetry={() => void loadPosData()}
        />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Thu ngân
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setOnboardingModalOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-[#18181C] px-4 text-[13px] font-semibold text-white transition-colors hover:border-[#FF5500] hover:bg-white/[0.04]"
          >
            <UserPlus className="h-4 w-4 text-[#FF5500]" />
            Đăng ký hội viên mới
          </button>

          <button
            type="button"
            onClick={() => {
              setFeedbackMsg('');
              setPosModalOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00]"
          >
            <Receipt className="h-4 w-4" />
            Bán gói / Gia hạn
          </button>
        </div>
      </div>

      {profileMemberId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-300">
          <button
            type="button"
            onClick={() => setQuickViewMemberId(profileMemberId)}
            className="hover:text-[#FF5500]"
          >
            Đang lọc thanh toán theo hội viên · Xem hồ sơ
          </button>
          <button
            type="button"
            className="text-zinc-400 hover:text-white"
            onClick={() => {
              setProfileMemberId('');
              setSearchQuery('');
              setDebouncedSearch('');
              setCurrentPage(1);
              window.history.replaceState(null, '', '/dashboard/staff/pos');
            }}
          >
            Xóa lọc hội viên
          </button>
        </div>
      )}
      {feedbackMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-300">
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg('')}
            className="text-emerald-300 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Payment receipts */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        {/* Search & Filters Toolbar */}
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="relative flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              placeholder="Tìm theo mã biên lai REC-..., tên hoặc mã hội viên..."
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] pl-10 pr-4 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <select
                value={methodFilter}
                onChange={(e) => {
                  setMethodFilter(
                    e.target.value as 'ALL' | 'CASH' | 'TRANSFER',
                  );
                  setCurrentPage(1);
                }}
                aria-label="Lọc theo hình thức thanh toán"
                className="h-10 appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-4 pr-9 text-[13px] text-zinc-200 focus:border-[#FF5500] focus:outline-none"
              >
                <option value="ALL">Tất cả hình thức</option>
                <option value="CASH">Tiền mặt</option>
                <option value="TRANSFER">Chuyển khoản</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            </div>

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(
                    e.target.value as 'ALL' | 'Paid' | 'Pending' | 'Refunded',
                  );
                  setCurrentPage(1);
                }}
                aria-label="Lọc theo trạng thái thanh toán"
                className="h-10 appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-4 pr-9 text-[13px] text-zinc-200 focus:border-[#FF5500] focus:outline-none"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="Paid">Đã thu tiền</option>
                <option value="Pending">Chờ xác nhận</option>
                <option value="Refunded">Đã hoàn tiền</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-3.5">Mã biên lai</th>
                <th className="pb-3.5">Hội viên</th>
                <th className="pb-3.5">Gói đăng ký</th>
                <th className="pb-3.5">Hình thức</th>
                <th className="pb-3.5">Số tiền</th>
                <th className="pb-3.5">Trạng thái</th>
                <th className="pb-3.5">Thời gian tạo</th>
                <th className="pb-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {paginatedReceipts.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-8 text-center text-[13px] text-zinc-500"
                  >
                    Không tìm thấy biên lai nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedReceipts.map((rec) => (
                  <tr
                    key={rec.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5 font-mono font-semibold text-white">
                      {rec.receiptNo}
                    </td>
                    <td className="py-3.5">
                      <p className="font-semibold text-white">
                        <button
                          type="button"
                          onClick={() => setQuickViewMemberId(rec.memberId)}
                          aria-label={`Xem nhanh hội viên ${rec.memberName}`}
                          className="text-left hover:text-[#FF5500] hover:underline focus-visible:outline-2 focus-visible:outline-[#FF5500]"
                        >
                          {rec.memberName}
                        </button>
                      </p>
                      <p className="font-mono text-[13px] text-zinc-500">
                        {rec.memberCode}
                      </p>
                    </td>
                    <td className="py-3.5 text-zinc-300">{rec.planName}</td>
                    <td className="py-3.5">
                      <span className="rounded bg-white/[0.06] px-2.5 py-0.5 text-[13px] text-zinc-300">
                        {rec.methodLabel}
                      </span>
                    </td>
                    <td className="py-3.5 font-semibold tabular-nums text-[#FF5500]">
                      {rec.amount}
                    </td>
                    <td className="py-3.5">
                      <PaymentStatusBadge
                        status={
                          rec.status === 'Paid'
                            ? PaymentStatus.PAID
                            : rec.status === 'Refunded'
                              ? PaymentStatus.REFUNDED
                              : PaymentStatus.PENDING
                        }
                      />
                    </td>
                    <td className="py-3.5 tabular-nums text-zinc-400">
                      {rec.createdAt}
                    </td>
                    <td className="py-3.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {rec.status === 'Pending' && !rec.isLegacyPt && (
                          <button
                            type="button"
                            onClick={() => void handleConfirmPaid(rec)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 text-[13px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
                          >
                            <Check className="h-3 w-3" />
                            Xác nhận thu
                          </button>
                        )}
                        {isAdmin && rec.status === 'Paid' && (
                          <button
                            type="button"
                            onClick={() => setRefundTarget(rec)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 text-[13px] font-semibold text-amber-400 hover:bg-amber-500/20"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Hoàn tiền
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleOpenReceiptModal(rec)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 hover:border-white/20 hover:text-white"
                        >
                          <Eye className="h-3 w-3" />
                          Biên lai
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          totalItems={receiptTotal}
          pageSize={PAGE_SIZE}
          currentPage={safePage}
          onPageChange={setCurrentPage}
          itemLabel="biên lai"
        />
      </div>

      {/* Modal 1: New Subscription Receipt */}
      {posModalOpen && (
        <ModalFrame
          onClose={() => setPosModalOpen(false)}
          labelledBy="app-dashboard-staff-pos-page-heading-0"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <h2
                  className="text-base font-bold text-white"
                  id="app-dashboard-staff-pos-page-heading-0"
                >
                  Bán gói tập &amp; Xuất biên lai
                </h2>
                <p className="text-[13px] text-zinc-400">
                  Đăng ký gói mới hoặc gia hạn nối tiếp trực tiếp tại quầy
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPosModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
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

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Hội viên
                </label>
                <input
                  type="text"
                  value={posMemberSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setPosMemberSearch(q);
                    setPosMemberId('');
                    setMemberOptions([]);
                    setMemberSearchLoading(true);
                  }}
                  placeholder="Tìm nhanh theo tên hoặc mã MEM-XXXXXXXX..."
                  className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
                />
                {memberSearchLoading && (
                  <p role="status" className="mt-1 text-xs text-zinc-400">
                    Đang tìm hội viên…
                  </p>
                )}
                {memberSearchError && (
                  <p role="alert" className="mt-1 text-xs text-amber-300">
                    {memberSearchError}{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setMemberSearchRetry((value) => value + 1)}
                    >
                      Thử lại
                    </button>
                  </p>
                )}

                <select
                  value={posMemberId}
                  onChange={(e) => setPosMemberId(e.target.value)}
                  aria-label="Hội viên"
                  className="mt-1.5 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                >
                  {memberOptions
                    .filter((m) => {
                      const q = posMemberSearch.toLowerCase().trim();
                      if (!q) return true;
                      return (
                        m.name.toLowerCase().includes(q) ||
                        m.code.toLowerCase().includes(q)
                      );
                    })
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.code})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Gói tập đăng ký
                </label>
                <select
                  value={posPlanId}
                  onChange={(e) => setPosPlanId(e.target.value)}
                  aria-label="Gói tập đăng ký"
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                >
                  {planOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatVnd(p.price)}
                    </option>
                  ))}
                </select>
              </div>

              {feedbackMsg && (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                >
                  {feedbackMsg}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Chế độ kích hoạt gói
                  </label>
                  <select
                    value={posActivationMode}
                    onChange={(e) =>
                      setPosActivationMode(
                        e.target.value as 'TODAY' | 'SCHEDULED',
                      )
                    }
                    aria-label="Chế độ kích hoạt gói"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                  >
                    <option value="TODAY">Tập ngay hôm nay</option>
                    <option value="SCHEDULED">Hẹn ngày bắt đầu</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Hình thức thanh toán
                  </label>
                  <select
                    value={posMethod}
                    onChange={(e) =>
                      setPosMethod(e.target.value as 'CASH' | 'TRANSFER')
                    }
                    aria-label="Hình thức thanh toán"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                  >
                    <option value="TRANSFER">Chuyển khoản ngân hàng</option>
                    <option value="CASH">Tiền mặt tại quầy</option>
                  </select>
                </div>
              </div>

              {posActivationMode === 'SCHEDULED' && (
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Ngày bắt đầu gói tập
                  </label>
                  <input
                    type="date"
                    value={posStartDate}
                    onChange={(e) => setPosStartDate(e.target.value)}
                    aria-label="Ngày bắt đầu gói tập"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Ghi chú thu ngân
                </label>
                <input
                  type="text"
                  value={posNote}
                  onChange={(e) => setPosNote(e.target.value)}
                  placeholder="Ghi chú biên lai (không bắt buộc)..."
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              {(() => {
                const selPlan = rawActivePlans.find((p) => p.id === posPlanId);
                if (!selPlan) return null;
                const startIso =
                  posActivationMode === 'SCHEDULED' && posStartDate
                    ? posStartDate
                    : staffDate();
                const startObj = new Date(`${startIso}T00:00:00+07:00`);
                const endObj = new Date(
                  startObj.getTime() + selPlan.durationDays * 86400000,
                );
                const startStr = startObj.toLocaleDateString('vi-VN');
                const endStr = endObj.toLocaleDateString('vi-VN');

                return (
                  <div className="rounded-xl border border-white/[0.08] bg-[#18181C] p-3.5 text-[13px]">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>
                        Thời hạn dự kiến (
                        {formatDurationVi(selPlan.durationDays)})
                      </span>
                      <span className="font-mono text-[13px] tabular-nums text-zinc-200">
                        {startStr} – {endStr}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                      <span className="font-semibold text-zinc-200">
                        Tổng tiền thu tại quầy
                      </span>
                      <span className="font-display text-lg font-bold tabular-nums text-[#FF5500]">
                        {formatVnd(selPlan.price)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPosModalOpen(false)}
                className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={
                  posSubmitting ||
                  !posMemberId ||
                  !posPlanId ||
                  catalogLoading ||
                  Boolean(catalogError) ||
                  memberSearchLoading ||
                  Boolean(memberSearchError)
                }
                onClick={() => void handleCreatePosSubscription()}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {posSubmitting
                  ? 'Đang xuất biên lai...'
                  : 'Xác nhận & Xuất biên lai'}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* Modal 2: Digital Receipt Snapshot */}
      {viewingReceipt && (
        <ModalFrame
          onClose={() => setViewingReceipt(null)}
          labelledBy="app-dashboard-staff-pos-page-heading-3"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <span className="font-mono text-[13px] font-bold text-[#FF5500]">
                  {viewingReceipt.receiptNumber}
                </span>
                <h2
                  className="text-base font-bold text-white"
                  id="app-dashboard-staff-pos-page-heading-3"
                >
                  Biên lai thu tiền chính thức
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-white/[0.06] bg-[#18181C] p-4 text-[13px]">
              <div className="flex justify-between">
                <span className="text-zinc-400">Hội viên</span>
                <span className="font-semibold text-white">
                  {viewingReceipt.member.fullName} (
                  <span className="font-mono">
                    {viewingReceipt.member.memberCode}
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Gói tập đăng ký</span>
                <span className="font-semibold text-white">
                  {viewingReceipt.ptPurchase?.packageName ??
                    viewingReceipt.subscription.planName}
                </span>
              </div>
              {viewingReceipt.ptPurchase && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Buổi PT</span>
                  <span className="text-zinc-200">
                    {viewingReceipt.ptPurchase.sessionCount} buổi ·{' '}
                    {viewingReceipt.ptPurchase.sessionMinutes} phút/buổi
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-400">Thời điểm thu</span>
                <span className="text-zinc-200">
                  {new Date(viewingReceipt.confirmedAt).toLocaleString(
                    'vi-VN',
                    { timeZone: 'Asia/Ho_Chi_Minh' },
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Hình thức thanh toán</span>
                <span className="text-zinc-200">
                  {mapMethodLabel(viewingReceipt.method)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Thu ngân xác nhận</span>
                <span className="text-zinc-200">
                  {viewingReceipt.cashier.fullName}
                </span>
              </div>
              <div className="flex justify-between border-t border-white/[0.06] pt-2.5">
                <span className="font-semibold text-zinc-300">
                  Tổng thanh toán
                </span>
                <span className="font-display text-base font-bold tabular-nums text-[#FF5500]">
                  {formatVnd(viewingReceipt.amount)}
                </span>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-200 hover:border-white/20"
              >
                <Printer className="h-3.5 w-3.5 text-[#FF5500]" />
                In Bill / Biên lai
              </button>
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white"
              >
                Đóng
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* Modal 3: Confirm Refund (Admin Only) */}
      {refundTarget && (
        <ModalFrame
          onClose={() => setRefundTarget(null)}
          labelledBy="app-dashboard-staff-pos-page-heading-6"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <span className="font-mono text-[13px] font-bold text-amber-400">
                  {refundTarget.receiptNo}
                </span>
                <h2
                  className="text-base font-bold text-white"
                  id="app-dashboard-staff-pos-page-heading-6"
                >
                  Xác nhận hoàn tiền biên lai
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-[13px] text-zinc-400">
              Hoàn trả số tiền{' '}
              <strong className="text-amber-400">{refundTarget.amount}</strong>{' '}
              cho hội viên{' '}
              <strong className="text-white">{refundTarget.memberName}</strong>{' '}
              ({refundTarget.memberCode}).
            </p>

            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-medium text-zinc-400">
                Lý do hoàn tiền bắt buộc
              </label>
              <textarea
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                aria-label="Lý do hoàn tiền"
                className="w-full rounded-xl border border-white/[0.08] bg-[#18181C] p-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={refundSubmitting || !refundReason.trim()}
                onClick={() => void handleConfirmRefund()}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                Xác nhận hoàn tiền
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {quickViewMemberId && (
        <MemberQuickView
          key={quickViewMemberId}
          memberId={quickViewMemberId}
          onClose={() => setQuickViewMemberId(null)}
        />
      )}

      <MemberOnboardingModal
        isOpen={onboardingModalOpen}
        onClose={() => setOnboardingModalOpen(false)}
        availablePlans={rawActivePlans}
        plansLoading={catalogLoading}
        plansError={catalogError}
        onRetryPlans={() => setCatalogRetry((value) => value + 1)}
        onSuccess={(_result, summaryMessage) => {
          setFeedbackMsg(summaryMessage);
          void loadPosData();
        }}
        onIncompleteMemberDismissed={() => {
          void loadPosData();
        }}
      />
    </div>
  );
}
