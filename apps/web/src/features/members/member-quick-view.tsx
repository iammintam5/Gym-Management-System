'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  SubscriptionStatus,
  type MemberDetail,
  type SubscriptionDetail,
} from '@gym/contracts';
import { ModalFrame } from '@/components/ui/modal-frame';
import { apiClient } from '@/services/api-client';

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Chưa có' : dateFormat.format(parsed);
}

export function MemberQuickView({
  memberId,
  onClose,
}: {
  memberId: string;
  onClose: () => void;
}) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void Promise.all([
        apiClient.get<MemberDetail>(`/members/${memberId}`),
        apiClient.get<SubscriptionDetail[]>(
          `/members/${memberId}/subscriptions`,
        ),
      ])
        .then(([profile, history]) => {
          if (!active) return;
          setMember(profile);
          setSubscriptions(history);
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : 'Không thể tải thông tin hội viên.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [memberId, retry]);

  const current = subscriptions.filter((sub) =>
    [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED].includes(
      sub.effectiveStatus,
    ),
  );
  const next = subscriptions
    .filter((sub) => sub.effectiveStatus === SubscriptionStatus.UPCOMING)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0];

  return (
    <ModalFrame
      placement="right"
      onClose={onClose}
      labelledBy="member-quick-view-title"
      maxWidthClassName="max-w-md"
    >
      <div className="flex h-dvh flex-col bg-[#101012] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-5">
          <h2
            id="member-quick-view-title"
            className="text-sm font-medium text-zinc-300"
          >
            Thông tin hội viên
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng thông tin hội viên"
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[#FF5500]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <p
              role="status"
              className="py-10 text-center text-sm text-zinc-400"
            >
              Đang tải thông tin…
            </p>
          ) : error ? (
            <div role="alert" className="text-sm">
              <p className="text-red-300">{error}</p>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="mt-4 text-zinc-200 underline underline-offset-4"
              >
                Thử lại
              </button>
            </div>
          ) : (
            member && (
              <>
                <div className="flex items-center gap-3">
                  {member.idPhotoUrl ? (
                    <Image
                      unoptimized
                      width={56}
                      height={56}
                      src={member.idPhotoUrl}
                      alt={member.fullName}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg text-zinc-300">
                      {member.fullName
                        .trim()
                        .split(/\s+/)
                        .slice(-2)
                        .map((part) => part[0])
                        .join('')}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="break-words text-xl font-medium tracking-tight text-white">
                      {member.fullName}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      {member.memberCode}
                    </p>
                  </div>
                </div>
                {member.phone && (
                  <p className="mt-4 text-sm text-zinc-400">{member.phone}</p>
                )}
                {!member.isActive && (
                  <p className="mt-3 text-sm text-red-300">Tài khoản đã khóa</p>
                )}
                <section
                  className="mt-7 border-t border-white/10 pt-5"
                  aria-label="Gói hiện tại"
                >
                  <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Gói hiện tại
                  </h3>
                  {current.length ? (
                    current.map((sub) => (
                      <div
                        key={sub.id}
                        className="border-b border-white/5 py-4 last:border-0"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h4 className="text-base font-medium text-white">
                            {sub.plan.name}
                          </h4>
                          <span
                            className={
                              sub.effectiveStatus ===
                              SubscriptionStatus.SUSPENDED
                                ? 'text-xs text-amber-300'
                                : 'text-xs text-emerald-400'
                            }
                          >
                            {sub.effectiveStatus ===
                            SubscriptionStatus.SUSPENDED
                              ? 'Bảo lưu'
                              : 'Đang tập'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm tabular-nums text-zinc-400">
                          {formatDate(sub.startDate)} —{' '}
                          {formatDate(sub.endDate)}
                        </p>
                        <dl className="mt-4 space-y-3 text-sm">
                          {sub.quotas.map((quota) => (
                            <div
                              key={quota.id}
                              className="flex justify-between gap-4"
                            >
                              <dt className="text-zinc-400">
                                {quota.service === 'CLASS'
                                  ? 'Lớp nhóm'
                                  : quota.service === 'PT'
                                    ? 'PT'
                                    : quota.serviceName}
                              </dt>
                              <dd className="text-right tabular-nums text-zinc-200">
                                {quota.allocated === null
                                  ? 'Không giới hạn'
                                  : `${Math.max(0, quota.allocated - quota.used - quota.reserved)} / ${quota.allocated} lượt còn lại`}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-sm text-zinc-400">
                      Chưa có gói đang sử dụng.
                    </p>
                  )}
                </section>
                {next && (
                  <section
                    className="mt-5 border-t border-white/10 pt-5"
                    aria-label="Gói tiếp theo"
                  >
                    <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Tiếp theo
                    </h3>
                    <p className="mt-3 text-sm font-medium text-zinc-200">
                      {next.plan.name}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Bắt đầu {formatDate(next.startDate)}
                    </p>
                  </section>
                )}
              </>
            )
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
