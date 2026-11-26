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
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import {
  SubscriptionStatus,
  UserRole,
  type ClassUtilizationReport,
  type DashboardSummaryReport,
  type MemberDirectorySummaryResponse,
  type MemberDirectorySubscriptionSummary,
  type PaginatedEmployeesResponse,
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
    label: 'Huấn luyện viên',
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

interface DashboardTrainerSummary {
  code: string;
  name: string;
  specialty: string;
  sessionsCount: string;
  hoursCount: string;
}

interface MemberRow {
  id: string;
  code: string;
  name: string;
  joinedDate: string;
  planName: string;
  status:
    | 'Đang tập'
    | 'Sắp kích hoạt'
    | 'Bảo lưu'
    | 'Hết hạn'
    | 'Đã hủy'
    | 'Chưa có gói'
    | 'Tạm khóa';
  tel: string;
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
): MemberRow['status'] {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return 'Đang tập';
    case SubscriptionStatus.UPCOMING:
      return 'Sắp kích hoạt';
    case SubscriptionStatus.SUSPENDED:
      return 'Bảo lưu';
    case SubscriptionStatus.CANCELLED:
      return 'Đã hủy';
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
  const isAdminViewer = user?.roles?.includes(UserRole.ADMIN) ?? false;
  const [kpiCards, setKpiCards] =
    useState<ReadonlyArray<KpiCardItem>>(INITIAL_KPI_CARDS);
  const [revenueAnalytics, setRevenueAnalytics] = useState<
    ReadonlyArray<MonthlyRevenuePoint>
  >([]);
  const [maxMonthlyRevenue, setMaxMonthlyRevenue] = useState(160_000_000);
  const [utilizationPct, setUtilizationPct] = useState(0);
  const [bookedClassSpots, setBookedClassSpots] = useState(0);
  const [totalClassCapacity, setTotalClassCapacity] = useState(0);
  const [trainers, setTrainers] = useState<
    ReadonlyArray<DashboardTrainerSummary>
  >([]);
  const [members, setMembers] = useState<ReadonlyArray<MemberRow>>([]);

  useEffect(() => {
    if (!user?.roles) return;
    if (user.roles.includes(UserRole.ADMIN)) return;
    if (user.roles.includes(UserRole.STAFF)) {
      router.replace('/dashboard/staff');
    } else if (user.roles.includes(UserRole.TRAINER)) {
      router.replace('/dashboard/schedule');
    } else if (user.roles.includes(UserRole.MEMBER)) {
      router.replace('/dashboard/member');
    }
  }, [user, router]);

  useEffect(() => {
    if (!isAdminViewer) return;
    let active = true;

    async function loadOverviewData() {
      setLoading(true);
      const [
        summaryRes,
        revenueRes,
        utilRes,
        trainerPerfRes,
        employeesRes,
        membersRes,
      ] = await Promise.allSettled([
        apiClient<DashboardSummaryReport>('/reports/dashboard-summary'),
        apiClient<RevenueReportResponse>('/reports/revenue?groupBy=MONTH'),
        apiClient<ClassUtilizationReport>('/reports/class-utilization'),
        apiClient<TrainerPerformanceReport>('/reports/trainer-performance'),
        apiClient<PaginatedEmployeesResponse>('/employees?limit=50'),
        apiClient<MemberDirectorySummaryResponse>(
          '/members/directory?summary=true&limit=5&sortBy=createdAt&sortOrder=desc&includePhoto=false',
        ),
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
          membersRes,
        ].some((result) => result.status === 'rejected')
      ) {
        setLoadError('Không thể tải đầy đủ tổng quan. Vui lòng thử lại.');
        return;
      }
      setLoadError('');

      const activePtList =
        employeesRes.status === 'fulfilled'
          ? employeesRes.value.data.filter(
              (e) => e.roles.includes(UserRole.TRAINER) && e.isActive,
            )
          : [];

      if (summaryRes.status === 'fulfilled') {
        const s = summaryRes.value;
        const trainerCount = activePtList.length;

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
            label: 'Huấn luyện viên',
            value: trainerCount.toLocaleString('vi-VN'),
            sublabel: `${s.operations.classesConductedCount} ca lớp trong tháng`,
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
        const sourceList = activePtList.slice(0, 4).map((emp) => {
          const perf = perfMap.get(emp.id);
          return {
            code: emp.employeeCode,
            name: emp.fullName,
            specialty: emp.specialties.length
              ? emp.specialties.join(', ')
              : emp.specialization || 'Chưa cập nhật chuyên môn',
            sessionsCount: String(perf?.completedSessionsCount ?? 0),
            hoursCount: String(perf?.totalTrainingHours ?? 0) + ' giờ',
          };
        });

        setTrainers(sourceList);
      }

      if (membersRes.status === 'fulfilled') {
        const priority: Record<SubscriptionStatus, number> = {
          ACTIVE: 0,
          SUSPENDED: 1,
          UPCOMING: 2,
          EXPIRED: 3,
          CANCELLED: 4,
        };
        const currentPlan = new Map<
          string,
          MemberDirectorySubscriptionSummary
        >();
        for (const sub of membersRes.value.subscriptions) {
          const existing = currentPlan.get(sub.memberId);
          if (
            !existing ||
            priority[sub.effectiveStatus] <
              priority[existing.effectiveStatus] ||
            (priority[sub.effectiveStatus] ===
              priority[existing.effectiveStatus] &&
              new Date(sub.endDate).getTime() >
                new Date(existing.endDate).getTime())
          ) {
            currentPlan.set(sub.memberId, sub);
          }
        }
        setMembers(
          membersRes.value.data.slice(0, 5).map((member) => {
            const sub = currentPlan.get(member.id);
            return {
              id: member.id,
              code: member.memberCode,
              name: member.fullName,
              joinedDate: new Date(member.createdAt).toLocaleDateString(
                'vi-VN',
                { timeZone: 'Asia/Ho_Chi_Minh' },
              ),
              planName: sub?.plan.name ?? 'Chưa đăng ký',
              status: !member.isActive
                ? 'Tạm khóa'
                : sub
                  ? mapEffectiveStatusLabel(sub.effectiveStatus)
                  : 'Chưa có gói',
              tel: formatPhoneDisplay(member.phone),
            };
          }),
        );
      }
    }

    void loadOverviewData();

    return () => {
      active = false;
    };
  }, [reloadKey, isAdminViewer]);

  const occupiedDots = Math.round((utilizationPct / 100) * TOTAL_DOTS);

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
                Đội ngũ huấn luyện viên
              </h2>
              <Link
                href="/dashboard/trainer"
                className="text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
              >
                Xem tất cả
              </Link>
            </div>

            {trainers.length === 0 ? (
              <p className="py-5 text-sm text-zinc-500">
                Chưa có huấn luyện viên đang hoạt động.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {trainers.map((trainer) => (
                  <article
                    key={trainer.code}
                    className="min-w-0 rounded-xl border border-white/[0.06] bg-[#141418] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <MemberAvatar fullName={trainer.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold leading-5 text-white">
                          {trainer.name}
                        </h3>
                        <p
                          title={trainer.specialty}
                          className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400"
                        >
                          {trainer.specialty}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-xs tabular-nums text-zinc-500">
                      <span>
                        <strong className="font-medium text-zinc-200">
                          {trainer.sessionsCount}
                        </strong>{' '}
                        ca dạy
                      </span>
                      <span className="font-medium text-zinc-200">
                        {trainer.hoursCount}
                      </span>
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Recent member registrations; full management lives in the member directory. */}
          <section
            className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5 sm:p-6"
            aria-labelledby="recent-members-heading"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2
                id="recent-members-heading"
                className="text-base font-semibold text-white"
              >
                Hội viên mới
              </h2>
              <Link
                href="/dashboard/staff/members"
                className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
              >
                Xem tất cả
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table
                aria-label="Hội viên mới"
                className="w-full min-w-[640px] border-collapse text-left text-[13px] [&_th]:pb-3 [&_th]:pr-5 [&_td]:py-3.5 [&_td]:pr-5 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0"
              >
                <thead>
                  <tr className="border-b border-white/[0.06] text-xs font-medium text-zinc-500">
                    <th>Hội viên</th>
                    <th>Ngày tham gia</th>
                    <th>Gói tập</th>
                    <th>Trạng thái</th>
                    <th className="text-right">Số điện thoại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-zinc-500">
                        Chưa có hội viên.
                      </td>
                    </tr>
                  )}
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <MemberAvatar fullName={member.name} size="sm" />
                          <div>
                            <p className="font-medium text-zinc-100">
                              {member.name}
                            </p>
                            <p className="mt-0.5 font-mono text-xs text-zinc-500">
                              {member.code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-zinc-400">
                        {member.joinedDate}
                      </td>
                      <td className="text-zinc-300">{member.planName}</td>
                      <td>
                        <span
                          className={cn(
                            'whitespace-nowrap text-xs',
                            member.status === 'Đang tập'
                              ? 'text-emerald-400'
                              : member.status === 'Bảo lưu'
                                ? 'text-amber-400'
                                : member.status === 'Hết hạn' ||
                                    member.status === 'Đã hủy' ||
                                    member.status === 'Tạm khóa'
                                  ? 'text-zinc-500'
                                  : 'text-zinc-400',
                          )}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums text-zinc-400">
                        {member.tel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
