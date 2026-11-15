'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  PaginatedQuotaTransactionsResponse,
  SubscriptionDetail,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export function SubscriptionQuotaHistory({ sub }: { sub: SubscriptionDetail }) {
  const [open, setOpen] = useState(false);
  const [quotaId, setQuotaId] = useState(sub.quotas[0]?.id ?? '');
  const [data, setData] = useState<PaginatedQuotaTransactionsResponse | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    if (!open || !quotaId) return;
    const current = ++sequence.current;
    void apiClient
      .get<PaginatedQuotaTransactionsResponse>(
        `/quotas/${quotaId}/transactions?limit=10&page=${page}`,
      )
      .then((response) => {
        if (sequence.current !== current) return;
        setData((previous) =>
          page === 1
            ? response
            : {
                ...response,
                data: [
                  ...new Map(
                    [...(previous?.data ?? []), ...response.data].map((row) => [
                      row.id,
                      row,
                    ]),
                  ).values(),
                ],
              },
        );
      })
      .catch((cause: unknown) => {
        if (sequence.current === current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Không thể tải lịch sử lượt tập.',
          );
      })
      .finally(() => {
        if (sequence.current === current) setLoading(false);
      });
    return () => {
      sequence.current += 1;
    };
  }, [open, quotaId, page, retry]);

  return (
    <details
      className="mt-4 text-sm"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setLoading(true);
          setError('');
        }
      }}
    >
      <summary className="w-fit cursor-pointer py-2 text-xs text-zinc-400 hover:text-white">
        Lịch sử lượt tập
      </summary>
      {open && (
        <div className="mt-2">
          <label className="flex items-center gap-3 text-xs text-zinc-400">
            Dịch vụ
            <select
              value={quotaId}
              onChange={(event) => {
                setLoading(true);
                setError('');
                setQuotaId(event.target.value);
                setPage(1);
                setData(null);
              }}
              className="min-h-9 min-w-0 rounded-lg border border-white/10 bg-[#141418] px-2 text-zinc-200"
            >
              {sub.quotas.map((quota) => (
                <option key={quota.id} value={quota.id}>
                  {quota.serviceName}
                </option>
              ))}
            </select>
          </label>
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {data?.data.map((row) => (
              <li key={row.id} className="py-3 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-200">
                    {
                      {
                        RESERVE: 'Giữ chỗ',
                        USE: 'Đã sử dụng',
                        REFUND: 'Hoàn lượt',
                        ADJUST: 'Điều chỉnh',
                      }[row.type]
                    }
                  </span>
                  <time className="text-zinc-500" dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
                <p className="mt-1 text-zinc-400">
                  {[
                    row.allocatedDelta &&
                      `Được cấp ${row.allocatedDelta > 0 ? '+' : ''}${row.allocatedDelta} buổi`,
                    row.usedDelta &&
                      `Đã dùng ${row.usedDelta > 0 ? '+' : ''}${row.usedDelta} buổi`,
                    row.reservedDelta &&
                      `Giữ chỗ ${row.reservedDelta > 0 ? '+' : ''}${row.reservedDelta} buổi`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Không thay đổi số buổi'}
                </p>
                {row.reason && (
                  <p className="mt-1 break-words text-zinc-500">{row.reason}</p>
                )}
              </li>
            ))}
          </ul>
          {loading && (
            <p role="status" className="py-3 text-xs text-zinc-500">
              Đang tải lịch sử…
            </p>
          )}
          {error && (
            <div role="alert" className="py-3 text-xs text-amber-300">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setRetry((value) => value + 1);
                }}
                className="mt-2 min-h-9 underline"
              >
                Thử lại
              </button>
            </div>
          )}
          {!loading && !error && data?.data.length === 0 && (
            <p className="py-3 text-xs text-zinc-500">
              Chưa có biến động lượt tập.
            </p>
          )}
          {!loading &&
            !error &&
            data &&
            data.meta.page < data.meta.totalPages && (
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setPage((value) => value + 1);
                }}
                className="min-h-9 text-xs text-zinc-300 hover:text-white"
              >
                Tải thêm lịch sử
              </button>
            )}
        </div>
      )}
    </details>
  );
}
