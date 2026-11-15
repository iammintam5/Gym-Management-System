'use client';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DollarSign,
  Users,
  Dumbbell,
  Clock,
  Calendar,
  RefreshCw,
  ArrowUpRight,
  Award,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import type {
  AttendancePeakHoursReport,
  ClassUtilizationReport,
  DashboardSummaryReport,
  RevenueReportResponse,
  TrainerPerformanceReport,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import {
  formatDateTimeVi,
  formatDateVi,
  formatVnd,
  getInitials,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

type PeriodPreset = '30d' | '90d' | '180d' | 'ytd' | 'custom';

function toInputDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPresetDates(preset: Exclude<PeriodPreset, 'custom'>): {
  from: string;
  to: string;
  defaultGroupBy: 'DAY' | 'MONTH';
} {
  const now = new Date();
  const to = toInputDateString(now);

  if (preset === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: toInputDateString(start), to, defaultGroupBy: 'DAY' };
  }
  if (preset === '90d') {
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { from: toInputDateString(start), to, defaultGroupBy: 'MONTH' };
  }
  if (preset === '180d') {
    const start = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    return { from: toInputDateString(start), to, defaultGroupBy: 'MONTH' };
  }
  // ytd
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return { from: toInputDateString(startOfYear), to, defaultGroupBy: 'MONTH' };
}

function formatCompactVnd(amount: number): string {
  if (amount <= 0) return '0đ';
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(1).replace('.0', '')} tỷ`;
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1).replace('.0', '')} tr`;
  }
  if (amount >= 1_000) {
    return `${Math.round(amount / 1_000)}k`;
  }
  return `${Math.round(amount)}đ`;
}

function formatTimeBucketLabel(
  bucket: string,
  groupBy: 'DAY' | 'MONTH',
): string {
  if (groupBy === 'MONTH') {
    const parts = bucket.split('-');
    if (parts.length >= 2) {
      return `T${Number(parts[1])}/${parts[0]?.slice(2)}`;
    }
    return bucket;
  }
  // YYYY-MM-DD -> DD/MM
  const parts = bucket.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return bucket;
}

