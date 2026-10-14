'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { MembershipPlanDetail } from '@gym/contracts';
import { apiClient } from '@/services/api-client';

const FALLBACK_PLANS: ReadonlyArray<MembershipPlanDetail> = [
  {
    id: 'fallback-basic',
    name: 'Basic Plan',
    description:
      'Dành cho người mới bắt đầu — rèn luyện nền tảng với đầy đủ trang thiết bị tiêu chuẩn.',
    durationDays: 30,
    price: 590000,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entitlements: [
      {
        service: 'GYM_ACCESS',
        serviceName: 'Sử dụng toàn bộ thiết bị phòng tập',
        limitType: 'UNLIMITED',
        limitValue: null,
      },
      {
        service: 'CLASS',
        serviceName: 'Lớp tập nhóm tiêu chuẩn',
        limitType: 'COUNT',
        limitValue: 4,
      },
    ],
  },
  {
    id: 'fallback-regular',
    name: 'Regular Plan',
    description:
      'Lựa chọn cân bằng giữa tập luyện tự do, lớp học nhóm và định hướng cùng huấn luyện viên.',
    durationDays: 90,
    price: 1490000,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entitlements: [
      {
        service: 'GYM_ACCESS',
        serviceName: 'Sử dụng toàn bộ thiết bị phòng tập',
        limitType: 'UNLIMITED',
        limitValue: null,
      },
      {
        service: 'CLASS',
        serviceName: 'Lớp tập nhóm HIIT, Yoga & Cycling',
        limitType: 'COUNT',
        limitValue: 16,
      },
      {
        service: 'PT',
        serviceName: 'Huấn luyện cá nhân 1-1',
        limitType: 'COUNT',
        limitValue: 4,
      },
    ],
  },
  {
    id: 'fallback-premium',
    name: 'Premium Plan',
    description:
      'Trải nghiệm toàn diện — huấn luyện cá nhân chuyên sâu và không giới hạn các lớp tập nhóm.',
    durationDays: 180,
    price: 2790000,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entitlements: [
      {
        service: 'GYM_ACCESS',
        serviceName: 'Sử dụng toàn bộ thiết bị phòng tập',
        limitType: 'UNLIMITED',
        limitValue: null,
      },
      {
        service: 'CLASS',
        serviceName: 'Tham gia tất cả lớp tập nhóm',
        limitType: 'UNLIMITED',
        limitValue: null,
      },
      {
        service: 'PT',
        serviceName: 'Huấn luyện cá nhân 1-1',
        limitType: 'COUNT',
        limitValue: 16,
      },
    ],
  },
];

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

export function PublicPlansSection() {
  const { data } = useQuery({
    queryKey: ['public-membership-plans'],
    queryFn: () => apiClient<MembershipPlanDetail[]>('/membership-plans/public'),
    retry: 1,
  });

  const plans = data && data.length > 0 ? data : FALLBACK_PLANS;

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3">
      {plans.map((plan, index) => {
        const isPopular = index === 1;
        return (
          <div
            key={plan.id}
            className={`flex flex-col justify-between border p-8 transition-colors ${
              isPopular
                ? 'border-[#FF5500] bg-[#0d0d0f]'
                : 'border-zinc-800 bg-[#09090B] hover:border-zinc-700'
            }`}
          >
            <div>
              {isPopular ? (
                <span className="mb-4 inline-block bg-white px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase text-[#FF5500]">
                  POPULAR
                </span>
              ) : null}

              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                {plan.description}
              </p>

              <div className="my-6 border-b border-zinc-800/90 pb-5">
                <div className="flex items-baseline gap-1">
                  <span className="font-heading text-4xl font-bold text-white">
                    {formatVnd(plan.price)}
                  </span>
                  <span className="text-[11px] font-semibold uppercase text-[#FF5500]">
                    / {plan.durationDays} ngày
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
                className="inline-block rounded-full bg-[#FF5500] px-6 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Join Now
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
