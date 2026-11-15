'use client';

import { formatVnd } from '@/lib/formatters';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DollarSign,
  Users,
  Dumbbell,
  Activity,
  Search,
  ChevronDown,
  TrendingUp,
  ArrowUpRight,
} from 'lucide-react';
import {
  SubscriptionStatus,
  UserRole,
  type ClassUtilizationReport,
  type DashboardSummaryReport,
  type PaginatedCheckinsResponse,
  type PaginatedEmployeesResponse,
  type PaginatedSubscriptionsResponse,
  type RevenueReportResponse,
  type TrainerPerformanceReport,
} from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/services/api-client';
import { cn } from '@/lib/utils';
import { MemberAvatar } from '@/components/shared/member-avatar';
import { DataState } from '@/components/shared/data-state';

interface KpiCardItem {
  label: string;
  value: string;
  sublabel: string;
  trend: string;
  icon: typeof DollarSign;
}

const INITIAL_KPI_CARDS: ReadonlyArray<KpiCardItem> = [
  {
    label: 'Doanh thu',
    value: '0đ',
    sublabel: 'Kỳ hiện tại',
    trend: '0,0%',
    icon: DollarSign,
  },
  {
    label: 'Hội viên',
    value: '0',
    sublabel: 'Đang hoạt động',
    trend: '0,0%',
    icon: Users,
  },
  {
    label: 'Đội ngũ PT',
    value: '0',
    sublabel: 'Coach đang dạy',
    trend: '0,0%',
    icon: Dumbbell,
  },
  {
    label: 'Lượt Check-in hôm nay',
    value: '0',
    sublabel: 'Check-in qua cổng',
    trend: '0,0%',
    icon: Activity,
  },
];

interface MonthlyRevenuePoint {
  month: string;
  digitalPct: number;
  cashPct: number;
  digitalFormatted: string;
  cashFormatted: string;
  totalFormatted: string;
}

interface PersonalTrainerCard {
  code: string;
  name: string;
  specialty: string;
  sessionsCount: string;
  hoursCount: string;
}

interface MemberRow {
  id: string;
  name: string;
  idPhotoUrl: string | null;
  expiredDate: string;
  expiredTimestamp: number;
  planName: string;
  status: 'Đang tập' | 'Sắp kích hoạt' | 'Bảo lưu' | 'Hết hạn';
  tel: string;
  lastVisited: string;
}

const TOTAL_DOTS = 80;

function formatPhoneDisplay(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw;
}

