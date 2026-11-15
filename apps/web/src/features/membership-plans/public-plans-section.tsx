'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MembershipPlanDetail } from '@gym/contracts';
import { DataState } from '@/components/shared/data-state';
import { apiClient } from '@/services/api-client';

function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')}đ`;
}

function formatDurationLabel(days: number): string {
  if (days === 30) return '1 tháng';
  if (days === 90) return '3 tháng';
  if (days === 180) return '6 tháng';
  if (days === 365) return '12 tháng';
  return `${days} ngày`;
}

export function PublicPlansSection() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['public-membership-plans'],
    queryFn: () =>
      apiClient<MembershipPlanDetail[]>('/membership-plans/public'),
    retry: 1,
  });

  const plans = data ?? [];

  if (isLoading) {
    return <DataState loading variant="cards" />;
  }

  if (isError)
    return (
      <DataState
        error="Không thể tải gói tập. Vui lòng thử lại."
        onRetry={() => void refetch()}
      />
    );

  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-[#09090B] p-8 text-center text-xs text-zinc-400">
        Hiện chưa có gói tập nào đang mở đăng ký.
      </div>
    );
  }

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3">
      {plans.map((plan, index) => {
        const isPopular = index === 1;
        return (
          <div
            key={plan.id}
            className={`flex flex-col justify-between rounded-xl border p-8 transition-colors ${
              isPopular
                ? 'border-[#FF5500] bg-[#121214]'
                : 'border-zinc-800 bg-[#09090B] hover:border-zinc-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-white">
                  {plan.name}
                </h3>
                {isPopular ? (
                  <span className="rounded-[7px] bg-[#FF5500]/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase text-[#FF5500]">
                    Phổ biến nhất
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                {plan.description}
              </p>

              <div className="my-6 border-b border-zinc-800/90 pb-5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-heading text-4xl font-bold tabular-nums text-white">
                    {formatVnd(plan.price)}
                  </span>
                  <span className="text-xs font-semibold text-[#FF5500]">
                    / {formatDurationLabel(plan.durationDays)}
                  </span>
                </div>
                <span className="mt-1 block text-[11px] text-zinc-500">
                  Quyền lợi bao gồm:
                </span>
              </div>

              <ul className="space-y-3 text-xs text-zinc-300">
                {plan.entitlements.map((ent) => (
                  <li key={`${plan.id}-${ent.service}`}>
                    {ent.serviceName || ent.service}
                    {ent.limitType === 'COUNT' && ent.limitValue
                      ? ` (${ent.limitValue} buổi)`
                      : ent.limitType === 'UNLIMITED'
                        ? ' (Không giới hạn)'
                        : ''}
                  </li>
                ))}
                <li>Lịch tập linh hoạt mỗi ngày</li>
                <li>Hỗ trợ bảo lưu gói tập khi bận</li>
              </ul>
            </div>

            <div className="mt-8 pt-2">
              <Link
                href="/login"
                className="inline-block rounded-[10px] bg-[#FF5500] px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Đăng ký ngay
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
