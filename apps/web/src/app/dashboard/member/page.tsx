'use client';

import { formatDurationVi } from '@/lib/formatters';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CreditCard,
  Dumbbell,
  Calendar,
  Activity,
  Lock,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Copy,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import {
  CheckinStatus,
  FreezeStatus,
  ServiceTypeCode,
  SubscriptionStatus,
  type CheckinDetail,
  type MemberDetail,
  type SubscriptionDetail,
  type SubscriptionFreezeDetail,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { ApiError, apiClient } from '@/services/api-client';
import { DataState } from '@/components/shared/data-state';
import { SubscriptionStatusBadge } from '@/components/shared/domain-status-badge';
import { QuotaMeter } from '@/components/shared/quota-meter';

interface MemberVisitRow {
  id: string;
  date: string;
  time: string;
  verifiedBy: string;
  planUsed: string;
  note: string;
  status: 'Approved' | 'Declined';
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

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export default function MemberPassAndPlanPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus | null>(null);
  const [memberProfile, setMemberProfile] = useState<{
    memberCode: string;
    fullName: string;
    idPhotoUrl: string | null;
  }>({
    memberCode: '—',
    fullName: 'Hội viên Aura Gym',
    idPhotoUrl: null,
  });

  const [activePlan, setActivePlan] = useState<{
    id: string;
    name: string;
    durationDays: number;
    startDate: string;
    endDate: string;
    statusLabel: string;
    freezesUsed: number | null;
  }>({
    id: '',
    name: '—',
    durationDays: 0,
    startDate: '—',
    endDate: '—',
    statusLabel: 'Chưa có gói',
    freezesUsed: 0,
  });

  const [queuedRenewal, setQueuedRenewal] = useState<{
    name: string;
    durationDays: number;
    startDate: string;
    endDate: string;
  } | null>(null);

  const [classQuota, setClassQuota] = useState<{
    allocated: number | null;
    available: number | null;
    reserved: number;
    used: number;
  }>({
    allocated: 0,
    available: 0,
    reserved: 0,
    used: 0,
  });

  const [ptQuota, setPtQuota] = useState<{
    allocated: number | null;
    available: number | null;
    reserved: number;
    used: number;
  }>({
    allocated: 0,
    available: 0,
    reserved: 0,
    used: 0,
  });

  const [visits, setVisits] = useState<ReadonlyArray<MemberVisitRow>>([]);
  const [copiedMemberCode, setCopiedMemberCode] = useState(false);
  const hasLoadedRef = useRef(false);

  const loadMemberPass = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [meRes, currentSubRes, historyRes, quotasRes, checkinsRes] =
        await Promise.allSettled([
          apiClient.get<MemberDetail>('/members/me'),
          apiClient.get<SubscriptionDetail>('/subscriptions/me/current'),
          apiClient.get<SubscriptionDetail[]>('/subscriptions/me'),
          apiClient.get<SubscriptionQuotaDetail[]>(
            '/subscriptions/me/current/quotas',
          ),
          apiClient.get<CheckinDetail[]>('/checkins/me'),
        ]);

      const missingSubscription =
        currentSubRes.status === 'rejected' &&
        currentSubRes.reason instanceof ApiError &&
        currentSubRes.reason.status === 404;
      if (
        meRes.status === 'rejected' ||
        historyRes.status === 'rejected' ||
        checkinsRes.status === 'rejected' ||
        (currentSubRes.status === 'rejected' && !missingSubscription) ||
        (quotasRes.status === 'rejected' && !missingSubscription)
      ) {
        throw new Error(
          'Không thể tải đầy đủ thông tin hội viên. Vui lòng thử lại.',
        );
      }
      if (missingSubscription) {
        setSubscriptionStatus(null);
        setActivePlan({
          id: '',
          name: 'Chưa có gói tập',
          durationDays: 0,
          startDate: '—',
          endDate: '—',
          statusLabel: 'Chưa có gói',
          freezesUsed: 0,
        });
        setClassQuota({ allocated: 0, available: 0, reserved: 0, used: 0 });
        setPtQuota({ allocated: 0, available: 0, reserved: 0, used: 0 });
      }
      if (meRes.status === 'fulfilled') {
        const me = meRes.value;
        setMemberProfile({
          memberCode: me.memberCode,
          fullName: me.fullName,
          idPhotoUrl: me.idPhotoUrl ?? null,
        });
      }

      if (currentSubRes.status === 'fulfilled') {
        const sub = currentSubRes.value;
        setSubscriptionStatus(sub.effectiveStatus);
        let usedFreezes: number | null = null;
        try {
          const freezes = await apiClient.get<SubscriptionFreezeDetail[]>(
            `/subscriptions/${sub.id}/freezes`,
          );
          usedFreezes = freezes.filter(
            (f) =>
              f.status === FreezeStatus.APPROVED ||
              f.status === FreezeStatus.COMPLETED,
          ).length;
        } catch {
          // Ignore freeze count error
        }

        setActivePlan({
          id: sub.id,
          name: sub.plan.name,
          durationDays: sub.plan.durationDays,
          startDate: formatShortDate(sub.startDate),
          endDate: formatShortDate(sub.endDate),
          statusLabel:
            sub.effectiveStatus === SubscriptionStatus.SUSPENDED
              ? 'Đang bảo lưu'
              : sub.effectiveStatus === SubscriptionStatus.EXPIRED
                ? 'Đã hết hạn'
                : sub.effectiveStatus === SubscriptionStatus.UPCOMING
                  ? 'Sắp kích hoạt'
                  : sub.effectiveStatus === SubscriptionStatus.CANCELLED
                    ? 'Đã huỷ'
                    : 'Đang hoạt động',
          freezesUsed: usedFreezes === null ? null : Math.min(usedFreezes, 2),
        });
      }

      if (historyRes.status === 'fulfilled') {
        const upcoming = historyRes.value.find(
          (s) => s.effectiveStatus === SubscriptionStatus.UPCOMING,
        );
        setQueuedRenewal(
          upcoming
            ? {
                name: upcoming.plan.name,
                durationDays: upcoming.plan.durationDays,
                startDate: formatShortDate(upcoming.startDate),
                endDate: formatShortDate(upcoming.endDate),
              }
            : null,
        );
      }

      if (quotasRes.status === 'fulfilled' && quotasRes.value.length > 0) {
        const cls = quotasRes.value.find((q) => q.service === 'CLASS');
        if (cls) {
          setClassQuota({
            allocated: cls.allocated,
            available: cls.remaining,
            reserved: cls.reserved,
            used: cls.used,
          });
        }
        const pt = quotasRes.value.find((q) => q.service === 'PT');
        if (pt) {
          setPtQuota({
            allocated: pt.allocated,
            available: pt.remaining,
            reserved: pt.reserved,
            used: pt.used,
          });
        }
      }

      if (checkinsRes.status === 'fulfilled') {
        setVisits(
          checkinsRes.value.slice(0, 8).map((chk) => ({
            id: chk.id,
            date: formatShortDate(chk.checkedInAt),
            time: formatTime(chk.checkedInAt),
            verifiedBy: chk.recordedByName || 'Quầy lễ tân',
            planUsed: chk.planName || 'Gói tập đang kích hoạt',
            note: chk.rejectionReason || 'Xác thực qua cổng thành công',
            status:
              chk.status === CheckinStatus.ACCEPTED ? 'Approved' : 'Declined',
          })),
        );
      }
      hasLoadedRef.current = true;
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Không thể tải thông tin hội viên.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemberPass();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMemberPass]);

  const classQuotaDisplay =
    classQuota.allocated === null
      ? 'Không giới hạn'
      : `${classQuota.available ?? 0} / ${classQuota.allocated}`;
  const ptQuotaDisplay =
    ptQuota.allocated === null
      ? 'Không giới hạn'
      : `${ptQuota.available ?? 0} / ${ptQuota.allocated}`;

  const classQuotaItem: SubscriptionQuotaDetail = {
    id: 'quota-class',
    subscriptionId: activePlan.id,
    service: ServiceTypeCode.CLASS,
    serviceName: 'Lớp học nhóm (Group Class)',
    allocated: classQuota.allocated,
    unlimited: classQuota.allocated === null,
    used: classQuota.used,
    reserved: classQuota.reserved,
    remaining: classQuota.available,
    updatedAt: '',
  };

  const ptQuotaItem: SubscriptionQuotaDetail = {
    id: 'quota-pt',
    subscriptionId: activePlan.id,
    service: ServiceTypeCode.PT,
    serviceName: 'Huấn luyện viên 1-1 (PT)',
    allocated: ptQuota.allocated,
    unlimited: ptQuota.allocated === null,
    used: ptQuota.used,
    reserved: ptQuota.reserved,
    remaining: ptQuota.available,
    updatedAt: '',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Thẻ hội viên
          </h1>
        </div>

        <Link
          href="/dashboard/member/schedule"
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <span>Đặt lịch Group Class &amp; PT</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadMemberPass()}
      />
      {!loading && !loadError && (
        <>
          {/* Row 1: 4 IronGym KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300">
                  <CreditCard className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-zinc-300">
                  Gói tập hiện tại
                </span>
              </div>
              <div className="mt-4 font-display text-2xl font-bold text-white">
                {activePlan.name}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] tabular-nums text-zinc-500">
                  Hết hạn: {activePlan.endDate}
                </span>
                <SubscriptionStatusBadge status={subscriptionStatus} />
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300">
                  <Calendar className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-zinc-300">
                  Buổi Group Class
                </span>
              </div>
              <div className="mt-4 font-display text-3xl font-bold tabular-nums text-white">
                {classQuotaDisplay}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] tabular-nums text-zinc-500">
                  Đang giữ chỗ: {classQuota.reserved} buổi
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[13px] font-semibold text-zinc-300">
                  {classQuota.allocated === null ||
                  (classQuota.available ?? 0) > 0
                    ? 'Còn lượt'
                    : 'Hết lượt'}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300">
                  <Dumbbell className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-zinc-300">
                  Buổi tập PT 1-1
                </span>
              </div>
              <div className="mt-4 font-display text-3xl font-bold tabular-nums text-white">
                {ptQuotaDisplay}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] tabular-nums text-zinc-500">
                  Đang giữ chỗ: {ptQuota.reserved} buổi
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[13px] font-semibold text-zinc-300">
                  {ptQuota.allocated === null || (ptQuota.available ?? 0) > 0
                    ? 'Còn lượt'
                    : 'Hết lượt'}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300">
                  <Activity className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-zinc-300">
                  Lượt vào gần đây
                </span>
              </div>
              <div className="mt-4 font-display text-3xl font-bold tabular-nums text-white">
                {visits.filter((visit) => visit.status === 'Approved').length}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] tabular-nums text-zinc-500">
                  Gần nhất: {visits[0]?.time || '—'}
                </span>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[13px] font-semibold text-zinc-300">
                  Tối đa 8 lượt gần đây
                </span>
              </div>
            </div>
          </div>

          {/* Row 2: Member Gate Pass & Locked ID Photo (5 cols) + Subscription Timeline (7 cols) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Member Gate Pass & Locked ID Photo */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  Thẻ và ảnh hội viên
                </h2>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        memberProfile.memberCode,
                      );
                      setCopiedMemberCode(true);
                      window.setTimeout(() => setCopiedMemberCode(false), 1800);
                    } catch {
                      // Ignore clipboard failure
                    }
                  }}
                  title="Sao chép mã hội viên"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 py-1 font-mono text-[13px] text-[#FF5500] transition-colors hover:border-[#FF5500]/50"
                >
                  <span>{memberProfile.memberCode}</span>
                  {copiedMemberCode ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 text-zinc-400" />
                  )}
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-12">
                {/* 3:4 ID Photo (Locked for Member) */}
                <div className="sm:col-span-5">
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
                    {memberProfile.idPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={memberProfile.idPhotoUrl}
                        alt="Ảnh thẻ hội viên"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#FF5500]/15 text-2xl font-bold text-[#FF5500]">
                        {getInitials(memberProfile.fullName)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled
                    className="mt-2.5 inline-flex h-8 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-white/[0.06] bg-[#18181C] text-[13px] text-zinc-500"
                  >
                    <Lock className="h-3 w-3" />
                    Đã khóa đổi ảnh
                  </button>
                </div>

                {/* Pass Info */}
                <div className="flex flex-col justify-between rounded-xl border border-white/[0.05] bg-[#18181C] p-4 sm:col-span-7">
                  <div>
                    <p className="text-base font-bold text-white">
                      {memberProfile.fullName}
                    </p>
                    <p className="mt-0.5 text-[13px] text-zinc-400">
                      {activePlan.name} • Hội viên chính thức
                    </p>

                    <p className="mt-4 rounded-lg border border-border p-3 text-sm text-zinc-300">
                      Đưa mã hội viên cho lễ tân để làm thủ tục vào phòng tập.
                    </p>
                  </div>

                  <p className="mt-4 text-[13px] leading-relaxed text-zinc-500">
                    Ảnh ID Check-in dùng để đối chiếu khi qua cổng. Để cập nhật
                    ảnh mới, vui lòng mang CCCD đến quầy lễ tân.
                  </p>
                </div>
              </div>
            </div>

            {/* Subscription Timeline & Queued Renewal */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-7">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Thời hạn gói tập &amp; Hạn mức buổi tập
                  </h2>
                  <p className="text-[13px] text-zinc-500">
                    Chi tiết gói đang sử dụng và lịch trình gói gia hạn kế tiếp
                  </p>
                </div>
                <Link
                  href="/dashboard/member/billing"
                  className="text-[13px] font-semibold text-[#FF5500] hover:underline"
                >
                  Quản lý Bảo lưu &amp; Hóa đơn
                </Link>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-500/30 bg-[#18181C] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-white">
                      {activePlan.name}{' '}
                      {activePlan.durationDays > 0
                        ? `(${formatDurationVi(activePlan.durationDays)})`
                        : ''}
                    </span>
                    <SubscriptionStatusBadge status={subscriptionStatus} />
                  </div>
                  <p className="mt-2 text-[13px] tabular-nums text-zinc-400">
                    {activePlan.startDate} – {activePlan.endDate}
                  </p>
                  <p className="mt-2 text-[13px] tabular-nums text-zinc-500">
                    Đã bảo lưu: {activePlan.freezesUsed ?? '—'} / 2 lần (7–60
                    ngày/lần)
                  </p>
                </div>

                {queuedRenewal && (
                  <div className="rounded-xl border border-white/[0.06] bg-[#18181C] p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-white">
                        {queuedRenewal.name} (Gia hạn{' '}
                        {formatDurationVi(queuedRenewal.durationDays)})
                      </span>
                      <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[13px] font-semibold text-zinc-300">
                        Chờ kích hoạt
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] tabular-nums text-zinc-400">
                      {queuedRenewal.startDate} – {queuedRenewal.endDate}
                    </p>
                    <p className="mt-2 text-[13px] text-zinc-500">
                      Tự động nối tiếp ngay khi gói hiện tại kết thúc
                    </p>
                  </div>
                )}
              </div>

              {/* Quotas Breakdown (2-Phase QuotaMeter: Used + Reserved + Remaining) */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <QuotaMeter
                  quota={classQuotaItem}
                  className="border-white/[0.06] bg-[#18181C]"
                />
                <QuotaMeter
                  quota={ptQuotaItem}
                  className="border-white/[0.06] bg-[#18181C]"
                />
              </div>
            </div>
          </div>

          {/* Row 3: Recent Gate Check-in History */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">
                Lịch sử Check-in gần đây
              </h2>
              <p className="text-[13px] text-zinc-500">
                Nhật ký các lượt Check-in được xác thực tại quầy lễ tân Aura Gym
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                    <th className="pb-3.5">Ngày</th>
                    <th className="pb-3.5">Giờ vào</th>
                    <th className="pb-3.5">Gói tập áp dụng</th>
                    <th className="pb-3.5">Người xác thực</th>
                    <th className="pb-3.5">Ghi chú</th>
                    <th className="pb-3.5 text-right">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-[13px]">
                  {visits.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-sm text-zinc-400"
                      >
                        Chưa có lịch sử ra vào.
                      </td>
                    </tr>
                  )}
                  {visits.map((visit) => (
                    <tr
                      key={visit.id}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="py-3.5 font-medium tabular-nums text-white">
                        {visit.date}
                      </td>
                      <td className="py-3.5 tabular-nums text-zinc-300">
                        {visit.time}
                      </td>
                      <td className="py-3.5 text-zinc-300">{visit.planUsed}</td>
                      <td className="py-3.5 text-zinc-400">
                        {visit.verifiedBy}
                      </td>
                      <td className="py-3.5 text-zinc-400">{visit.note}</td>
                      <td className="py-3.5 text-right">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold',
                            visit.status === 'Approved'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-red-500/40 bg-red-500/10 text-red-400',
                          )}
                        >
                          {visit.status === 'Approved' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {visit.status === 'Approved' ? 'Hợp lệ' : 'Từ chối'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
