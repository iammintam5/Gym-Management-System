import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type DataStateVariant =
  'dashboard' | 'table' | 'schedule' | 'cards' | 'inline';

export function DashboardSkeleton({
  variant = 'dashboard',
}: {
  variant?: DataStateVariant;
}) {
  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-label="Đang tải dữ liệu"
        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#141418] px-4 py-3 text-sm text-zinc-400"
      >
        <Loader2
          aria-hidden="true"
          className="size-4 animate-spin text-[#FF5500]"
        />
        <span>Đang đồng bộ dữ liệu…</span>
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div
        role="status"
        aria-label="Đang tải dữ liệu"
        className="grid grid-cols-1 gap-6 md:grid-cols-3"
      >
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6"
          >
            <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
            <div className="mt-4 h-8 w-40 animate-pulse rounded bg-white/[0.08]" />
            <div className="mt-6 space-y-2.5">
              <div className="h-3.5 w-full animate-pulse rounded bg-white/[0.04]" />
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-white/[0.04]" />
              <div className="h-3.5 w-3/5 animate-pulse rounded bg-white/[0.04]" />
            </div>
            <div className="mt-6 h-10 w-full animate-pulse rounded-xl bg-white/[0.06]" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'schedule') {
    return (
      <div role="status" aria-label="Đang tải lịch lớp" className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="rounded-xl border border-white/[0.06] bg-[#141418] px-4 py-3.5"
            >
              <div className="h-3 w-24 animate-pulse rounded bg-white/[0.05]" />
              <div className="mt-2.5 h-6 w-28 animate-pulse rounded bg-white/[0.08]" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#141418] p-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-28 animate-pulse rounded-lg bg-white/[0.05]" />
            <div className="h-9 w-36 animate-pulse rounded-lg bg-white/[0.05]" />
          </div>
          <div className="h-9 w-60 animate-pulse rounded-lg bg-white/[0.05]" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          {[0, 1, 2, 3, 4, 5, 6].map((col) => (
            <div
              key={col}
              className="flex min-h-[380px] flex-col rounded-xl border border-white/[0.06] bg-[#141418]"
            >
              <div className="border-b border-white/[0.06] px-3.5 py-3">
                <div className="h-3 w-12 animate-pulse rounded bg-white/[0.05]" />
                <div className="mt-2 h-5 w-16 animate-pulse rounded bg-white/[0.08]" />
              </div>
              <div className="space-y-2.5 p-2.5">
                {[0, 1].map((card) => (
                  <div
                    key={card}
                    className="rounded-lg border border-white/[0.05] bg-[#18181D] p-3"
                  >
                    <div className="h-3 w-20 animate-pulse rounded bg-white/[0.06]" />
                    <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-white/[0.08]" />
                    <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-label="Đang tải dữ liệu" className="space-y-5">
      {variant === 'dashboard' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-white/[0.06] bg-[#141418] p-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="h-3.5 w-24 animate-pulse rounded bg-white/[0.06]" />
              </div>
              <div className="mt-4 h-8 w-28 animate-pulse rounded bg-white/[0.09]" />
              <div className="mt-3 flex items-center justify-between">
                <div className="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-5 w-14 animate-pulse rounded-full bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#141418]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="h-9 w-64 animate-pulse rounded-xl bg-white/[0.05]" />
          <div className="flex items-center gap-2">
            <div className="h-9 w-28 animate-pulse rounded-xl bg-white/[0.05]" />
            <div className="h-9 w-24 animate-pulse rounded-xl bg-white/[0.05]" />
          </div>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <div className="size-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="space-y-2">
                  <div className="h-3.5 w-36 animate-pulse rounded bg-white/[0.08]" />
                  <div className="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
              <div className="hidden h-3.5 w-28 animate-pulse rounded bg-white/[0.05] sm:block" />
              <div className="hidden h-6 w-20 animate-pulse rounded-full bg-white/[0.06] md:block" />
              <div className="h-8 w-20 animate-pulse rounded-lg bg-white/[0.05]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DataState({
  loading,
  error,
  onRetry,
  variant = 'dashboard',
}: {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  variant?: DataStateVariant;
}) {
  if (!loading && !error) return null;

  if (loading) {
    return <DashboardSkeleton variant={variant} />;
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/25 bg-[#141418] p-4 text-sm text-zinc-200"
    >
      <AlertCircle
        aria-hidden="true"
        className="size-4 shrink-0 text-rose-400"
      />
      <span className="flex-1">{error}</span>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

/** Reject partial responses rather than presenting missing figures as zero. */
export function assertDataLoaded(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
  allowNotFound = false,
): void {
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      if (
        allowNotFound &&
        typeof reason === 'object' &&
        reason !== null &&
        'status' in reason &&
        reason.status === 404
      )
        continue;
      throw new Error('Không thể tải đầy đủ dữ liệu.');
    }
  }
}