export default function DashboardReportsPage() {
  const initialRange = useMemo(() => getPresetDates('180d'), []);
  const [loadError, setLoadError] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('180d');
  const [fromDate, setFromDate] = useState<string>(initialRange.from);
  const [toDate, setToDate] = useState<string>(initialRange.to);
  const [groupBy, setGroupBy] = useState<'DAY' | 'MONTH'>(
    initialRange.defaultGroupBy,
  );
  const [peakDate, setPeakDate] = useState<string>(() =>
    toInputDateString(new Date()),
  );
  const [loading, setLoading] = useState<boolean>(true);

  const [summary, setSummary] = useState<DashboardSummaryReport | null>(null);
  const [revenueReport, setRevenueReport] =
    useState<RevenueReportResponse | null>(null);
  const [peakReport, setPeakReport] =
    useState<AttendancePeakHoursReport | null>(null);
  const [classReport, setClassReport] = useState<ClassUtilizationReport | null>(
    null,
  );
  const [trainerReport, setTrainerReport] =
    useState<TrainerPerformanceReport | null>(null);

  const handleSelectPreset = (nextPreset: Exclude<PeriodPreset, 'custom'>) => {
    setPreset(nextPreset);
    const range = getPresetDates(nextPreset);
    setFromDate(range.from);
    setToDate(range.to);
    setGroupBy(range.defaultGroupBy);
  };

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setLoading(true);

      const fromIso = fromDate
        ? new Date(`${fromDate}T00:00:00.000Z`).toISOString()
        : undefined;
      const toIso = toDate
        ? new Date(`${toDate}T23:59:59.999Z`).toISOString()
        : undefined;

      const revParams = new URLSearchParams();
      if (fromIso) revParams.set('from', fromIso);
      if (toIso) revParams.set('to', toIso);
      revParams.set('groupBy', groupBy);

      const rangeParams = new URLSearchParams();
      if (fromIso) rangeParams.set('from', fromIso);
      if (toIso) rangeParams.set('to', toIso);

      const peakParams = new URLSearchParams();
      if (peakDate) peakParams.set('date', peakDate);

      const [sumRes, revRes, peakRes, classRes, trainerRes] =
        await Promise.allSettled([
          apiClient.get<DashboardSummaryReport>('/reports/dashboard-summary'),
          apiClient.get<RevenueReportResponse>(
            `/reports/revenue?${revParams.toString()}`,
          ),
          apiClient.get<AttendancePeakHoursReport>(
            `/reports/attendance-peak-hours?${peakParams.toString()}`,
          ),
          apiClient.get<ClassUtilizationReport>(
            `/reports/class-utilization?${rangeParams.toString()}`,
          ),
          apiClient.get<TrainerPerformanceReport>(
            `/reports/trainer-performance?${rangeParams.toString()}`,
          ),
        ]);
      assertDataLoaded([trainerRes], false);
      assertDataLoaded([classRes], false);
      assertDataLoaded([peakRes], false);
      assertDataLoaded([revRes], false);
      assertDataLoaded([sumRes], false);

      if (sumRes.status === 'fulfilled') setSummary(sumRes.value);
      if (revRes.status === 'fulfilled') setRevenueReport(revRes.value);
      if (peakRes.status === 'fulfilled') setPeakReport(peakRes.value);
      if (classRes.status === 'fulfilled') setClassReport(classRes.value);
      if (trainerRes.status === 'fulfilled') setTrainerReport(trainerRes.value);
    } catch {
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, groupBy, peakDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAnalytics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAnalytics]);

  // Derived Revenue Analytics
  const revenueItems = useMemo(
    () => revenueReport?.items ?? [],
    [revenueReport],
  );
  const periodTotalRevenue = revenueReport?.totalRevenue ?? 0;
  const periodTotalPayments = revenueReport?.totalPayments ?? 0;

  const { periodCashTotal, periodDigitalTotal, digitalRatioPct } =
    useMemo(() => {
      let cash = 0;
      let digital = 0;
      for (const item of revenueItems) {
        cash += item.byMethod.CASH;
        digital += item.byMethod.TRANSFER + item.byMethod.CARD;
      }
      const total = cash + digital;
      const ratio = total > 0 ? Math.round((digital / total) * 1000) / 10 : 0;
      return {
        periodCashTotal: cash,
        periodDigitalTotal: digital,
        digitalRatioPct: ratio,
      };
    }, [revenueItems]);

  const maxRevenueBucket = useMemo(() => {
    const rawMax = Math.max(...revenueItems.map((i) => i.revenue), 0);
    if (rawMax <= 0) return 10_000_000;
    // Round up to clean scale
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
    return Math.ceil(rawMax / magnitude) * magnitude;
  }, [revenueItems]);

  const revenueYAxisTicks = useMemo(
    () => [
      formatCompactVnd(maxRevenueBucket),
      formatCompactVnd(maxRevenueBucket * 0.75),
      formatCompactVnd(maxRevenueBucket * 0.5),
      formatCompactVnd(maxRevenueBucket * 0.25),
      '0đ',
    ],
    [maxRevenueBucket],
  );

  // Derived Peak Hours Analytics (06:00 -> 21:00)
  const hourlySlots = useMemo(() => {
    const dist = peakReport?.hourlyDistribution ?? [];
    const filtered = dist.filter((h) => h.hour >= 6 && h.hour <= 21);
    if (filtered.length > 0) return filtered;
    return Array.from({ length: 16 }, (_, idx) => ({
      hour: idx + 6,
      count: 0,
      percentage: 0,
    }));
  }, [peakReport]);

  const maxHourlyCount = useMemo(() => {
    const rawMax = Math.max(...hourlySlots.map((h) => h.count), 0);
    return Math.max(4, Math.ceil(rawMax / 4) * 4);
  }, [hourlySlots]);

  const peakYAxisTicks = useMemo(
    () => [
      maxHourlyCount,
      Math.round(maxHourlyCount * 0.75),
      Math.round(maxHourlyCount * 0.5),
      Math.round(maxHourlyCount * 0.25),
      0,
    ],
    [maxHourlyCount],
  );

  // Derived Trainer & Class Totals
  const trainerItems = useMemo(
    () => trainerReport?.items ?? [],
    [trainerReport],
  );
  const totalPtSessionsInPeriod = useMemo(
    () => trainerItems.reduce((sum, t) => sum + t.completedSessionsCount, 0),
    [trainerItems],
  );
  const totalPtHoursInPeriod = useMemo(
    () =>
      Math.round(
        trainerItems.reduce((sum, t) => sum + t.totalTrainingHours, 0) * 10,
      ) / 10,
    [trainerItems],
  );

  const classItems = useMemo(() => classReport?.items ?? [], [classReport]);
  const avgClassUtilPct = classReport?.averageUtilizationRate ?? 0;
  const totalClassSchedules = classReport?.totalSchedules ?? 0;

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void fetchAnalytics()}
      />
    );

  return (
    <div className="space-y-6 pb-8">
      {/* 1. FILTER TOOLBAR */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-[#24242A] bg-[#141418] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-[12px] border border-[#26262D] bg-[#0E0E11] p-1">
            {(
              [
                { id: '30d', label: '30 ngày qua' },
                { id: '90d', label: '3 tháng qua' },
                { id: '180d', label: '6 tháng qua' },
                { id: 'ytd', label: 'Năm nay' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectPreset(item.id)}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                  preset === item.id
                    ? 'bg-[#FF5500] text-white'
                    : 'text-[#8A8A93] hover:text-[#F5F5F7]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-[#8A8A93]" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPreset('custom');
              }}
              aria-label="Từ ngày"
              className="bg-transparent text-[12px] text-[#F5F5F7] focus:outline-none"
            />
            <span className="text-[12px] text-[#6B6B75]">→</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPreset('custom');
              }}
              aria-label="Đến ngày"
              className="bg-transparent text-[12px] text-[#F5F5F7] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/audit-logs"
            className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3.5 py-2 text-[12px] font-medium text-[#D1D1D8] transition-colors hover:border-[#FF5500]/50 hover:text-white"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-[#FF5500]" />
            <span>Nhật ký hoạt động</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-[#8A8A93]" />
          </Link>

          <button
            type="button"
            onClick={() => void fetchAnalytics()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3.5 py-2 text-[12px] font-medium text-[#D1D1D8] transition-colors hover:border-[#FF5500]/50 hover:text-white disabled:opacity-50"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
            />
            <span>Làm mới</span>
          </button>
        </div>
      </section>

      {/* 2. PERIOD KPI CARDS */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[22px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Doanh thu kỳ báo cáo
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF5500]/15 text-[#FF5500]">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {formatVnd(periodTotalRevenue)}
          </p>
          <div className="mt-2 flex items-center justify-between text-[13px] text-[#8A8A93]">
            <span>{periodTotalPayments} biên lai đã thu</span>
            <span className="font-mono text-emerald-400">
              Tháng này:{' '}
              {formatCompactVnd(summary?.financials.totalRevenue ?? 0)}
            </span>
          </div>
        </div>

        <div className="rounded-[22px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Tỷ trọng thanh toán không tiền mặt
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {digitalRatioPct.toString().replace('.', ',')}%
          </p>
          <div className="mt-2 flex items-center justify-between text-[13px] text-[#8A8A93]">
            <span>CK & Thẻ: {formatCompactVnd(periodDigitalTotal)}</span>
            <span>Tiền mặt: {formatCompactVnd(periodCashTotal)}</span>
          </div>
        </div>

        <div className="rounded-[22px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Hiệu suất lấp đầy lớp nhóm
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {avgClassUtilPct.toString().replace('.', ',')}%
          </p>
          <div className="mt-2 flex items-center justify-between text-[13px] text-[#8A8A93]">
            <span>Tổng {totalClassSchedules} ca học trong kỳ</span>
            <span>Đang tập: {summary?.members.totalActiveMembers ?? 0} HV</span>
          </div>
        </div>

        <div className="rounded-[22px] border border-[#24242A] bg-[#141418] p-5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#8A8A93]">
              Khối lượng huấn luyện PT 1-1
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF5500]/15 text-[#FF5500]">
              <Dumbbell className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 font-mono text-[26px] font-bold tracking-tight text-[#F5F5F7]">
            {totalPtHoursInPeriod.toString().replace('.', ',')} giờ
          </p>
          <div className="mt-2 flex items-center justify-between text-[13px] text-[#8A8A93]">
            <span>{totalPtSessionsInPeriod} buổi PT hoàn thành</span>
            <span>{trainerItems.length} HLV có ca dạy</span>
          </div>
        </div>
      </section>

      {/* 3. REVENUE ANALYTICS + REVENUE BY PLAN */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left (8 cols): Revenue Bar Chart with Real VND Y-Axis */}
        <div className="rounded-[24px] border border-[#24242A] bg-[#141418] p-6 xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-[#F5F5F7]">
                Biểu đồ doanh thu theo phương thức thanh toán
              </h2>
              <p className="mt-0.5 text-[12px] text-[#8A8A93]">
                Kỳ dữ liệu: {formatDateVi(fromDate)} – {formatDateVi(toDate)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-4 text-[12px] text-[#A0A0AA]">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5500]" />
                  CK & Thẻ
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F5F5F7]" />
                  Tiền mặt
                </span>
              </div>

              <div className="inline-flex rounded-[10px] border border-[#26262D] bg-[#0E0E11] p-0.5">
                <button
                  type="button"
                  onClick={() => setGroupBy('MONTH')}
                  className={cn(
                    'rounded-[8px] px-2.5 py-1 text-[13px] font-medium transition-colors',
                    groupBy === 'MONTH'
                      ? 'bg-[#26262D] text-[#F5F5F7]'
                      : 'text-[#8A8A93] hover:text-[#F5F5F7]',
                  )}
                >
                  Theo Tháng
                </button>
                <button
                  type="button"
                  onClick={() => setGroupBy('DAY')}
                  className={cn(
                    'rounded-[8px] px-2.5 py-1 text-[13px] font-medium transition-colors',
                    groupBy === 'DAY'
                      ? 'bg-[#26262D] text-[#F5F5F7]'
                      : 'text-[#8A8A93] hover:text-[#F5F5F7]',
                  )}
                >
                  Theo Ngày
                </button>
              </div>
            </div>
          </div>

          {revenueItems.length === 0 ? (
            <div className="mt-6 flex h-[280px] items-center justify-center rounded-[18px] border border-dashed border-[#24242A] text-[13px] text-[#6B6B75]">
              Chưa có giao dịch thanh toán nào trong khoảng thời gian đã chọn.
            </div>
          ) : (
            <div className="mt-7 flex h-[280px] gap-3">
              {/* Real VND Y-Axis */}
              <div className="flex flex-col justify-between pb-7 text-right font-mono text-[13px] text-[#6B6B75]">
                {revenueYAxisTicks.map((tick, idx) => (
                  <span key={idx}>{tick}</span>
                ))}
              </div>

              {/* Plot Area */}
              <div className="relative flex flex-1 items-end justify-around gap-2 border-b border-l border-[#26262D] px-3 pb-7">
                {[0.25, 0.5, 0.75, 1].map((line) => (
                  <div
                    key={line}
                    style={{ bottom: `calc(${line * 100}% - 1.75rem)` }}
                    className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-[#222228]"
                  />
                ))}

                {revenueItems.slice(-12).map((item) => {
                  const digitalAmt =
                    item.byMethod.TRANSFER + item.byMethod.CARD;
                  const cashAmt = item.byMethod.CASH;
                  const digitalPct = Math.round(
                    (digitalAmt / maxRevenueBucket) * 100,
                  );
                  const cashPct = Math.round(
                    (cashAmt / maxRevenueBucket) * 100,
                  );
                  const label = formatTimeBucketLabel(item.timeBucket, groupBy);

                  return (
                    <div
                      key={item.timeBucket}
                      className="group relative z-10 flex h-full flex-1 flex-col items-center justify-end"
                    >
                      {/* Hover Tooltip */}
                      <div className="pointer-events-none invisible absolute -top-2 z-20 w-44 -translate-y-full rounded-[12px] border border-[#2E2E36] bg-[#0E0E11] p-2.5 text-[13px] shadow-xl group-hover:visible">
                        <p className="font-bold text-[#F5F5F7]">
                          Kỳ {item.timeBucket} ({item.paymentCount} GD)
                        </p>
                        <p className="mt-1 font-mono font-semibold text-[#FF5500]">
                          Tổng: {formatVnd(item.revenue)}
                        </p>
                        <p className="mt-0.5 text-[#9A9AA3]">
                          CK & Thẻ: {formatVnd(digitalAmt)}
                        </p>
                        <p className="text-[#9A9AA3]">
                          Tiền mặt: {formatVnd(cashAmt)}
                        </p>
                      </div>

                      {/* Value label above bar */}
                      <span className="mb-1.5 font-mono text-[13px] font-medium text-[#9A9AA3]">
                        {formatCompactVnd(item.revenue)}
                      </span>

                      <div className="flex h-[82%] w-full max-w-[30px] flex-col justify-end overflow-hidden rounded-t-[8px] bg-[#1C1C22]/50">
                        {cashPct > 0 && (
                          <div
                            style={{ height: `${Math.max(4, cashPct)}%` }}
                            className="w-full bg-[#F5F5F7] transition-all duration-300"
                          />
                        )}
                        {digitalPct > 0 && (
                          <div
                            style={{ height: `${Math.max(4, digitalPct)}%` }}
                            className="w-full bg-[#FF5500] transition-all duration-300"
                          />
                        )}
                      </div>

                      <span className="absolute -bottom-6 font-mono text-[13px] font-medium text-[#8A8A93]">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right (4 cols): Revenue Breakdown by Membership Plan */}
        <div className="flex flex-col justify-between rounded-[24px] border border-[#24242A] bg-[#141418] p-6 xl:col-span-4">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold tracking-tight text-[#F5F5F7]">
                Cơ cấu doanh thu theo gói tập
              </h2>
              <Award className="h-4 w-4 text-[#FF5500]" />
            </div>
            <p className="mt-0.5 text-[12px] text-[#8A8A93]">
              Tỷ trọng đóng góp của từng gói dịch vụ trong kỳ
            </p>

            <div className="mt-5 space-y-4">
              {!revenueReport?.byPlan || revenueReport.byPlan.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[#24242A] py-12 text-center text-[12px] text-[#6B6B75]">
                  Chưa có dữ liệu doanh thu theo gói tập trong kỳ này.
                </div>
              ) : (
                revenueReport.byPlan.map((plan) => {
                  const sharePct =
                    periodTotalRevenue > 0
                      ? Math.round((plan.revenue / periodTotalRevenue) * 1000) /
                        10
                      : 0;
                  return (
                    <div
                      key={plan.planId}
                      className="rounded-[16px] border border-[#222228] bg-[#0E0E11] p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-bold text-[#F5F5F7]">
                          {plan.planName}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] font-bold text-[#FF5500]">
                          {formatVnd(plan.revenue)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[13px] text-[#8A8A93]">
                        <span>{plan.count} lượt đăng ký / gia hạn</span>
                        <span className="font-mono">{sharePct}%</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#1C1C22]">
                        <div
                          style={{ width: `${Math.min(100, sharePct)}%` }}
                          className="h-full rounded-full bg-[#FF5500]"
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-[14px] border border-[#222228] bg-[#18181D] px-4 py-3 text-[12px]">
            <span className="text-[#8A8A93]">
              Hội viên sắp hết hạn (7 ngày)
            </span>
            <span className="font-mono font-bold text-amber-400">
              {summary?.members.expiringWithin7DaysCount ?? 0} hội viên
            </span>
          </div>
        </div>
      </section>

      {/* 4. PEAK CHECK-IN HOURS DISTRIBUTION (06:00 - 21:00) */}
      <section className="rounded-[24px] border border-[#24242A] bg-[#141418] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF5500]/15 text-[#FF5500]">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-[#F5F5F7]">
                Phân bổ lưu lượng vào cổng theo khung giờ (06:00 – 21:00)
              </h2>
              <p className="text-[12px] text-[#8A8A93]">
                Thống kê số lượt quẹt thẻ hợp lệ theo từng khung giờ trong ngày
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5 text-[12px]">
              <span className="text-[#8A8A93]">Tổng lượt vào cổng:</span>
              <strong className="font-mono text-[#F5F5F7]">
                {peakReport?.totalCheckins ?? 0} lượt
              </strong>
            </div>

            <div className="flex items-center gap-2 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5 text-[12px]">
              <span className="text-[#8A8A93]">Khung giờ đỉnh:</span>
              <strong className="font-mono text-[#FF5500]">
                {peakReport?.peakHour !== null &&
                peakReport?.peakHour !== undefined
                  ? `${String(peakReport.peakHour).padStart(2, '0')}:00`
                  : 'Chưa có'}
              </strong>
            </div>

            <div className="flex items-center gap-2 rounded-[12px] border border-[#26262D] bg-[#0E0E11] px-3 py-1.5">
              <span className="text-[13px] text-[#8A8A93]">Ngày khảo sát:</span>
              <input
                type="date"
                value={peakDate}
                onChange={(e) => setPeakDate(e.target.value)}
                aria-label="Ngày khảo sát giờ cao điểm"
                className="bg-transparent text-[12px] text-[#F5F5F7] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-7 flex h-[230px] gap-3">
          {/* Dynamic Check-in Count Y-Axis */}
          <div className="flex flex-col justify-between pb-6 text-right font-mono text-[13px] text-[#6B6B75]">
            {peakYAxisTicks.map((tick, idx) => (
              <span key={idx}>{tick}</span>
            ))}
          </div>

          <div className="relative flex flex-1 items-end justify-between gap-2 border-b border-l border-[#26262D] px-3 pb-6">
            {[0.25, 0.5, 0.75, 1].map((line) => (
              <div
                key={line}
                style={{ bottom: `calc(${line * 100}% - 1.5rem)` }}
                className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-[#222228]"
              />
            ))}

            {hourlySlots.map((slot) => {
              const heightPct = Math.round((slot.count / maxHourlyCount) * 100);
              const isPeak =
                peakReport?.peakHour !== null &&
                slot.hour === peakReport?.peakHour &&
                slot.count > 0;

              return (
                <div
                  key={slot.hour}
                  className="group relative z-10 flex h-full flex-1 flex-col items-center justify-end"
                >
                  {slot.count > 0 && (
                    <span
                      className={cn(
                        'mb-1 font-mono text-[13px] font-bold',
                        isPeak ? 'text-[#FF5500]' : 'text-[#9A9AA3]',
                      )}
                    >
                      {slot.count}
                    </span>
                  )}

                  <div className="flex h-[85%] w-full max-w-[26px] items-end rounded-t-[6px] bg-[#1C1C22]/50">
                    <div
                      style={{
                        height:
                          slot.count > 0 ? `${Math.max(6, heightPct)}%` : '0%',
                      }}
                      className={cn(
                        'w-full rounded-t-[6px] transition-all duration-300',
                        isPeak
                          ? 'bg-[#FF5500] shadow-[0_0_14px_rgba(255,85,0,0.4)]'
                          : 'bg-[#3A3A44] group-hover:bg-[#FF5500]/75',
                      )}
                    />
                  </div>

                  <span className="absolute -bottom-5 font-mono text-[13px] text-[#6B6B75]">
                    {String(slot.hour).padStart(2, '0')}h
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. DETAILED ANALYTICS TABLES: TRAINER PERFORMANCE & CLASS UTILIZATION */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left (6 cols): Trainer Performance Table */}
        <div className="rounded-[24px] border border-[#24242A] bg-[#141418] p-6 xl:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-[#F5F5F7]">
                Bảng hiệu suất huấn luyện viên PT 1-1
              </h2>
              <p className="text-[12px] text-[#8A8A93]">
                Số buổi dạy hoàn thành và tổng giờ huấn luyện thực tế trong kỳ
              </p>
            </div>
            <Link
              href="/dashboard/trainer"
              className="text-[12px] font-medium text-[#FF5500] hover:underline"
            >
              Xem đội ngũ PT
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#222228]">
                  <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                    Huấn luyện viên
                  </th>
                  <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                    Chuyên môn
                  </th>
                  <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                    Ca hoàn thành
                  </th>
                  <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                    Giờ huấn luyện
                  </th>
                  <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                    Tỷ trọng
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {trainerItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center text-[13px] text-[#6B6B75]"
                    >
                      Chưa có ca huấn luyện PT 1-1 hoàn thành trong kỳ báo cáo.
                    </td>
                  </tr>
                ) : (
                  trainerItems.map((tr) => {
                    const sharePct =
                      totalPtHoursInPeriod > 0
                        ? Math.round(
                            (tr.totalTrainingHours / totalPtHoursInPeriod) *
                              100,
                          )
                        : 0;
                    return (
                      <tr
                        key={tr.trainerId}
                        className="transition-colors hover:bg-[#19191F]/60"
                      >
                        <td className="py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF5500]/15 font-mono text-[13px] font-bold text-[#FF5500]">
                              {getInitials(tr.trainerName)}
                            </span>
                            <span className="text-[13px] font-semibold text-[#F5F5F7]">
                              {tr.trainerName}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 text-[12px] text-[#9A9AA3]">
                          {tr.specialization ?? 'Strength & Conditioning'}
                        </td>
                        <td className="py-3.5 text-right font-mono text-[12px] font-semibold text-[#F5F5F7]">
                          {tr.completedSessionsCount} buổi
                        </td>
                        <td className="py-3.5 text-right font-mono text-[12px] font-semibold text-emerald-400">
                          {tr.totalTrainingHours} giờ
                        </td>
                        <td className="py-3.5 text-right font-mono text-[12px] text-[#8A8A93]">
                          {sharePct}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right (6 cols): Group Class Utilization Table */}
        <div className="rounded-[24px] border border-[#24242A] bg-[#141418] p-6 xl:col-span-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-[#F5F5F7]">
                Tỷ lệ lấp đầy các ca lớp học nhóm
              </h2>
              <p className="text-[12px] text-[#8A8A93]">
                Đối chiếu số chỗ đặt thực tế so với sức chứa phòng tập
              </p>
            </div>
            <Link
              href="/dashboard/schedule"
              className="text-[12px] font-medium text-[#FF5500] hover:underline"
            >
              Xem lịch lớp học
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#222228]">
                  <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                    Lớp học & HLV
                  </th>
                  <th className="pb-3 text-[13px] font-medium text-[#6B6B75]">
                    Thời gian ca học
                  </th>
                  <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                    Sĩ số
                  </th>
                  <th className="pb-3 text-right text-[13px] font-medium text-[#6B6B75]">
                    Mức lấp đầy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E24]">
                {classItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-[13px] text-[#6B6B75]"
                    >
                      Chưa có ca học nhóm nào diễn ra trong khoảng thời gian đã
                      chọn.
                    </td>
                  </tr>
                ) : (
                  classItems.slice(0, 10).map((item) => (
                    <tr
                      key={item.scheduleId}
                      className="transition-colors hover:bg-[#19191F]/60"
                    >
                      <td className="py-3.5">
                        <p className="text-[13px] font-semibold text-[#F5F5F7]">
                          {item.className}
                        </p>
                        <p className="text-[13px] text-[#8A8A93]">
                          HLV: {item.instructorName}
                        </p>
                      </td>
                      <td className="py-3.5 font-mono text-[12px] text-[#9A9AA3]">
                        {formatDateTimeVi(item.startTime)}
                      </td>
                      <td className="py-3.5 text-right font-mono text-[12px] font-semibold text-[#F5F5F7]">
                        {item.bookedCount}/{item.capacity} chỗ
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#222228]">
                            <div
                              style={{
                                width: `${Math.min(100, item.utilizationRate)}%`,
                              }}
                              className={cn(
                                'h-full rounded-full',
                                item.utilizationRate >= 80
                                  ? 'bg-[#FF5500]'
                                  : item.utilizationRate >= 50
                                    ? 'bg-emerald-400'
                                    : 'bg-amber-400',
                              )}
                            />
                          </div>
                          <span className="w-11 font-mono text-[12px] font-bold text-[#F5F5F7]">
                            {item.utilizationRate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
