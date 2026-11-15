'use client';

import { DataState } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Search,
  Eye,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Sliders,
  FileText,
} from 'lucide-react';
import type {
  AuditLogDetail,
  PaginatedAuditLogsResponse,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { formatDateTimeVi, formatVnd } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  Subscription: 'Gói tập hội viên',
  PaymentRecord: 'Giao dịch thanh toán',
  SubscriptionQuota: 'Hạn mức buổi tập',
  SubscriptionFreeze: 'Bảo lưu gói tập',
  MemberProfile: 'Hồ sơ hội viên',
  EmployeeProfile: 'Hồ sơ nhân sự',
  ClassSchedule: 'Lịch lớp nhóm',
  ClassBooking: 'Đặt chỗ lớp nhóm',
  PtBooking: 'Lịch tập PT 1-1',
  MembershipPlan: 'Gói dịch vụ',
};

const ACTION_LABELS: Record<
  string,
  { label: string; tone: 'orange' | 'emerald' | 'amber' | 'rose' | 'zinc' }
> = {
  CREATE_SUBSCRIPTION: { label: 'Đăng ký gói tập', tone: 'emerald' },
  ACTIVATE_SUBSCRIPTION: { label: 'Kích hoạt gói tập', tone: 'emerald' },
  RENEW_SUBSCRIPTION: { label: 'Gia hạn gói tập', tone: 'emerald' },
  CANCEL_SUBSCRIPTION: { label: 'Huỷ gói tập', tone: 'rose' },
  CONFIRM_PAYMENT: { label: 'Xác nhận thu tiền', tone: 'emerald' },
  REFUND_PAYMENT: { label: 'Hoàn tiền biên lai', tone: 'orange' },
  ADJUST_QUOTA: { label: 'Điều chỉnh buổi tập', tone: 'amber' },
  CREATE_FREEZE: { label: 'Tạo lệnh bảo lưu', tone: 'amber' },
  RESTORE_FREEZE: { label: 'Mở lại gói bảo lưu', tone: 'emerald' },
  CANCEL_BOOKING: { label: 'Huỷ lịch đặt chỗ', tone: 'rose' },
  MARK_NO_SHOW: { label: 'Đánh dấu vắng mặt', tone: 'rose' },
};

function formatActionBadge(action: string): {
  label: string;
  tone: 'orange' | 'emerald' | 'amber' | 'rose' | 'zinc';
} {
  const mapped = ACTION_LABELS[action];
  if (mapped) return mapped;

  const upper = action.toUpperCase();
  if (upper.includes('REFUND')) {
    return { label: action.replace(/_/g, ' '), tone: 'orange' };
  }
  if (
    upper.includes('CANCEL') ||
    upper.includes('DELETE') ||
    upper.includes('REJECT')
  ) {
    return { label: action.replace(/_/g, ' '), tone: 'rose' };
  }
  if (
    upper.includes('ADJUST') ||
    upper.includes('UPDATE') ||
    upper.includes('FREEZE')
  ) {
    return { label: action.replace(/_/g, ' '), tone: 'amber' };
  }
  if (
    upper.includes('CREATE') ||
    upper.includes('ACTIVATE') ||
    upper.includes('CONFIRM')
  ) {
    return { label: action.replace(/_/g, ' '), tone: 'emerald' };
  }
  return { label: action.replace(/_/g, ' '), tone: 'zinc' };
}

function formatEntityLabel(
  entityType: string,
  entityId: string | null,
): string {
  const viLabel = ENTITY_TYPE_LABELS[entityType] ?? entityType;
  if (!entityId) return viLabel;
  return `${viLabel} (#${entityId.slice(0, 8).toUpperCase()})`;
}

