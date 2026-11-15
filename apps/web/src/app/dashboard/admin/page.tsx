'use client';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Zap,
  Star,
  Crown,
  SquarePen,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  ServiceTypeCode,
  SubscriptionStatus,
  type CreatePlanEntitlementInput,
  type LimitType,
  type MembershipPlanDetail,
  type PaginatedMembershipPlansResponse,
  type PaginatedSubscriptionsResponse,
  type PlanEntitlementItem,
  type RevenueReportResponse,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { cn } from '@/lib/utils';

interface MembershipPlanCardItem {
  id: string;
  name: string;
  price: number;
  priceDisplay: string;
  durationDays: number;
  description: string;
  isActive: boolean;
  popular?: boolean;
  iconBg: string;
  iconColor: string;
  icon: typeof Zap;
  entitlements: PlanEntitlementItem[];
  features: ReadonlyArray<string>;
}

function formatPriceVnd(price: number): string {
  return `${Math.round(price).toLocaleString('vi-VN')}đ`;
}

function formatDurationLabel(days: number): string {
  if (days === 30) return '1 tháng';
  if (days === 90) return '3 tháng';
  if (days === 180) return '6 tháng';
  if (days === 365) return '12 tháng';
  return `${days} ngày`;
}

function formatEntitlementHumanLabel(ent: PlanEntitlementItem): string {
  const isUnlimited = ent.limitType === 'UNLIMITED' || ent.limitValue === null;
  if (ent.service === ServiceTypeCode.GYM_ACCESS) {
    return isUnlimited
      ? 'Check-in Full Gym & Tủ đồ không giới hạn'
      : `${ent.limitValue} lượt Check-in Full Gym`;
  }
  if (ent.service === ServiceTypeCode.CLASS) {
    return isUnlimited
      ? 'Tham gia Group Class không giới hạn'
      : `${ent.limitValue} buổi Group Class`;
  }
  if (ent.service === ServiceTypeCode.PT) {
    return isUnlimited
      ? 'Tập kèm riêng PT 1-1 không giới hạn'
      : `${ent.limitValue} buổi kèm riêng PT 1-1`;
  }
  return isUnlimited
    ? `${ent.serviceName ?? ent.service}: Không giới hạn`
    : `${ent.limitValue} buổi ${ent.serviceName ?? ent.service}`;
}

interface ExpiringMemberItem {
  id: string;
  name: string;
  plan: string;
  daysLeft: string;
  idPhotoUrl: string | null;
}

interface PlanRevenueRow {
  planName: string;
  count: number;
  revenue: number;
  revenueFormatted: string;
  sharePct: number;
}