function mapEffectiveStatusLabel(
  status: SubscriptionStatus,
): 'Đang tập' | 'Sắp kích hoạt' | 'Bảo lưu' | 'Hết hạn' {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return 'Đang tập';
    case SubscriptionStatus.UPCOMING:
      return 'Sắp kích hoạt';
    case SubscriptionStatus.SUSPENDED:
      return 'Bảo lưu';
    default:
      return 'Hết hạn';
  }
}

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const router = useRouter();
  const { user } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'expired' | 'name'>('expired');
  const [kpiCards, setKpiCards] =
    useState<ReadonlyArray<KpiCardItem>>(INITIAL_KPI_CARDS);
  const [revenueAnalytics, setRevenueAnalytics] = useState<
    ReadonlyArray<MonthlyRevenuePoint>
  >([]);
  const [maxMonthlyRevenue, setMaxMonthlyRevenue] = useState(160_000_000);
  const [utilizationPct, setUtilizationPct] = useState(0);
  const [bookedClassSpots, setBookedClassSpots] = useState(0);
  const [totalClassCapacity, setTotalClassCapacity] = useState(0);
  const [trainers, setTrainers] = useState<ReadonlyArray<PersonalTrainerCard>>(
    [],
  );
  const [members, setMembers] = useState<ReadonlyArray<MemberRow>>([]);

  useEffect(() => {
    if (!user?.roles) return;
    if (user.roles.includes(UserRole.ADMIN)) return;
    if (user.roles.includes(UserRole.STAFF)) {
      router.replace('/dashboard/staff');
    } else if (user.roles.includes(UserRole.PT)) {
      router.replace('/dashboard/schedule');
    } else if (user.roles.includes(UserRole.MEMBER)) {
      router.replace('/dashboard/member');
    }
  }, [user, router]);

  useEffect(() => {
    let active = true;

    async function loadOverviewData() {
      setLoading(true);
      const [
        summaryRes,
        revenueRes,
        utilRes,
        trainerPerfRes,
        employeesRes,
        subsRes,
        checkinsRes,
      ] = await Promise.allSettled([
        apiClient<DashboardSummaryReport>('/reports/dashboard-summary'),
        apiClient<RevenueReportResponse>('/reports/revenue?groupBy=MONTH'),
        apiClient<ClassUtilizationReport>('/reports/class-utilization'),
        apiClient<TrainerPerformanceReport>('/reports/trainer-performance'),
        apiClient<PaginatedEmployeesResponse>('/employees?limit=50'),
        apiClient<PaginatedSubscriptionsResponse>('/subscriptions?limit=30'),
        apiClient<PaginatedCheckinsResponse>('/checkins?limit=50'),
      ]);

      if (!active) return;
      setLoading(false);
      if (
        [
          summaryRes,
          revenueRes,
          utilRes,
          trainerPerfRes,
          employeesRes,
          subsRes,
          checkinsRes,
        ].some((result) => result.status === 'rejected')
      ) {
        setLoadError('Không thể tải đầy đủ tổng quan. Vui lòng thử lại.');
        return;
      }
      setLoadError('');

      const activePtList =
        employeesRes.status === 'fulfilled'
          ? employeesRes.value.data.filter(
              (e) => e.roles.includes(UserRole.PT) && e.isActive,
            )
          : [];

      if (summaryRes.status === 'fulfilled') {
        const s = summaryRes.value;
        const trainerCount =
          activePtList.length > 0
            ? activePtList.length
            : trainerPerfRes.status === 'fulfilled'
              ? trainerPerfRes.value.items.length
              : 0;

        const digitalRev =
          s.financials.transferAmount + s.financials.cardAmount;
        const digitalSharePct =
          s.financials.totalRevenue > 0
            ? Math.round((digitalRev / s.financials.totalRevenue) * 100)
            : 0;

        const totalPtHours =
          trainerPerfRes.status === 'fulfilled'
            ? Math.round(
                trainerPerfRes.value.items.reduce(
                  (acc, item) => acc + item.totalTrainingHours,
                  0,
                ),
              )
            : 0;

        const avgUtilPct =
          utilRes.status === 'fulfilled'
            ? Math.round(utilRes.value.averageUtilizationRate)
            : 0;

        setKpiCards([
          {
            label: 'Doanh thu',
            value: formatVnd(s.financials.totalRevenue),
            sublabel: `Tiền mặt: ${formatVnd(s.financials.cashAmount)}`,
            trend: `CK/Thẻ ${digitalSharePct}%`,
            icon: DollarSign,
          },
          {
            label: 'Hội viên hoạt động',
            value: s.members.totalActiveMembers.toLocaleString('vi-VN'),
            sublabel: `${s.members.expiringWithin7DaysCount} gói sắp hết hạn`,
            trend: `+${s.members.newMembersCount} mới`,
            icon: Users,
          },
          {
            label: 'Đội ngũ PT',
            value: trainerCount.toLocaleString('vi-VN'),
            sublabel: `${s.operations.ptSessionsCompletedCount} ca PT 1-1 hoàn thành`,
            trend: `${totalPtHours}h dạy`,
            icon: Dumbbell,
          },
          {
            label: 'Lượt Check-in hôm nay',
            value: s.operations.totalCheckinsToday.toLocaleString('vi-VN'),
            sublabel: `${s.operations.classesConductedCount} Group Class đã mở`,
            trend: `Lấp đầy ${avgUtilPct}%`,
            icon: Activity,
          },
        ]);
      }

      if (revenueRes.status === 'fulfilled') {
        const items = revenueRes.value.items.slice(-8);
        const maxRev = Math.max(...items.map((i) => i.revenue), 1);
        setMaxMonthlyRevenue(maxRev);
        setRevenueAnalytics(
          items.map((item) => {
            const digital =
              (item.byMethod.TRANSFER ?? 0) + (item.byMethod.CARD ?? 0);
            const cash = item.byMethod.CASH ?? 0;
            return {
              month: item.timeBucket,
              digitalPct: (digital / maxRev) * 100,
              cashPct: (cash / maxRev) * 100,
              digitalFormatted: formatVnd(digital),
              cashFormatted: formatVnd(cash),
              totalFormatted: formatVnd(item.revenue),
            };
          }),
        );
      }

      if (utilRes.status === 'fulfilled') {
        const u = utilRes.value;
        const totalCap = u.items.reduce((acc, i) => acc + i.capacity, 0);
        const totalBooked = u.items.reduce((acc, i) => acc + i.bookedCount, 0);
        const pct =
          totalCap > 0
            ? Math.round((totalBooked / totalCap) * 100)
            : Math.round(u.averageUtilizationRate);
        setBookedClassSpots(totalBooked);
        setTotalClassCapacity(totalCap);
        setUtilizationPct(Math.min(100, Math.max(0, pct)));
      }

      if (trainerPerfRes.status === 'fulfilled') {
        const perfMap = new Map(
          trainerPerfRes.value.items.map((t) => [t.trainerId, t]),
        );
        const sourceList =
          activePtList.length > 0
            ? activePtList.slice(0, 4).map((emp) => {
                const perf = perfMap.get(emp.id);
                return {
                  code: emp.employeeCode,
                  name: emp.fullName,
                  specialty: emp.specialization ?? 'Huấn luyện viên cá nhân',
                  sessionsCount: String(perf?.completedSessionsCount ?? 0),
                  hoursCount: `${perf?.totalTrainingHours ?? 0} giờ`,
                };
              })
            : trainerPerfRes.value.items.slice(0, 4).map((t) => ({
                code: `EMP-${t.trainerId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
                name: t.trainerName,
                specialty: t.specialization ?? 'Huấn luyện viên cá nhân',
                sessionsCount: String(t.completedSessionsCount),
                hoursCount: `${t.totalTrainingHours} giờ`,
              }));

        setTrainers(sourceList);
      }

      if (subsRes.status === 'fulfilled') {
        const lastVisitMap = new Map<string, string>();
        if (checkinsRes.status === 'fulfilled') {
          for (const chk of checkinsRes.value.data) {
            if (!lastVisitMap.has(chk.memberId)) {
              lastVisitMap.set(
                chk.memberId,
                new Date(chk.checkedInAt).toLocaleDateString('vi-VN'),
              );
            }
          }
        }

        const mappedRows: MemberRow[] = subsRes.value.data.map((sub) => {
          const endD = new Date(sub.endDate);
          return {
            id: sub.member.memberCode,
            name: sub.member.fullName,
            idPhotoUrl: sub.member.idPhotoUrl ?? null,
            expiredDate: endD.toLocaleDateString('vi-VN'),
            expiredTimestamp: endD.getTime(),
            planName: sub.plan.name,
            status: mapEffectiveStatusLabel(sub.effectiveStatus),
            tel: formatPhoneDisplay(sub.member.phone),
            lastVisited: lastVisitMap.get(sub.memberId) ?? '—',
          };
        });
        setMembers(mappedRows);
      }
    }

    void loadOverviewData();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const occupiedDots = Math.round((utilizationPct / 100) * TOTAL_DOTS);

  const filteredMembers = [...members]
    .filter(
      (member) =>
        member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.tel.replace(/\s/g, '').includes(searchQuery.replace(/\s/g, '')),
    )
    .sort((a, b) =>
      sortBy === 'expired'
        ? a.expiredTimestamp - b.expiredTimestamp
        : a.name.localeCompare(b.name, 'vi'),
    );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
          Tổng quan vận hành Aura Gym
        </h1>
      </div>

      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
      {!loading && !loadError && (
        <>
          {/* Row 1: 4 KPI Cards (IronGym Screen 1) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium text-zinc-400">
                      {card.label}
                    </span>
                  </div>

                  <div className="mt-4 font-display text-3xl font-bold tracking-tight tabular-nums text-white">
                    {card.value}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[13px] text-zinc-500">
                      {card.sublabel}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums',
                        'bg-white/5 text-zinc-300',
                      )}
                    >
                      {card.trend}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Row 2: Revenue Analytics (8 cols) + Class & Gate Utilization Dot Matrix (4 cols) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Revenue Analytics by Payment Channel (Matches RevenueReportResponse.byMethod) */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Biểu đồ doanh thu theo kênh thanh toán
                  </h2>
                  <p className="mt-0.5 text-[13px] text-zinc-500">
                    Đối soát doanh thu thực thu theo từng kỳ
                  </p>
                </div>
                <div className="flex items-center gap-5 text-[13px] text-zinc-400">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5500]" />
                    Chuyển khoản &amp; Thẻ
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
                    Tiền mặt tại quầy
                  </span>
                </div>
              </div>

              {/* Bar Chart Grid */}
              <div className="mt-6 flex h-56 gap-3">
                {/* Y-Axis Labels (Dynamic from maxMonthlyRevenue) */}
                <div className="flex flex-col justify-between pb-6 text-[13px] tabular-nums text-zinc-500">
                  <span>{formatVnd(maxMonthlyRevenue)}</span>
                  <span>{formatVnd(maxMonthlyRevenue * 0.75)}</span>
                  <span>{formatVnd(maxMonthlyRevenue * 0.5)}</span>
                  <span>{formatVnd(maxMonthlyRevenue * 0.25)}</span>
                  <span>0đ</span>
                </div>

                {/* Bars */}
                <div
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(revenueAnalytics.length, 1)}, minmax(0, 1fr))`,
                  }}
                  className="grid flex-1 items-end gap-2 border-b border-white/[0.06] pb-2 sm:gap-4"
                >
                  {revenueAnalytics.length === 0 && (
                    <p className="self-center text-sm text-zinc-400">
                      Chưa có doanh thu trong kỳ này.
                    </p>
                  )}
                  {revenueAnalytics.map((item) => (
                    <div
                      key={item.month}
                      className="flex h-full flex-col items-center justify-end gap-2"
                    >
                      <div className="flex h-44 w-full items-end justify-center gap-1.5">
                        <div
                          className="w-2.5 rounded-t-md bg-[#FF5500] transition-all sm:w-3.5"
                          style={{ height: `${item.digitalPct}%` }}
                          title={`Chuyển khoản & Thẻ: ${item.digitalFormatted} / Tổng: ${item.totalFormatted}`}
                        />
                        <div
                          className="w-2.5 rounded-t-md bg-zinc-600/80 transition-all sm:w-3.5"
                          style={{ height: `${item.cashPct}%` }}
                          title={`Tiền mặt tại quầy: ${item.cashFormatted} / Tổng: ${item.totalFormatted}`}
                        />
                      </div>
                      <span className="text-[13px] tabular-nums text-zinc-500">
                        {item.month}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Class Utilization (10x8 Dot Matrix matched to ClassUtilizationReport) */}
            <div className="flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Tỷ lệ lấp đầy lớp học
                  </h2>
                  <p className="text-[13px] text-zinc-500">
                    Số chỗ đặt trước trên tổng sức chứa các ca học
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-zinc-400">
                  <TrendingUp className="h-4 w-4" />
                </span>
              </div>

              {/* 10x8 Dot Matrix */}
              <div className="my-5 grid grid-cols-10 gap-2.5 place-items-center">
                {Array.from({ length: TOTAL_DOTS }).map((_, idx) => {
                  const isOccupied = idx < occupiedDots;
                  return (
                    <span
                      key={idx}
                      className={cn(
                        'h-3 w-3 rounded-full transition-colors',
                        isOccupied ? 'bg-[#FF5500]' : 'bg-zinc-800',
                      )}
                    />
                  );
                })}
              </div>

              {/* Utilization Footer */}
              <div>
                <div className="flex items-center justify-between text-[13px] tabular-nums">
                  <span className="text-zinc-400">
                    {bookedClassSpots} / {totalClassCapacity} học viên{' '}
                    <strong className="ml-1 text-white">
                      {utilizationPct}%
                    </strong>
                  </span>
                  <span className="font-medium text-zinc-200">
                    {utilizationPct >= 75
                      ? 'Cao điểm'
                      : utilizationPct >= 40
                        ? 'Ổn định'
                        : 'Còn nhiều chỗ'}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-[#FF5500] transition-all"
                    style={{ width: `${utilizationPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Personal Trainer Horizontal Cards (Exact IronGym Screen 1 Layout) */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                Đội ngũ PT &amp; Coach
              </h2>
              <Link
                href="/dashboard/trainer"
                className="text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
              >
                Xem tất cả
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {trainers.map((trainer) => (
                <div
                  key={trainer.code}
                  className="group flex items-center justify-between overflow-hidden rounded-2xl border border-white/[0.06] bg-[#141418] p-4 transition-colors hover:border-white/15"
                >
                  {/* Left Info */}
                  <div className="flex flex-col justify-between pr-2">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {trainer.name}
                      </h3>
                      <span className="mt-1.5 inline-block rounded-full bg-[#FF5500] px-2.5 py-0.5 text-[13px] font-semibold text-white">
                        {trainer.specialty}
                      </span>

                      <div className="mt-2.5 flex items-center gap-3 text-[13px] tabular-nums text-zinc-400">
                        <span>
                          <strong className="text-[#FF5500]">
                            {trainer.sessionsCount}
                          </strong>{' '}
                          ca dạy
                        </span>
                        <span>
                          <strong className="text-[#FF5500]">
                            {trainer.hoursCount}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <Link
                      href="/dashboard/trainer"
                      aria-label={`Xem hồ sơ ${trainer.name}`}
                      className="mt-4 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-zinc-400 transition-colors group-hover:bg-[#FF5500] group-hover:text-white"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  {/* Use initials until a verified profile photo is available. */}
                  <MemberAvatar
                    fullName={trainer.name}
                    aspect="portrait"
                    size="lg"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Row 4: All Members Table (IronGym Screen 1 Bottom) */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <h2 className="text-base font-semibold text-white">
                Danh sách hội viên
              </h2>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm theo tên, mã thẻ, SĐT..."
                    className="h-9 w-56 rounded-xl border border-white/[0.08] bg-[#18181C] pl-9 pr-3 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSortBy((prev) =>
                      prev === 'expired' ? 'name' : 'expired',
                    )
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] text-zinc-300 hover:border-white/15"
                >
                  <span>
                    Sắp xếp:{' '}
                    {sortBy === 'expired' ? 'Ngày hết hạn' : 'Họ và tên'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                    <th className="pb-3.5 pl-3">Hội viên</th>
                    <th className="pb-3.5">Ngày hết hạn</th>
                    <th className="pb-3.5">Gói tập</th>
                    <th className="pb-3.5">Trạng thái</th>
                    <th className="pb-3.5">Số điện thoại</th>
                    <th className="pb-3.5 pr-3 text-right">
                      Check-in gần nhất
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-sm">
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-sm text-zinc-400"
                      >
                        Không có hội viên phù hợp.
                      </td>
                    </tr>
                  )}
                  {filteredMembers.map((member, index) => (
                    <tr
                      key={`${member.id}-${index}`}
                      className="transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="py-3.5 pl-3">
                        <div className="flex items-center gap-3">
                          {member.idPhotoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.idPhotoUrl}
                              alt={member.name}
                              className="h-9 w-9 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
                              {member.name.charAt(0)}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-white">
                              {member.name}
                            </p>
                            <p className="font-mono text-[13px] text-zinc-500">
                              {member.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 text-[13px] tabular-nums text-zinc-300">
                        {member.expiredDate}
                      </td>
                      <td className="py-3.5 text-[13px] font-medium text-zinc-200">
                        {member.planName}
                      </td>
                      <td className="py-3.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-medium',
                            member.status === 'Đang tập' &&
                              'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
                            member.status === 'Sắp kích hoạt' &&
                              'border-[#FF5500]/40 bg-[#FF5500]/10 text-[#FF5500]',
                            member.status === 'Bảo lưu' &&
                              'border-amber-500/40 bg-amber-500/10 text-amber-400',
                            member.status === 'Hết hạn' &&
                              'border-red-500/40 bg-red-500/10 text-red-400',
                          )}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="py-3.5 text-[13px] tabular-nums text-zinc-300">
                        {member.tel}
                      </td>
                      <td className="py-3.5 pr-3 text-right text-[13px] tabular-nums text-zinc-300">
                        {member.lastVisited}
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
