'use client';

import { useEffect, useState } from 'react';
import { FreezeStatus, type SubscriptionFreezeDetail } from '@gym/contracts';
import { apiClient } from '@/services/api-client';

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const statusLabels: Record<FreezeStatus, string> = {
  REQUESTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Đã kết thúc',
  CANCELLED: 'Đã hủy',
};

export function SubscriptionFreezeHistory({
  subscriptionId,
  endDate,
}: {
  subscriptionId: string;
  endDate: string;
}) {
  const [history, setHistory] = useState<SubscriptionFreezeDetail[] | null>(
    null,
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void apiClient
      .get<SubscriptionFreezeDetail[]>(
        `/subscriptions/${subscriptionId}/freezes`,
      )
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Không thể tải lịch sử bảo lưu.',
          );
      });
    return () => {
      active = false;
    };
  }, [subscriptionId, retry]);

  if (error)
    return (
      <div role="alert" className="text-xs text-amber-300">
        <p>{error}</p>
        <button
          type="button"
          className="min-h-9 underline"
          onClick={() => {
            setError('');
            setHistory(null);
            setRetry((value) => value + 1);
          }}
        >
          Thử lại lịch sử bảo lưu
        </button>
      </div>
    );
  if (history === null)
    return (
      <p role="status" className="text-xs text-zinc-500">
        Đang tải lịch sử bảo lưu…
      </p>
    );
  if (history.length === 0) return null;

  return (
    <section
      aria-label="Lịch sử bảo lưu"
      className="border-t border-white/[0.08] pt-4 text-xs"
    >
      <h4 className="font-medium text-zinc-300">Lịch sử bảo lưu</h4>
      <ul className="mt-2 divide-y divide-white/[0.06]">
        {history.map((freeze) => (
          <li key={freeze.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="tabular-nums text-zinc-200">
                {dateFormat.format(new Date(freeze.startsAt))} —{' '}
                {dateFormat.format(new Date(freeze.endsAt))}
              </span>
              <span className="text-zinc-500">
                {statusLabels[freeze.status]}
              </span>
            </div>
            {freeze.reason && (
              <p className="mt-1 break-words text-zinc-400">{freeze.reason}</p>
            )}
            {freeze.restoredAt && (
              <p className="mt-1 text-zinc-500">
                Khôi phục ngày {dateFormat.format(new Date(freeze.restoredAt))}
              </p>
            )}
          </li>
        ))}
      </ul>
      {history.some(
        (freeze) =>
          freeze.status === FreezeStatus.APPROVED ||
          freeze.status === FreezeStatus.COMPLETED,
      ) && (
        <p className="mt-2 text-zinc-400">
          Hạn gói hiện tại {dateFormat.format(new Date(endDate))}
        </p>
      )}
    </section>
  );
}