export default function MembershipPlansPage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    'All' | 'Active' | 'Inactive'
  >('All');
  const [plans, setPlans] = useState<ReadonlyArray<MembershipPlanCardItem>>([]);
  const [expiringMembers, setExpiringMembers] = useState<
    ReadonlyArray<ExpiringMemberItem>
  >([]);
  const [planRevenueRows, setPlanRevenueRows] = useState<
    ReadonlyArray<PlanRevenueRow>
  >([]);

  // Create / Edit Plan Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDurationDays, setFormDurationDays] = useState(30);
  const [formPrice, setFormPrice] = useState(500000);
  const [formGymUnlimited, setFormGymUnlimited] = useState(true);
  const [formGymAccessQuota, setFormGymAccessQuota] = useState(30);
  const [formClassLimitType, setFormClassLimitType] =
    useState<LimitType>('COUNT');
  const [formClassQuota, setFormClassQuota] = useState(12);
  const [formPtLimitType, setFormPtLimitType] = useState<LimitType>('COUNT');
  const [formPtQuota, setFormPtQuota] = useState(4);
  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const hasLoadedRef = useRef(false);

  const loadPlansData = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [plansRes, revRes, subsRes] = await Promise.allSettled([
        apiClient<PaginatedMembershipPlansResponse>(
          '/membership-plans?limit=50',
        ),
        apiClient<RevenueReportResponse>('/reports/revenue?groupBy=MONTH'),
        apiClient<PaginatedSubscriptionsResponse>('/subscriptions?limit=50'),
      ]);
      assertDataLoaded([subsRes], false);
      assertDataLoaded([revRes], false);
      assertDataLoaded([plansRes], false);

      if (plansRes.status === 'fulfilled') {
        const icons = [
          { icon: Zap, bg: 'bg-zinc-500/15', color: 'text-zinc-300' },
          { icon: Star, bg: 'bg-[#FF5500]/15', color: 'text-[#FF5500]' },
          { icon: Crown, bg: 'bg-amber-500/15', color: 'text-amber-400' },
        ];
        setPlans(
          plansRes.value.data.map((p: MembershipPlanDetail, idx: number) => {
            const style = icons[idx % icons.length] ?? icons[0]!;
            const entFeatures =
              p.entitlements.length > 0
                ? p.entitlements.map(formatEntitlementHumanLabel)
                : ['Vào cửa khu tập Gym & tủ đồ không giới hạn'];
            return {
              id: p.id,
              name: p.name,
              price: p.price,
              priceDisplay: formatPriceVnd(p.price),
              durationDays: p.durationDays,
              description:
                p.description ??
                `Trọn gói tập luyện tại CLB trong ${formatDurationLabel(p.durationDays)}`,
              isActive: p.isActive,
              popular: idx === 1,
              iconBg: style.bg,
              iconColor: style.color,
              icon: style.icon,
              entitlements: p.entitlements,
              features: [
                ...entFeatures,
                'Hỗ trợ bảo lưu gói tập từ 7–60 ngày (tối đa 2 lần)',
              ],
            };
          }),
        );
      }

      if (revRes.status === 'fulfilled') {
        const maxRev = Math.max(
          ...revRes.value.byPlan.map((bp) => bp.revenue),
          1,
        );
        setPlanRevenueRows(
          revRes.value.byPlan.map((bp) => ({
            planName: bp.planName,
            count: bp.count,
            revenue: bp.revenue,
            revenueFormatted: formatPriceVnd(bp.revenue),
            sharePct: Math.max(15, Math.round((bp.revenue / maxRev) * 95)),
          })),
        );
      }

      if (subsRes.status === 'fulfilled') {
        const now = Date.now();
        const soon = subsRes.value.data
          .filter((s) => s.effectiveStatus === SubscriptionStatus.ACTIVE)
          .map((s) => {
            const diffDays = Math.ceil(
              (new Date(s.endDate).getTime() - now) / (1000 * 60 * 60 * 24),
            );
            return { sub: s, diffDays };
          })
          .filter((item) => item.diffDays > 0 && item.diffDays <= 14)
          .sort((a, b) => a.diffDays - b.diffDays)
          .slice(0, 5);

        setExpiringMembers(
          soon.map((item) => ({
            id: item.sub.member.memberCode,
            name: item.sub.member.fullName,
            plan: item.sub.plan.name,
            daysLeft: `Còn ${item.diffDays} ngày`,
            idPhotoUrl: item.sub.member.idPhotoUrl ?? null,
          })),
        );
      }
      hasLoadedRef.current = true;
    } catch {
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlansData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPlansData]);

  const openCreateModal = () => {
    setEditingPlanId(null);
    setFormName('');
    setFormDescription('');
    setFormDurationDays(30);
    setFormPrice(500000);
    setFormGymUnlimited(true);
    setFormGymAccessQuota(30);
    setFormClassLimitType('COUNT');
    setFormClassQuota(12);
    setFormPtLimitType('COUNT');
    setFormPtQuota(4);
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditModal = (tier: MembershipPlanCardItem) => {
    setEditingPlanId(tier.id);
    setFormName(tier.name);
    setFormDescription(tier.description);
    setFormDurationDays(tier.durationDays);
    setFormPrice(tier.price);

    const gymEnt = tier.entitlements.find(
      (e) => e.service === ServiceTypeCode.GYM_ACCESS,
    );
    const classEnt = tier.entitlements.find(
      (e) => e.service === ServiceTypeCode.CLASS,
    );
    const ptEnt = tier.entitlements.find(
      (e) => e.service === ServiceTypeCode.PT,
    );

    setFormGymUnlimited(!gymEnt || gymEnt.limitType === 'UNLIMITED');
    setFormGymAccessQuota(gymEnt?.limitValue ?? tier.durationDays);
    setFormClassLimitType(classEnt?.limitType ?? 'COUNT');
    setFormClassQuota(classEnt?.limitValue ?? 12);
    setFormPtLimitType(ptEnt?.limitType ?? 'COUNT');
    setFormPtQuota(ptEnt?.limitValue ?? 4);
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSavePlan = async () => {
    if (!formName.trim() || formDurationDays <= 0 || formPrice < 0) {
      setErrorMsg(
        'Vui lòng nhập đầy đủ tên gói tập, thời hạn và đơn giá hợp lệ.',
      );
      return;
    }

    setSaving(true);
    setErrorMsg('');

    const entitlementsPayload: CreatePlanEntitlementInput[] = [
      {
        service: ServiceTypeCode.GYM_ACCESS,
        limitType: formGymUnlimited ? 'UNLIMITED' : 'COUNT',
        limitValue: formGymUnlimited ? null : Number(formGymAccessQuota),
      },
      {
        service: ServiceTypeCode.CLASS,
        limitType: formClassLimitType,
        limitValue:
          formClassLimitType === 'UNLIMITED' ? null : Number(formClassQuota),
      },
      {
        service: ServiceTypeCode.PT,
        limitType: formPtLimitType,
        limitValue:
          formPtLimitType === 'UNLIMITED' ? null : Number(formPtQuota),
      },
    ];

    try {
      if (editingPlanId) {
        await apiClient(`/membership-plans/${editingPlanId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formName,
            description: formDescription || null,
            durationDays: Number(formDurationDays),
            price: Number(formPrice),
          }),
        });
        await apiClient(`/membership-plans/${editingPlanId}/entitlements`, {
          method: 'PUT',
          body: JSON.stringify({ entitlements: entitlementsPayload }),
        });
        await loadPlansData();
        setFeedbackMsg(`Đã cập nhật gói tập "${formName}" và hạn mức dịch vụ.`);
      } else {
        await apiClient('/membership-plans', {
          method: 'POST',
          body: JSON.stringify({
            name: formName,
            description: formDescription || null,
            durationDays: Number(formDurationDays),
            price: Number(formPrice),
            isActive: true,
            entitlements: entitlementsPayload,
          }),
        });
        await loadPlansData();
        setFeedbackMsg(`Đã tạo mới gói tập "${formName}".`);
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể lưu thông tin gói tập.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePlanStatus = async (tier: MembershipPlanCardItem) => {
    const nextActive = !tier.isActive;
    try {
      await apiClient(`/membership-plans/${tier.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: nextActive }),
      });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === tier.id ? { ...p, isActive: nextActive } : p,
        ),
      );
      setFeedbackMsg(
        `Đã chuyển gói "${tier.name}" sang trạng thái ${nextActive ? 'Đang mở bán' : 'Ngừng bán'}.`,
      );
    } catch (err) {
      setFeedbackMsg(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật trạng thái gói tập.',
      );
    }
  };

  const visiblePlans = plans.filter((p) => {
    if (statusFilter === 'Active') return p.isActive;
    if (statusFilter === 'Inactive') return !p.isActive;
    return true;
  });

  const totalPlanRevenue = planRevenueRows.reduce(
    (sum, r) => sum + r.revenue,
    0,
  );

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadPlansData()}
      />
    );

  return (
    <div className="space-y-6">
      {/* Header + Status Filter + Add Plan Button */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Quản lý gói tập &amp; Dịch vụ
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          <div className="inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-[#141418] p-1">
            {(
              [
                { id: 'All', label: 'Tất cả' },
                { id: 'Active', label: 'Đang mở bán' },
                { id: 'Inactive', label: 'Ngừng bán' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all',
                  statusFilter === item.id
                    ? 'bg-white text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00]"
          >
            <span>+ Thêm gói tập mới</span>
          </button>
        </div>
      </div>

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

      {/* Row 1: Tier Pricing Cards (Real Price + Fixed DurationDays + Entitlements) */}
      <div className="grid grid-cols-1 gap-6 pt-2 lg:grid-cols-3">
        {visiblePlans.map((tier) => {
          const Icon = tier.icon;

          return (
            <div
              key={tier.id}
              className="relative flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-[#141418] p-7 transition-all hover:border-white/15"
            >
              {tier.popular && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-[#FF5500] px-4 py-1 text-[13px] font-semibold tracking-wider uppercase text-white shadow-[0_6px_16px_rgba(255,85,0,0.35)]">
                  Phổ biến nhất
                </span>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <div
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl',
                      tier.iconBg,
                      tier.iconColor,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[13px] font-semibold',
                      tier.isActive
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-400',
                    )}
                  >
                    {tier.isActive ? 'Đang mở bán' : 'Ngừng bán'}
                  </span>
                </div>

                <h2 className="mt-5 text-base font-bold text-white">
                  {tier.name}
                </h2>

                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-bold tabular-nums text-white">
                    {tier.priceDisplay}
                  </span>
                  <span className="text-[13px] font-medium text-zinc-400">
                    / {formatDurationLabel(tier.durationDays)}
                  </span>
                </div>

                <p className="mt-2 text-[13px] text-zinc-500">
                  {tier.description}
                </p>

                <ul className="mt-6 space-y-3 border-t border-white/[0.06] pt-6">
                  {tier.features.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-start gap-2.5 text-[13px] text-zinc-300"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF5500]" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8 flex items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openEditModal(tier)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-transparent px-5 text-[13px] font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/[0.04]"
                >
                  <span>Chỉnh sửa gói &amp; Quyền lợi</span>
                  <SquarePen className="h-3.5 w-3.5 text-zinc-400" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleTogglePlanStatus(tier)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] font-medium text-zinc-400 transition-colors hover:border-red-500/30 hover:text-red-400"
                >
                  {tier.isActive ? 'Tạm ẩn' : 'Mở bán'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 2: Active Subscriptions + Expiring Soon + Revenue by Plan Donut */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Card 1: Active Subscriptions & Revenue by Plan */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Doanh thu theo gói tập
            </h3>

            <div className="mt-5 space-y-4">
              {planRevenueRows.map((row, idx) => {
                const Icon = idx === 0 ? Zap : idx === 1 ? Star : Crown;
                const badgeClass =
                  idx === 0
                    ? 'bg-zinc-500/15 text-zinc-300'
                    : idx === 1
                      ? 'bg-[#FF5500]/15 text-[#FF5500]'
                      : 'bg-amber-500/15 text-amber-400';
                return (
                  <div
                    key={row.planName}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl',
                          badgeClass,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {row.planName}
                        </p>
                        <p className="text-[13px] tabular-nums text-zinc-500">
                          {row.count} lượt đăng ký
                        </p>
                      </div>
                    </div>
                    <span className="text-[13px] font-bold tabular-nums text-white">
                      {row.revenueFormatted}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-4">
            <span className="text-[13px] text-zinc-400">
              Tổng doanh thu gói tập
            </span>
            <span className="font-display text-lg font-bold tabular-nums text-[#FF5500]">
              {formatPriceVnd(totalPlanRevenue)}
            </span>
          </div>
        </div>

        {/* Card 2: Expiring Soon */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Hội viên sắp hết hạn
            </h3>
            <AlertTriangle className="h-4 w-4 text-[#FF5500]" />
          </div>

          <div className="mt-5 space-y-3.5">
            {expiringMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {member.idPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.idPhotoUrl}
                      alt={member.name}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
                      {member.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="text-[13px] font-semibold text-white">
                      {member.name}
                    </p>
                    <p className="text-[13px] text-zinc-500">{member.plan}</p>
                  </div>
                </div>

                <span className="text-[13px] font-semibold tabular-nums text-[#FF5500]">
                  {member.daysLeft}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 3: Revenue Share by Plan Donut (Dynamic SVG Arcs) */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
          <h3 className="text-sm font-semibold text-white">
            Tỷ trọng doanh thu
          </h3>

          <div className="my-4 flex items-center justify-center">
            <div className="relative flex h-40 w-40 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                <circle
                  cx="18"
                  cy="18"
                  r="13.5"
                  fill="none"
                  className="stroke-zinc-800"
                  strokeWidth="5"
                />
                {planRevenueRows.slice(0, 4).map((row, idx, arr) => {
                  const circumference = 2 * Math.PI * 13.5;
                  const strokeClasses = [
                    'stroke-zinc-400',
                    'stroke-[#FF5500]',
                    'stroke-amber-400',
                    'stroke-emerald-400',
                  ];
                  const getRatio = (rev: number) =>
                    totalPlanRevenue > 0
                      ? rev / totalPlanRevenue
                      : 1 / Math.max(arr.length, 1);
                  const arcLen = Math.max(
                    0,
                    getRatio(row.revenue) * circumference,
                  );
                  const prevLen = arr
                    .slice(0, idx)
                    .reduce(
                      (sum, prevRow) =>
                        sum +
                        Math.max(0, getRatio(prevRow.revenue) * circumference),
                      0,
                    );
                  const offset = -prevLen;
                  return (
                    <circle
                      key={row.planName}
                      cx="18"
                      cy="18"
                      r="13.5"
                      fill="none"
                      className={
                        strokeClasses[idx % strokeClasses.length] ??
                        'stroke-[#FF5500]'
                      }
                      strokeWidth="5"
                      strokeDasharray={`${arcLen.toFixed(2)} ${circumference.toFixed(2)}`}
                      strokeDashoffset={offset.toFixed(2)}
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[13px] text-zinc-400">
            {planRevenueRows.slice(0, 4).map((r, idx) => {
              const pct =
                totalPlanRevenue > 0
                  ? Math.round((r.revenue / totalPlanRevenue) * 100)
                  : 0;
              return (
                <span key={r.planName} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      idx === 0
                        ? 'bg-zinc-400'
                        : idx === 1
                          ? 'bg-[#FF5500]'
                          : idx === 2
                            ? 'bg-amber-400'
                            : 'bg-emerald-400',
                    )}
                  />
                  <span>{r.planName}</span>
                  <span className="font-mono text-[13px] tabular-nums text-zinc-500">
                    ({pct}%)
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create / Edit Plan & Entitlements Modal */}
      {modalOpen && (
        <ModalFrame
          onClose={() => setModalOpen(false)}
          labelledBy="app-dashboard-admin-page-heading-0"
          maxWidthClassName="max-w-lg"
        >
          <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <h2
                  className="text-base font-bold text-white"
                  id="app-dashboard-admin-page-heading-0"
                >
                  {editingPlanId
                    ? 'Chỉnh sửa gói tập & Quyền lợi'
                    : 'Tạo gói tập hội viên mới'}
                </h2>
                <p className="text-[13px] text-zinc-400">
                  Thiết lập thời hạn, đơn giá và hạn mức buổi tập đi kèm
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Tên gói tập
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="VD: AURA PRO"
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Thời hạn (Số ngày)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formDurationDays}
                    onChange={(e) =>
                      setFormDurationDays(Number(e.target.value))
                    }
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Đơn giá (VNĐ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={50000}
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Mô tả ngắn
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Mô tả đối tượng phù hợp với gói tập này..."
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-[#18181C] p-3.5 space-y-3">
                <p className="text-[13px] font-semibold text-white">
                  Quyền lợi dịch vụ đi kèm
                </p>

                <label className="flex items-center justify-between text-[13px] text-zinc-300">
                  <span>Vào cửa khu tập Gym &amp; tủ đồ không giới hạn</span>
                  <input
                    type="checkbox"
                    checked={formGymUnlimited}
                    onChange={(e) => setFormGymUnlimited(e.target.checked)}
                    className="h-4 w-4 accent-[#FF5500]"
                  />
                </label>

                {!formGymUnlimited && (
                  <div>
                    <label className="block text-[13px] text-zinc-400">
                      Số lượt vào cổng khu tập Gym được cấp
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={formGymAccessQuota}
                      onChange={(e) =>
                        setFormGymAccessQuota(Number(e.target.value))
                      }
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[13px] tabular-nums text-white"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[13px] text-zinc-400">
                      Chế độ lớp học nhóm (Group X)
                    </label>
                    <select
                      value={formClassLimitType}
                      onChange={(e) =>
                        setFormClassLimitType(e.target.value as LimitType)
                      }
                      aria-label="Chế độ lớp học nhóm"
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[13px] text-white"
                    >
                      <option value="COUNT">Giới hạn theo số buổi</option>
                      <option value="UNLIMITED">Không giới hạn buổi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] text-zinc-400">
                      Số buổi lớp nhóm được cấp
                    </label>
                    <input
                      type="number"
                      min={0}
                      disabled={formClassLimitType === 'UNLIMITED'}
                      value={formClassQuota}
                      onChange={(e) =>
                        setFormClassQuota(Number(e.target.value))
                      }
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[13px] tabular-nums text-white disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] text-zinc-400">
                      Chế độ tập PT 1 kèm 1
                    </label>
                    <select
                      value={formPtLimitType}
                      onChange={(e) =>
                        setFormPtLimitType(e.target.value as LimitType)
                      }
                      aria-label="Chế độ tập PT 1 kèm 1"
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[13px] text-white"
                    >
                      <option value="COUNT">Giới hạn theo số buổi</option>
                      <option value="UNLIMITED">Không giới hạn buổi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] text-zinc-400">
                      Số buổi PT 1-1 được cấp
                    </label>
                    <input
                      type="number"
                      min={0}
                      disabled={formPtLimitType === 'UNLIMITED'}
                      value={formPtQuota}
                      onChange={(e) => setFormPtQuota(Number(e.target.value))}
                      className="mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[13px] tabular-nums text-white disabled:opacity-40"
                    />
                  </div>
                </div>
              </div>

              {errorMsg && (
                <p className="text-[13px] font-medium text-red-400">
                  {errorMsg}
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300 hover:text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSavePlan()}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {saving
                  ? 'Đang lưu...'
                  : editingPlanId
                    ? 'Lưu thay đổi'
                    : 'Tạo gói tập'}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
