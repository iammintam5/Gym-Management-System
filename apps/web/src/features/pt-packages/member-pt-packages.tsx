'use client';

import { useEffect, useState } from 'react';
import {
  PaymentStatus,
  PtPurchaseOrigin,
  PtPurchaseStatus,
  type PaginatedPtPackagePurchasesResponse,
} from '@gym/contracts';

import { TablePagination } from '@/components/shared/table-pagination';
import { apiClient } from '@/services/api-client';
import { formatVnd } from '@/lib/formatters';

const statusLabels: Record<PtPurchaseStatus, string> = {
  ACTIVE: 'Ngừng cung cấp',
  PENDING_PAYMENT: 'Chờ đối chiếu',
  EXHAUSTED: 'Đã dùng hết',
  EXPIRED: 'Hết hiệu lực',
  CANCELLED: 'Đã hủy',
  REFUNDED: 'Đã hoàn tiền',
};
const date = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function MemberPtPackages({
  memberId,
  onReceipt,
}: {
  memberId?: string;
  onReceipt?: (paymentId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedPtPackagePurchasesResponse | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [asOf, setAsOf] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      const route = memberId
        ? '/members/' + memberId + '/pt-purchases'
        : '/pt-packages/me/purchases';
      void apiClient<PaginatedPtPackagePurchasesResponse>(
        route + '?limit=5&page=' + page,
        { signal: controller.signal, skipCache: true },
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setData(result);
            setAsOf(Date.now());
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : 'Không thể tải gói PT.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [memberId, page, retry]);

  if (loading || (!error && !data?.data.length)) return null;
  return (
    <details
      aria-label="Lịch sử PT của hội viên"
      className="mt-6 border-t border-white/10 pt-5"
    >
      <summary className="cursor-pointer text-sm font-semibold text-zinc-400">
        PT 1–1 · Dữ liệu cũ
      </summary>
      <p className="mt-2 text-xs text-zinc-500">
        Giữ để đối chiếu quyền lợi và biên lai đã phát sinh. Không tiếp tục bán
        hoặc đặt lịch PT.
      </p>
      {loading ? (
        <p className="py-4 text-sm text-zinc-400">Đang tải gói PT…</p>
      ) : error ? (
        <p role="alert" className="py-4 text-sm text-amber-300">
          {error}{' '}
          <button
            className="underline"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Thử lại
          </button>
        </p>
      ) : !data?.data.length ? (
        <p className="py-4 text-sm text-zinc-400">Chưa có gói PT.</p>
      ) : (
        <>
          <div className="divide-y divide-white/5">
            {data.data.map((purchase) => (
              <article key={purchase.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-white">
                      {purchase.packageNameSnapshot}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {purchase.origin === PtPurchaseOrigin.LEGACY_BUNDLED
                        ? 'Quyền PT từ gói Gym cũ'
                        : date.format(new Date(purchase.createdAt)) +
                          ' · ' +
                          formatVnd(purchase.agreedPrice ?? 0)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {statusLabels[purchase.effectiveStatus]}
                  </span>
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs tabular-nums">
                  <div className="flex gap-2">
                    <dt className="text-zinc-500">Còn lại</dt>
                    <dd className="font-medium text-white">
                      {purchase.remaining ?? 'Không giới hạn'}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-zinc-500">Đang giữ</dt>
                    <dd className="text-zinc-300">{purchase.reserved}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-zinc-500">Đã dùng</dt>
                    <dd className="text-zinc-300">{purchase.used}</dd>
                  </div>
                </dl>
                {purchase.originalStartDate &&
                  Date.parse(purchase.originalStartDate) > asOf && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Bắt đầu{' '}
                      {date.format(new Date(purchase.originalStartDate))}
                    </p>
                  )}
                {purchase.paymentId &&
                  purchase.paymentStatus === PaymentStatus.PAID &&
                  onReceipt && (
                    <button
                      type="button"
                      onClick={() => onReceipt(purchase.paymentId!)}
                      className="mt-3 text-xs text-zinc-400 underline hover:text-white"
                    >
                      Xem biên lai
                    </button>
                  )}
              </article>
            ))}
          </div>
          <TablePagination
            currentPage={page}
            pageSize={5}
            totalItems={data.meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </details>
  );
}
