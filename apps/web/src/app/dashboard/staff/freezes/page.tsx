'use client';

import { staffDate } from '@/lib/staff-date';

import { formatDurationVi } from '@/lib/formatters';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Search,
  ChevronDown,
  Snowflake,
  RotateCcw,
  Check,
  X,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import {
  FreezeStatus,
  SubscriptionStatus,
  type PaginatedFreezesResponse,
  type PaginatedSubscriptionsResponse,
  type SubscriptionDetail,
  type SubscriptionFreezeDetail,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { apiClient, ApiClientError } from '@/services/api-client';
import { TablePagination } from '@/components/shared/table-pagination';

const PAGE_SIZE = 10;

interface FreezeRequestRecord {
  id: string;
  memberCode: string;
  memberName: string;
  plan: string;
  durationDays: number;
  dateRange: string;
  reason: string;
  status:
    | 'Pending Review'
    | 'Currently Frozen'
    | 'Restored Early'
    | 'Scheduled'
    | 'Rejected';
}

interface ActiveSubOption {
  subscriptionId: string;
  memberName: string;
  memberCode: string;
  planName: string;
  freezesUsed: number;
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

export default function StaffFreezesPage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    | 'ALL'
    | 'Pending Review'
    | 'Currently Frozen'
    | 'Restored Early'
    | 'Scheduled'
    | 'Rejected'
  >('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [freezeTotal, setFreezeTotal] = useState(0);
  const [freezeStats, setFreezeStats] = useState({
    pending: 0,
    frozen: 0,
    restored: 0,
  });
  const freezeLoadSeq = useRef(0);

  const [freezeRequests, setFreezeRequests] = useState<
    ReadonlyArray<FreezeRequestRecord>
  >([]);
  const [activeSubOptions, setActiveSubOptions] = useState<
    ReadonlyArray<ActiveSubOption>
  >([]);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  // Create Freeze Modal
  const [createFreezeOpen, setCreateFreezeOpen] = useState(false);
  const [freezeMemberSearch, setFreezeMemberSearch] = useState('');
  const [selectedSubId, setSelectedSubId] = useState('');
  const [freezeStart, setFreezeStart] = useState(() => staffDate());
  const [freezeDays, setFreezeDays] = useState(14);
  const [freezeReason, setFreezeReason] = useState(
    'Đi công tác xa / Nghỉ dưỡng phục hồi sức khỏe',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('action') !== 'create' || !query.get('subscriptionId'))
      return;
    const timer = window.setTimeout(() => {
      setFreezeMemberSearch(query.get('memberCode') ?? '');
      setSelectedSubId(query.get('subscriptionId') ?? '');
      setCreateFreezeOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadFreezes = useCallback(async () => {
    const loadSeq = ++freezeLoadSeq.current;
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [subsRes, freezesRes, statsRes] = await Promise.allSettled([
        apiClient.get<PaginatedSubscriptionsResponse>(
          `/subscriptions?limit=100&status=ACTIVE&paymentStatus=PAID&search=${encodeURIComponent(freezeMemberSearch)}`,
        ),
        apiClient.get<PaginatedFreezesResponse>(
          `/freezes?limit=${PAGE_SIZE}&page=${currentPage}&search=${encodeURIComponent(searchQuery)}${statusFilter === 'ALL' ? '' : `&phase=${encodeURIComponent(statusFilter)}`}`,
        ),
        apiClient.get<{ pending: number; frozen: number; restored: number }>(
          '/freezes/statistics',
        ),
      ]);
      if (loadSeq !== freezeLoadSeq.current) return;
      assertDataLoaded([statsRes], false);
      if (statsRes.status === 'fulfilled') setFreezeStats(statsRes.value);
      if (freezesRes.status === 'fulfilled')
        setFreezeTotal(freezesRes.value.meta.total);
      if (freezesRes.status === 'fulfilled')
        setCurrentPage((previous) =>
          Math.min(previous, Math.max(1, freezesRes.value.meta.totalPages)),
        );
      assertDataLoaded([freezesRes], false);
      assertDataLoaded([subsRes], false);

      const rawSubs: SubscriptionDetail[] =
        subsRes.status === 'fulfilled' ? subsRes.value.data : [];
      const rawFreezes: SubscriptionFreezeDetail[] =
        freezesRes.status === 'fulfilled' ? freezesRes.value.data : [];

      const freezeCountBySub = new Map<string, number>();
      for (const frz of rawFreezes) {
        if (
          frz.status === FreezeStatus.APPROVED ||
          frz.status === FreezeStatus.COMPLETED
        ) {
          freezeCountBySub.set(
            frz.subscriptionId,
            (freezeCountBySub.get(frz.subscriptionId) || 0) + 1,
          );
        }
      }

      const activeSubs = rawSubs
        .filter((s) => s.effectiveStatus === SubscriptionStatus.ACTIVE)
        .map((s) => ({
          subscriptionId: s.id,
          memberName: s.member.fullName,
          memberCode: s.member.memberCode,
          planName: `${s.plan.name} (${formatDurationVi(s.plan.durationDays)})`,
          freezesUsed: s.freezeCount ?? freezeCountBySub.get(s.id) ?? 0,
        }));

      setActiveSubOptions(activeSubs);
      const firstEligible =
        activeSubs.find((s) => s.freezesUsed < 2) ?? activeSubs[0];
      setSelectedSubId((previous) =>
        activeSubs.some((sub) => sub.subscriptionId === previous)
          ? previous
          : (firstEligible?.subscriptionId ?? ''),
      );

      if (freezesRes.status === 'fulfilled') {
        setFreezeRequests(
          rawFreezes.map((frz) => ({
            id: frz.id,
            memberCode: frz.subscription?.memberCode || 'MEM-00000000',
            memberName: frz.subscription?.memberName || 'Hội viên',
            plan: frz.subscription?.planName || 'Gói hội viên',
            durationDays: frz.freezeDays,
            dateRange: `${formatShortDate(frz.startsAt)} – ${formatShortDate(frz.endsAt)}`,
            reason: frz.reason || 'Yêu cầu bảo lưu gói tập',
            status:
              frz.status === FreezeStatus.REQUESTED
                ? 'Pending Review'
                : frz.status === FreezeStatus.REJECTED
                  ? 'Rejected'
                  : frz.restoredAt || frz.status === FreezeStatus.COMPLETED
                    ? 'Restored Early'
                    : new Date(frz.startsAt).getTime() > Date.now()
                      ? 'Scheduled'
                      : 'Currently Frozen',
          })),
        );
      }
      hasLoadedRef.current = true;
    } catch {
      if (loadSeq !== freezeLoadSeq.current) return;
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      if (loadSeq === freezeLoadSeq.current) setLoading(false);
    }
  }, [currentPage, searchQuery, statusFilter, freezeMemberSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFreezes();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadFreezes]);

  const handleCreateFreeze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubId) return;
    const clampedDays = Math.min(60, Math.max(7, freezeDays));
    const startObj = new Date(`${freezeStart}T00:00:00+07:00`);
    const endObj = new Date(
      startObj.getTime() + clampedDays * 24 * 60 * 60 * 1000,
    );
    const selOpt = activeSubOptions.find(
      (o) => o.subscriptionId === selectedSubId,
    );

    setIsSubmitting(true);
    try {
      await apiClient.post(`/subscriptions/${selectedSubId}/freezes`, {
        startsAt: startObj.toISOString(),
        endsAt: endObj.toISOString(),
        reason: freezeReason.trim(),
        autoApprove: true,
      });
      setFeedbackBanner(
        `Đã bảo lưu gói tập của ${selOpt?.memberName ?? 'hội viên'} (${clampedDays} ngày). Thời gian bảo lưu có hiệu lực theo ngày đã chọn.`,
      );
      setCreateFreezeOpen(false);
      await loadFreezes();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể tạo phiếu bảo lưu cho gói tập này.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnfreeze = async (freezeId: string, memberName: string) => {
    try {
      await apiClient.post(`/freezes/${freezeId}/unfreeze`);
      setFeedbackBanner(
        `Đã mở lại gói tập cho ${memberName} và cộng bù số ngày đã bảo lưu vào hạn sử dụng.`,
      );
      await loadFreezes();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể mở lại gói tập cho ${memberName}.`,
      );
    }
  };

  const handleApproveFreeze = async (freezeId: string, memberName: string) => {
    try {
      await apiClient.post(`/freezes/${freezeId}/approve`);
      setFeedbackBanner(`Đã duyệt yêu cầu bảo lưu của hội viên ${memberName}.`);
      await loadFreezes();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể duyệt bảo lưu cho ${memberName}.`,
      );
    }
  };

  const handleRejectFreeze = async (freezeId: string, memberName: string) => {
    try {
      await apiClient.post(`/freezes/${freezeId}/reject`, {
        reason: 'Từ chối yêu cầu bảo lưu sau khi kiểm tra tại quầy lễ tân',
      });
      setConfirmRejectId(null);
      setFeedbackBanner(`Đã từ chối yêu cầu bảo lưu của ${memberName}.`);
      await loadFreezes();
    } catch (err) {
      setConfirmRejectId(null);
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể từ chối yêu cầu bảo lưu của ${memberName}.`,
      );
    }
  };

  const pendingReviewCount = freezeStats.pending;
  const currentlyFrozenCount = freezeStats.frozen;
  const restoredCount = freezeStats.restored;
  const totalPages = Math.max(1, Math.ceil(freezeTotal / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedFreezes = freezeRequests;

  if (loading || loadError)
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              Bảo lưu Gói tập
            </h1>
          </div>
          <button
            type="button"
            onClick={() => {
              setFeedbackBanner(null);
              setCreateFreezeOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Tạo phiếu bảo lưu
          </button>
        </div>
        <DataState
          loading={loading}
          error={loadError}
          variant="table"
          onRetry={() => void loadFreezes()}
        />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header & Single Primary CTA */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Bảo lưu Gói tập
          </h1>
        </div>

        <button
          type="button"
          onClick={() => {
            setFeedbackBanner(null);
            setCreateFreezeOpen(true);
          }}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Tạo phiếu bảo lưu
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

      {/* Row 1: 3 Dedicated Freeze KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-400">
              Đơn chờ xét duyệt
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-display text-2xl font-bold tabular-nums text-white">
            {pendingReviewCount}
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">
            Yêu cầu bảo lưu từ hội viên cần xử lý
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-400">
              Gói đang bảo lưu
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF5500]/15 text-[#FF5500]">
              <Snowflake className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-display text-2xl font-bold tabular-nums text-[#FF5500]">
            {currentlyFrozenCount}
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">
            Đang tạm khóa cổng Check-in (7–60 ngày)
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-400">
              Đã mở lại &amp; Cộng bù hạn
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-display text-2xl font-bold tabular-nums text-white">
            {restoredCount}
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">
            Tự động cộng bù số ngày nghỉ vào hạn gói
          </p>
        </div>
      </div>

      {/* Main Card for Subscription Freezes (7-60 Days) */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="relative flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm theo họ tên, mã MEM-XXXXXXXX, gói tập hoặc lý do bảo lưu..."
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] pl-10 pr-4 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 tabular-nums">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(
                    e.target.value as
                      | 'ALL'
                      | 'Pending Review'
                      | 'Currently Frozen'
                      | 'Restored Early',
                  );
                  setCurrentPage(1);
                }}
                aria-label="Lọc trạng thái bảo lưu"
                className="h-10 appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-4 pr-9 text-[13px] text-zinc-200 focus:border-[#FF5500] focus:outline-none"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="Pending Review">Chờ duyệt</option>
                <option value="Currently Frozen">Đang bảo lưu</option>
                <option value="Scheduled">Đã duyệt, chờ bắt đầu</option>
                <option value="Rejected">Đã từ chối</option>
                <option value="Restored Early">Đã mở lại</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-3.5">Hội viên</th>
                <th className="pb-3.5">Gói tập</th>
                <th className="pb-3.5">Thời gian bảo lưu</th>
                <th className="pb-3.5">Số ngày</th>
                <th className="pb-3.5">Lý do</th>
                <th className="pb-3.5">Trạng thái</th>
                <th className="pb-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {paginatedFreezes.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-[13px] text-zinc-500"
                  >
                    Không tìm thấy yêu cầu bảo lưu nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedFreezes.map((frz) => (
                  <tr
                    key={frz.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5">
                      <p className="font-semibold text-white">
                        {frz.memberName}
                      </p>
                      <p className="font-mono text-[13px] text-zinc-500">
                        {frz.memberCode}
                      </p>
                    </td>
                    <td className="py-3.5 text-zinc-300">{frz.plan}</td>
                    <td className="py-3.5 tabular-nums text-zinc-300">
                      {frz.dateRange}
                    </td>
                    <td className="py-3.5 font-semibold tabular-nums text-white">
                      {frz.durationDays} ngày
                    </td>
                    <td className="py-3.5 text-zinc-400">{frz.reason}</td>
                    <td className="py-3.5">
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-0.5 text-[13px] font-medium',
                          frz.status === 'Pending Review'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                            : frz.status === 'Restored Early'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-[#FF5500]/40 bg-[#FF5500]/10 text-[#FF5500]',
                        )}
                      >
                        {frz.status === 'Pending Review'
                          ? 'Chờ duyệt'
                          : frz.status === 'Restored Early'
                            ? 'Đã mở lại'
                            : frz.status === 'Rejected'
                              ? 'Đã từ chối'
                              : frz.status === 'Scheduled'
                                ? 'Chờ bắt đầu'
                                : 'Đang bảo lưu'}
                      </span>
                    </td>
                    <td className="py-3.5 text-right">
                      {frz.status === 'Pending Review' ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void handleApproveFreeze(frz.id, frz.memberName)
                            }
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 text-[13px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
                          >
                            <Check className="h-3 w-3" />
                            Duyệt
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirmRejectId === frz.id) {
                                void handleRejectFreeze(frz.id, frz.memberName);
                              } else {
                                setConfirmRejectId(frz.id);
                                window.setTimeout(() => {
                                  setConfirmRejectId((prev) =>
                                    prev === frz.id ? null : prev,
                                  );
                                }, 3000);
                              }
                            }}
                            aria-label="Từ chối bảo lưu"
                            className={cn(
                              'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-semibold transition-colors',
                              confirmRejectId === frz.id
                                ? 'border-red-500 bg-red-500 text-white'
                                : 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20',
                            )}
                          >
                            <X className="h-3 w-3" />
                            {confirmRejectId === frz.id
                              ? 'Xác nhận?'
                              : 'Từ chối'}
                          </button>
                        </div>
                      ) : frz.status === 'Currently Frozen' ||
                        frz.status === 'Scheduled' ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handleUnfreeze(frz.id, frz.memberName)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 py-1 text-[13px] font-medium text-zinc-300 hover:border-white/20"
                        >
                          <RotateCcw className="h-3 w-3 text-[#FF5500]" />
                          Mở lại &amp; Cộng bù hạn
                        </button>
                      ) : (
                        <span className="text-[13px] text-zinc-500">
                          {frz.status === 'Rejected'
                            ? 'Đã từ chối'
                            : 'Đã mở lại'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          totalItems={freezeTotal}
          pageSize={PAGE_SIZE}
          currentPage={safePage}
          onPageChange={setCurrentPage}
          itemLabel="phiếu bảo lưu"
        />
      </div>

      {/* Modal: Create Freeze Plan (7–60 Days) */}
      {createFreezeOpen && (
        <ModalFrame
          onClose={() => setCreateFreezeOpen(false)}
          labelledBy="app-dashboard-staff-freezes-page-heading-0"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3
                className="text-base font-bold text-white"
                id="app-dashboard-staff-freezes-page-heading-0"
              >
                Tạo phiếu bảo lưu gói tập (7–60 ngày)
              </h3>
              <button
                type="button"
                onClick={() => setCreateFreezeOpen(false)}
                className="text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[13px] text-zinc-400">
              Chọn hội viên đang hoạt động để tạm khóa cổng và bảo lưu thời hạn
              gói
            </p>
            <form onSubmit={handleCreateFreeze} className="mt-4 space-y-3.5">
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
                  Hội viên &amp; Gói đang tập
                </label>
                <input
                  type="text"
                  value={freezeMemberSearch}
                  onChange={(e) => {
                    const q = e.target.value;
                    setFreezeMemberSearch(q);
                    const qLower = q.toLowerCase().trim();
                    const matched = activeSubOptions.find(
                      (opt) =>
                        opt.freezesUsed < 2 &&
                        (opt.memberName.toLowerCase().includes(qLower) ||
                          opt.memberCode.toLowerCase().includes(qLower)),
                    );
                    if (matched) {
                      setSelectedSubId(matched.subscriptionId);
                    }
                  }}
                  placeholder="Tìm nhanh theo tên hoặc mã MEM-XXXXXXXX..."
                  className="mb-1.5 h-8 w-full rounded-lg border border-white/10 bg-[#18181C] px-3 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
                />
                <select
                  value={selectedSubId}
                  onChange={(e) => setSelectedSubId(e.target.value)}
                  aria-label="Chọn hội viên và gói đang tập"
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                >
                  {activeSubOptions
                    .filter((opt) => {
                      const q = freezeMemberSearch.toLowerCase().trim();
                      if (!q) return true;
                      return (
                        opt.memberName.toLowerCase().includes(q) ||
                        opt.memberCode.toLowerCase().includes(q)
                      );
                    })
                    .map((opt) => (
                      <option
                        key={opt.subscriptionId}
                        value={opt.subscriptionId}
                        disabled={opt.freezesUsed >= 2}
                      >
                        {opt.memberName} ({opt.memberCode}) — {opt.planName}{' '}
                        {opt.freezesUsed >= 2
                          ? '[Đã hết lượt 2/2]'
                          : `[Đã bảo lưu ${opt.freezesUsed}/2 lần]`}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                    Ngày bắt đầu nghỉ
                  </label>
                  <input
                    type="date"
                    required
                    value={freezeStart}
                    onChange={(e) => setFreezeStart(e.target.value)}
                    aria-label="Ngày bắt đầu nghỉ"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                    Số ngày (7–60 ngày)
                  </label>
                  <input
                    type="number"
                    min={7}
                    max={60}
                    required
                    value={freezeDays}
                    onChange={(e) => setFreezeDays(Number(e.target.value))}
                    aria-label="Số ngày bảo lưu"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                  Lý do bảo lưu
                </label>
                <input
                  type="text"
                  required
                  value={freezeReason}
                  onChange={(e) => setFreezeReason(e.target.value)}
                  aria-label="Lý do bảo lưu"
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              {(() => {
                const clamped = Math.min(60, Math.max(7, freezeDays || 7));
                const sObj = new Date(`${freezeStart}T00:00:00`);
                const eObj = new Date(sObj.getTime() + clamped * 86400000);
                const selOpt = activeSubOptions.find(
                  (o) => o.subscriptionId === selectedSubId,
                );
                return (
                  <div className="rounded-xl border border-white/[0.08] bg-[#18181C] p-3 text-[13px]">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Kỳ hạn tạm khóa cổng</span>
                      <span className="font-mono text-[13px] tabular-nums text-zinc-200">
                        {sObj.toLocaleDateString('vi-VN')} –{' '}
                        {eObj.toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2">
                      <span className="text-zinc-400">
                        Cộng bù hạn gói khi mở lại
                      </span>
                      <span className="font-semibold tabular-nums text-[#FF5500]">
                        +{clamped} ngày
                        {selOpt ? ` • Lần ${selOpt.freezesUsed + 1}/2` : ''}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateFreezeOpen(false)}
                  className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    !selectedSubId ||
                    (activeSubOptions.find(
                      (o) => o.subscriptionId === selectedSubId,
                    )?.freezesUsed ?? 0) >= 2
                  }
                  className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
                >
                  Xác nhận bảo lưu
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
