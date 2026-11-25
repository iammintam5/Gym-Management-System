'use client';

import { TablePagination } from '@/components/shared/table-pagination';

import {
  FreezeStatusBadge,
  PaymentStatusBadge,
} from '@/components/shared/domain-status-badge';

import { formatVnd, formatDurationVi } from '@/lib/formatters';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useState, useEffect, useCallback } from 'react';
import { Snowflake, Receipt, Plus, Eye, X, Printer } from 'lucide-react';
import {
  FreezeStatus,
  PaymentStatus,
  type PaymentReceipt,
  type PaginatedPaymentsResponse,
  type SubscriptionDetail,
  type SubscriptionFreezeDetail,
} from '@gym/contracts';
import { formatReceiptNumber } from '@/lib/utils';
import { apiClient, ApiClientError } from '@/services/api-client';

interface MemberFreezeRow {
  id: string;
  planName: string;
  window: string;
  durationDays: number;
  reason: string;
  status: FreezeStatus;
}

interface MemberReceiptRow {
  paymentId: string;
  receiptNo: string;
  planName: string;
  method: 'Chuyển khoản' | 'Thẻ' | 'Tiền mặt';
  amount: string;
  date: string;
  status: 'Paid' | 'Pending' | 'Refunded';
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

function mapMethodLabel(
  raw?: string | null,
): 'Chuyển khoản' | 'Thẻ' | 'Tiền mặt' {
  if (raw === 'CARD') return 'Thẻ';
  if (raw === 'CASH') return 'Tiền mặt';
  return 'Chuyển khoản';
}

export default function MemberBillingAndFreezePage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentSubId, setCurrentSubId] = useState<string | null>(null);
  const [currentPlanName, setCurrentPlanName] = useState('—');
  const [freezesUsedCount, setFreezesUsedCount] = useState(0);

  const [freezeHistory, setFreezeHistory] = useState<
    ReadonlyArray<MemberFreezeRow>
  >([]);
  const [receipts, setReceipts] = useState<ReadonlyArray<MemberReceiptRow>>([]);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptLoadError, setReceiptLoadError] = useState('');
  const [receiptReload, setReceiptReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setReceiptsLoading(true);
      setReceiptLoadError('');
      void apiClient<PaginatedPaymentsResponse>(
        '/payments/me?limit=10&page=' + receiptPage,
        { signal: controller.signal, skipCache: true },
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setReceiptTotal(result.meta.total);
          setReceipts(
            result.data.map((payment) => ({
              paymentId: payment.id,
              receiptNo: formatReceiptNumber(
                payment.id,
                payment.confirmedAt ?? payment.createdAt,
              ),
              planName:
                payment.ptPurchase?.packageName ??
                payment.subscription?.planName ??
                'Gói tập',
              method: mapMethodLabel(payment.method),
              amount: formatVnd(payment.amount),
              date: formatShortDate(payment.confirmedAt ?? payment.createdAt),
              status:
                payment.status === PaymentStatus.PAID
                  ? 'Paid'
                  : payment.status === PaymentStatus.REFUNDED
                    ? 'Refunded'
                    : 'Pending',
            })),
          );
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setReceiptLoadError(
              cause instanceof Error
                ? cause.message
                : 'Không thể tải biên lai.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setReceiptsLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [receiptPage, receiptReload]);

  // Request Freeze Modal
  const [isFreezeModalOpen, setIsFreezeModalOpen] = useState(false);
  const [freezeStart, setFreezeStart] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [freezeDays, setFreezeDays] = useState(14);
  const [freezeReason, setFreezeReason] = useState(
    'Đi công tác xa / Nghỉ dưỡng phục hồi sức khỏe',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Receipt Preview Modal
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentReceipt | null>(
    null,
  );

  const loadBillingAndFreezes = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [currentSubRes, historyRes] = await Promise.allSettled([
        apiClient.get<SubscriptionDetail>('/subscriptions/me/current'),
        apiClient.get<SubscriptionDetail[]>('/subscriptions/me'),
      ]);
      assertDataLoaded([historyRes], false);
      assertDataLoaded([currentSubRes], true);

      const currentSub =
        currentSubRes.status === 'fulfilled' ? currentSubRes.value : null;
      const allSubs =
        historyRes.status === 'fulfilled'
          ? historyRes.value
          : currentSub
            ? [currentSub]
            : [];

      setCurrentSubId(null);
      setCurrentPlanName('Chưa có gói tập');
      setFreezeHistory([]);
      setFreezesUsedCount(0);
      if (currentSub) {
        setCurrentSubId(currentSub.id);
        setCurrentPlanName(
          `${currentSub.plan.name} (${formatDurationVi(currentSub.plan.durationDays)})`,
        );
      } else if (allSubs[0]) {
        setCurrentSubId(allSubs[0].id);
        setCurrentPlanName(
          `${allSubs[0].plan.name} (${formatDurationVi(allSubs[0].plan.durationDays)})`,
        );
      }

      if (allSubs.length > 0) {
        const freezeListsRes = await Promise.allSettled(
          allSubs.map((sub) =>
            apiClient.get<SubscriptionFreezeDetail[]>(
              `/subscriptions/${sub.id}/freezes`,
            ),
          ),
        );
        assertDataLoaded(freezeListsRes);

        const mappedFreezes: MemberFreezeRow[] = [];
        let currentUsed = 0;

        freezeListsRes.forEach((res, idx) => {
          const parentSub = allSubs[idx];
          if (res.status === 'fulfilled' && parentSub) {
            for (const frz of res.value) {
              if (
                parentSub.id === (currentSub?.id || allSubs[0]?.id) &&
                (frz.status === FreezeStatus.APPROVED ||
                  frz.status === FreezeStatus.COMPLETED)
              ) {
                currentUsed += 1;
              }

              mappedFreezes.push({
                id: frz.id,
                planName: `${parentSub.plan.name} (${formatDurationVi(parentSub.plan.durationDays)})`,
                window: `${formatShortDate(frz.startsAt)} – ${formatShortDate(frz.endsAt)}`,
                durationDays: frz.freezeDays,
                reason: frz.reason || 'Yêu cầu bảo lưu gói tập cá nhân',
                status:
                  frz.restoredAt && frz.status === FreezeStatus.APPROVED
                    ? FreezeStatus.COMPLETED
                    : frz.status,
              });
            }
          }
        });

        setFreezesUsedCount(Math.min(2, currentUsed));
        setFreezeHistory(mappedFreezes);
      }
    } catch {
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBillingAndFreezes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBillingAndFreezes]);

  const handleRequestFreeze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSubId) return;
    const clampedDays = Math.min(60, Math.max(7, freezeDays));
    const startObj = new Date(freezeStart);
    const endObj = new Date(
      startObj.getTime() + clampedDays * 24 * 60 * 60 * 1000,
    );
    setIsSubmitting(true);

    try {
      await apiClient.post(`/subscriptions/${currentSubId}/freezes`, {
        startsAt: startObj.toISOString(),
        endsAt: endObj.toISOString(),
        reason: freezeReason.trim(),
      });
      setFeedbackBanner(
        `Đã gửi yêu cầu bảo lưu ${clampedDays} ngày. Ngày hết hạn gói tập sẽ tự động được cộng bù khi mở lại.`,
      );
      setIsFreezeModalOpen(false);
      await loadBillingAndFreezes();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể gửi yêu cầu bảo lưu gói tập.',
      );
      setIsFreezeModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewReceipt = async (row: MemberReceiptRow) => {
    try {
      const receipt = await apiClient.get<PaymentReceipt>(
        `/payments/${row.paymentId}/receipt`,
      );
      setSelectedReceipt(receipt);
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Biên lai điện tử chỉ khả dụng cho các giao dịch đã xác nhận thanh toán.',
      );
    }
  };

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadBillingAndFreezes()}
      />
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Thanh toán &amp; Bảo lưu gói tập
          </h1>
        </div>

        <button
          type="button"
          disabled={!currentSubId || freezesUsedCount >= 2}
          onClick={() => setIsFreezeModalOpen(true)}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          {freezesUsedCount >= 2
            ? 'Đã hết lượt bảo lưu (2/2)'
            : 'Đăng ký bảo lưu (7–60 ngày)'}
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

      {/* Row 1: Subscription Freeze Policy & History */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Snowflake className="h-4 w-4 text-[#FF5500]" />
            <div>
              <h2 className="text-base font-semibold text-white">
                Lịch sử bảo lưu gói tập
              </h2>
              <p className="text-[13px] text-zinc-500">
                Mỗi gói tập được bảo lưu tối đa 2 lần (7 đến 60 ngày/lần). Khi
                mở lại, hạn sử dụng sẽ tự động cộng bù số ngày đã nghỉ.
              </p>
            </div>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[13px] font-semibold tabular-nums text-amber-400">
            Lượt bảo lưu đã dùng: {freezesUsedCount} / 2 lần
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-3.5">Gói tập</th>
                <th className="pb-3.5">Thời gian bảo lưu</th>
                <th className="pb-3.5">Số ngày</th>
                <th className="pb-3.5">Lý do</th>
                <th className="pb-3.5 text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {freezeHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-[13px] text-zinc-500"
                  >
                    Bạn chưa có yêu cầu bảo lưu gói tập nào.
                  </td>
                </tr>
              ) : (
                freezeHistory.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5 font-semibold text-white">
                      {item.planName}
                    </td>
                    <td className="py-3.5 tabular-nums text-zinc-300">
                      {item.window}
                    </td>
                    <td className="py-3.5 font-semibold tabular-nums text-white">
                      {item.durationDays} ngày
                    </td>
                    <td className="py-3.5 text-zinc-400">{item.reason}</td>
                    <td className="py-3.5 text-right">
                      <FreezeStatusBadge status={item.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 2: Payment Receipts Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <Receipt className="h-4 w-4 text-[#FF5500]" />
          <div>
            <h2 className="text-base font-semibold text-white">
              Biên lai thanh toán của tôi
            </h2>
            <p className="text-[13px] text-zinc-500">
              Danh sách hóa đơn và biên lai thu tiền chính thức cho các gói hội
              viên của bạn
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-3.5">Mã biên lai</th>
                <th className="pb-3.5">Gói đăng ký</th>
                <th className="pb-3.5">Hình thức</th>
                <th className="pb-3.5">Số tiền</th>
                <th className="pb-3.5">Ngày thu</th>
                <th className="pb-3.5">Trạng thái</th>
                <th className="pb-3.5 text-right">Biên lai</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {receiptsLoading || receiptLoadError || receipts.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-[13px] text-zinc-500"
                  >
                    {receiptsLoading
                      ? 'Đang tải biên lai…'
                      : receiptLoadError || 'Chưa có biên lai thanh toán nào.'}
                  </td>
                </tr>
              ) : (
                receipts.map((rec) => (
                  <tr
                    key={rec.receiptNo}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5 font-mono font-semibold text-white">
                      {rec.receiptNo}
                    </td>
                    <td className="py-3.5 text-zinc-200">{rec.planName}</td>
                    <td className="py-3.5">
                      <span className="rounded bg-white/[0.06] px-2.5 py-0.5 text-[13px] text-zinc-300">
                        {rec.method}
                      </span>
                    </td>
                    <td className="py-3.5 font-semibold tabular-nums text-[#FF5500]">
                      {rec.amount}
                    </td>
                    <td className="py-3.5 tabular-nums text-zinc-400">
                      {rec.date}
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
                    <td className="py-3.5 text-right">
                      <button
                        type="button"
                        disabled={rec.status !== 'Paid'}
                        onClick={() => void handleViewReceipt(rec)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 hover:border-white/20 hover:text-white"
                      >
                        <Eye className="h-3 w-3" />
                        Xem biên lai
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {receiptLoadError && (
        <p role="alert" className="text-sm text-amber-300">
          {receiptLoadError}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setReceiptReload((value) => value + 1)}
          >
            Thử lại
          </button>
        </p>
      )}
      <TablePagination
        currentPage={receiptPage}
        pageSize={10}
        totalItems={receiptTotal}
        onPageChange={setReceiptPage}
        itemLabel="biên lai"
      />

      {/* Modal 1: Request Plan Freeze (7–60 Days) */}
      {isFreezeModalOpen && (
        <ModalFrame
          onClose={() => setIsFreezeModalOpen(false)}
          labelledBy="app-dashboard-member-billing-page-heading-0"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3
                className="text-base font-bold text-white"
                id="app-dashboard-member-billing-page-heading-0"
              >
                Đăng ký bảo lưu gói tập (7–60 ngày)
              </h3>
              <button
                type="button"
                onClick={() => setIsFreezeModalOpen(false)}
                className="text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[13px] tabular-nums text-zinc-400">
              {currentPlanName} • Đã bảo lưu: {freezesUsedCount} / 2 lần
            </p>

            <form onSubmit={handleRequestFreeze} className="mt-4 space-y-3.5">
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
                  Lý do xin bảo lưu
                </label>
                <input
                  type="text"
                  required
                  value={freezeReason}
                  onChange={(e) => setFreezeReason(e.target.value)}
                  aria-label="Lý do xin bảo lưu"
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFreezeModalOpen(false)}
                  className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || freezesUsedCount >= 2}
                  className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu bảo lưu'}
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}

      {/* Modal 2: Official Digital Payment Receipt */}
      {selectedReceipt && (
        <ModalFrame
          onClose={() => setSelectedReceipt(null)}
          labelledBy="app-dashboard-member-billing-page-heading-3"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wider text-[#FF5500]">
                  Biên lai thu tiền Aura Gym
                </p>
                <h3
                  className="mt-0.5 font-mono text-base font-bold text-white"
                  id="app-dashboard-member-billing-page-heading-3"
                >
                  {selectedReceipt.receiptNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-zinc-400">Hội viên</span>
                <span className="font-semibold text-white">
                  {selectedReceipt.member.fullName} (
                  <span className="font-mono">
                    {selectedReceipt.member.memberCode}
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Gói tập đăng ký</span>
                <span className="font-semibold text-zinc-200">
                  {selectedReceipt.ptPurchase?.packageName ??
                    selectedReceipt.subscription.planName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">
                  {selectedReceipt.ptPurchase ? 'Buổi PT' : 'Thời hạn hiệu lực'}
                </span>
                <span className="tabular-nums text-zinc-300">
                  {selectedReceipt.ptPurchase
                    ? selectedReceipt.ptPurchase.sessionCount +
                      ' buổi · ' +
                      selectedReceipt.ptPurchase.sessionMinutes +
                      ' phút/buổi'
                    : formatShortDate(selectedReceipt.subscription.startDate) +
                      ' – ' +
                      formatShortDate(selectedReceipt.subscription.endDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Hình thức thanh toán</span>
                <span className="text-zinc-300">
                  {mapMethodLabel(selectedReceipt.method)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Thu ngân xác nhận</span>
                <span className="text-zinc-300">
                  {selectedReceipt.cashier.fullName}
                </span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-3 text-sm">
                <span className="font-semibold text-white">
                  Tổng thanh toán
                </span>
                <span className="font-display text-base font-bold tabular-nums text-[#FF5500]">
                  {formatVnd(Number(selectedReceipt.amount))}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-[#18181C] px-4 text-[13px] font-semibold text-white hover:border-[#FF5500]"
              >
                <Printer className="h-3.5 w-3.5 text-[#FF5500]" />
                In Bill / Biên lai
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00]"
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