function summarizeAuditMetadata(
  metadata?: Record<string, unknown> | null,
): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return 'Thao tác được ghi nhận trên hệ thống';
  }
  const parts: string[] = [];
  if (typeof metadata.reason === 'string' && metadata.reason.trim()) {
    parts.push(`Lý do: ${metadata.reason.trim()}`);
  }
  if (typeof metadata.amount === 'number') {
    parts.push(`Số tiền: ${formatVnd(metadata.amount)}`);
  }
  if (typeof metadata.allocatedDelta === 'number') {
    const sign = metadata.allocatedDelta > 0 ? '+' : '';
    parts.push(`Biến động: ${sign}${metadata.allocatedDelta} buổi`);
  }
  if (typeof metadata.status === 'string') {
    parts.push(`Trạng thái: ${metadata.status}`);
  }
  if (parts.length > 0) {
    return parts.join(' • ');
  }
  return Object.entries(metadata)
    .slice(0, 3)
    .map(
      ([k, v]) =>
        `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    )
    .join(' • ');
}

export default function AdminAuditLogsPage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<ReadonlyArray<AuditLogDetail>>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotalCount, setAuditTotalCount] = useState(0);
  const [auditSearch, setAuditSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLogDetail | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.set('page', String(auditPage));
      params.set('limit', '20');
      if (entityFilter !== 'ALL') params.set('entityType', entityFilter);
      if (actionFilter !== 'ALL') params.set('action', actionFilter);
      if (fromDate) {
        params.set('from', new Date(`${fromDate}T00:00:00.000Z`).toISOString());
      }
      if (toDate) {
        params.set('to', new Date(`${toDate}T23:59:59.999Z`).toISOString());
      }

      const res = await apiClient.get<PaginatedAuditLogsResponse>(
        `/audit-logs?${params.toString()}`,
      );
      setAuditLogs(res.data ?? []);
      setAuditTotalCount(res.meta?.total ?? res.data?.length ?? 0);
      setAuditTotalPages(res.meta?.totalPages ?? 1);
    } catch {
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
      setLoading(false);
    }
  }, [auditPage, entityFilter, actionFilter, fromDate, toDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAuditLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAuditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((log) => {
      const actor =
        `${log.actorName ?? ''} ${log.actorEmail ?? ''}`.toLowerCase();
      const action = log.action.toLowerCase();
      const entity = `${log.entityType} ${log.entityId ?? ''}`.toLowerCase();
      const summary = summarizeAuditMetadata(log.metadata).toLowerCase();
      return (
        actor.includes(q) ||
        action.includes(q) ||
        entity.includes(q) ||
        summary.includes(q)
      );
    });
  }, [auditLogs, auditSearch]);

  const { subAndFreezeCount, paymentCount, quotaAndScheduleCount } =
    useMemo(() => {
      let subCount = 0;
      let payCount = 0;
      let quotaCount = 0;
      for (const item of auditLogs) {
        if (
          item.entityType === 'Subscription' ||
          item.entityType === 'SubscriptionFreeze'
        ) {
          subCount += 1;
        } else if (item.entityType === 'PaymentRecord') {
          payCount += 1;
        } else if (
          item.entityType === 'SubscriptionQuota' ||
          item.entityType === 'ClassSchedule' ||
          item.entityType === 'PtBooking' ||
          item.entityType === 'ClassBooking'
        ) {
          quotaCount += 1;
        }
      }
      return {
        subAndFreezeCount: subCount,
        paymentCount: payCount,
        quotaAndScheduleCount: quotaCount,
      };
    }, [auditLogs]);

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void fetchAuditLogs()}
      />
    );

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Nhật ký hoạt động hệ thống
          </h1>
        </div>

        <button
          type="button"
          onClick={() => void fetchAuditLogs()}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-[#26262D] bg-[#141418] px-4 text-[13px] font-semibold text-[#D1D1D8] transition-colors hover:border-[#FF5500]/50 hover:text-white disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          <span>Làm mới nhật ký</span>
        </button>
      </div>

      {/* Top KPI Summary Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[20px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Tổng bản ghi nhật ký
            </span>
            <ShieldCheck className="h-4 w-4 text-[#FF5500]" />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {auditTotalCount.toLocaleString('vi-VN')}
          </p>
          <p className="mt-1 text-[13px] text-[#6B6B75]">
            Lưu vết toàn bộ sự kiện nhạy cảm
          </p>
        </div>

        <div className="rounded-[20px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Thao tác Gói tập &amp; Bảo lưu
            </span>
            <FileText className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {subAndFreezeCount}
          </p>
          <p className="mt-1 text-[13px] text-[#6B6B75]">
            Đăng ký, kích hoạt, huỷ &amp; bảo lưu gói
          </p>
        </div>

        <div className="rounded-[20px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Thao tác Thanh toán &amp; Hoàn tiền
            </span>
            <CreditCard className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {paymentCount}
          </p>
          <p className="mt-1 text-[13px] text-[#6B6B75]">
            Xác nhận thu tiền POS &amp; hoàn tiền
          </p>
        </div>

        <div className="rounded-[20px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Thao tác Hạn mức &amp; Lịch tập
            </span>
            <Sliders className="h-4 w-4 text-[#FF5500]" />
          </div>
          <p className="mt-2 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {quotaAndScheduleCount}
          </p>
          <p className="mt-1 text-[13px] text-[#6B6B75]">
            Điều chỉnh buổi tập &amp; xếp lịch
          </p>
        </div>
      </section>

      {/* Audit Log Filter Toolbar & Table */}
      <section className="rounded-[24px] border border-[#24242A] bg-[#141418] p-6">
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#6B6B75]" />
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Tìm người thực hiện, mã đối tượng, nội dung..."
              className="w-full rounded-[12px] border border-[#26262D] bg-[#0E0E11] py-2 pr-3.5 pl-9 text-[12px] text-[#F5F5F7] placeholder:text-[#6B6B75] focus:border-[#FF5500] focus:outline-none"
            />
          </div>

          <div>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setAuditPage(1);
              }}
              aria-label="Lọc theo phân hệ"
              className="w-full rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-2 text-[12px] text-[#F5F5F7] focus:border-[#FF5500] focus:outline-none"
            >
              <option value="ALL">Tất cả phân hệ</option>
              <option value="Subscription">Gói tập hội viên</option>
              <option value="PaymentRecord">Giao dịch thanh toán</option>
              <option value="SubscriptionQuota">Hạn mức buổi tập</option>
              <option value="SubscriptionFreeze">Bảo lưu gói tập</option>
              <option value="MemberProfile">Hồ sơ hội viên</option>
              <option value="ClassSchedule">Lịch lớp nhóm</option>
              <option value="PtBooking">Lịch tập PT 1-1</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setAuditPage(1);
              }}
              aria-label="Từ ngày"
              className="w-full rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-2 text-[12px] text-[#F5F5F7] focus:border-[#FF5500] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setAuditPage(1);
              }}
              aria-label="Đến ngày"
              className="w-full rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-2 text-[12px] text-[#F5F5F7] focus:border-[#FF5500] focus:outline-none"
            />
            {(entityFilter !== 'ALL' ||
              actionFilter !== 'ALL' ||
              fromDate ||
              toDate ||
              auditSearch) && (
              <button
                type="button"
                onClick={() => {
                  setEntityFilter('ALL');
                  setActionFilter('ALL');
                  setFromDate('');
                  setToDate('');
                  setAuditSearch('');
                  setAuditPage(1);
                }}
                className="shrink-0 rounded-[10px] border border-[#26262D] bg-[#19191F] px-2.5 py-2 text-[13px] text-[#9A9AA3] hover:text-white"
              >
                Xoá lọc
              </button>
            )}
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#222228]">
                <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                  Thời gian
                </th>
                <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                  Người thực hiện
                </th>
                <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                  Hành động
                </th>
                <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                  Đối tượng tác động
                </th>
                <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                  Chi tiết thay đổi
                </th>
                <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                  Xem
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E1E24]">
              {filteredAuditLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-12 text-center text-[13px] text-[#6B6B75]"
                  >
                    Chưa có bản ghi nhật ký hoạt động nào khớp với bộ lọc hiện
                    tại.
                  </td>
                </tr>
              ) : (
                filteredAuditLogs.map((log) => {
                  const badge = formatActionBadge(log.action);
                  return (
                    <tr
                      key={log.id}
                      className="transition-colors hover:bg-[#19191F]/60"
                    >
                      <td className="py-3.5 font-mono text-[12px] text-[#9A9AA3]">
                        {formatDateTimeVi(log.createdAt)}
                      </td>
                      <td className="py-3.5">
                        <p className="text-[12px] font-semibold text-[#F5F5F7]">
                          {log.actorName ?? 'Quản trị hệ thống'}
                        </p>
                        {log.actorEmail && (
                          <p className="text-[13px] text-[#6B6B75]">
                            {log.actorEmail}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold',
                            badge.tone === 'orange' &&
                              'bg-[#FF5500]/15 text-[#FF5500]',
                            badge.tone === 'emerald' &&
                              'bg-emerald-500/15 text-emerald-400',
                            badge.tone === 'amber' &&
                              'bg-amber-500/15 text-amber-400',
                            badge.tone === 'rose' &&
                              'bg-rose-500/15 text-rose-400',
                            badge.tone === 'zinc' &&
                              'bg-zinc-500/15 text-zinc-300',
                          )}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3.5 text-[12px] text-[#D1D1D8]">
                        {formatEntityLabel(log.entityType, log.entityId)}
                      </td>
                      <td className="max-w-[300px] truncate py-3.5 text-[12px] text-[#8A8A93]">
                        {summarizeAuditMetadata(log.metadata)}
                      </td>
                      <td className="py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="inline-flex items-center gap-1 rounded-[8px] border border-[#26262D] bg-[#0E0E11] px-2.5 py-1 text-[13px] font-medium text-[#D1D1D8] hover:border-[#FF5500]/50 hover:text-white"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Chi tiết</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-5 flex items-center justify-between border-t border-[#222228] pt-4">
          <span className="text-[12px] text-[#8A8A93]">
            Trang <strong className="text-[#F5F5F7]">{auditPage}</strong> /{' '}
            <strong className="text-[#F5F5F7]">{auditTotalPages}</strong> (Tổng{' '}
            {auditTotalCount} bản ghi)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={auditPage <= 1}
              onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-[10px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5 text-[12px] text-[#D1D1D8] hover:border-[#FF5500]/50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Trước</span>
            </button>
            <button
              type="button"
              disabled={auditPage >= auditTotalPages}
              onClick={() =>
                setAuditPage((p) => Math.min(auditTotalPages, p + 1))
              }
              className="inline-flex items-center gap-1 rounded-[10px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5 text-[12px] text-[#D1D1D8] hover:border-[#FF5500]/50 disabled:opacity-40"
            >
              <span>Sau</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* MODAL: AUDIT LOG DETAIL */}
      {selectedLog && (
        <ModalFrame
          onClose={() => setSelectedLog(null)}
          labelledBy="app-dashboard-audit-logs-page-heading-0"
          maxWidthClassName="max-w-lg"
        >
          <div className="w-full max-w-lg rounded-[24px] border border-[#26262D] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#222228] pb-4">
              <div>
                <h3
                  className="text-[16px] font-bold text-[#F5F5F7]"
                  id="app-dashboard-audit-logs-page-heading-0"
                >
                  Chi tiết bản ghi nhật ký
                </h3>
                <p className="mt-0.5 font-mono text-[13px] text-[#8A8A93]">
                  {formatDateTimeVi(selectedLog.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-lg p-1.5 text-[#8A8A93] hover:bg-[#222228] hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-[12px]">
              <div className="flex justify-between rounded-[12px] bg-[#0E0E11] px-3.5 py-2.5">
                <span className="text-[#8A8A93]">Người thực hiện</span>
                <span className="font-semibold text-[#F5F5F7]">
                  {selectedLog.actorName ?? 'Hệ thống'}{' '}
                  {selectedLog.actorEmail ? `(${selectedLog.actorEmail})` : ''}
                </span>
              </div>
              <div className="flex justify-between rounded-[12px] bg-[#0E0E11] px-3.5 py-2.5">
                <span className="text-[#8A8A93]">Hành động</span>
                <span className="font-semibold text-[#FF5500]">
                  {formatActionBadge(selectedLog.action).label}
                </span>
              </div>
              <div className="flex justify-between rounded-[12px] bg-[#0E0E11] px-3.5 py-2.5">
                <span className="text-[#8A8A93]">Đối tượng tác động</span>
                <span className="font-semibold text-[#F5F5F7]">
                  {formatEntityLabel(
                    selectedLog.entityType,
                    selectedLog.entityId,
                  )}
                </span>
              </div>
              <div className="rounded-[12px] bg-[#0E0E11] p-3.5">
                <span className="mb-2 block text-[#8A8A93]">
                  Dữ liệu chi tiết đính kèm
                </span>
                <pre className="max-h-56 overflow-auto font-mono text-[13px] leading-relaxed text-[#D1D1D8]">
                  {JSON.stringify(selectedLog.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-[12px] bg-[#26262D] px-4 py-2 text-[12px] font-semibold text-[#F5F5F7] hover:bg-[#32323A]"
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
