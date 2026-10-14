'use client';

import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export function ApiHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiClient<HealthResponse>('health', { signal }),
    retry: 1,
  });

  const isOnline = !query.isPending && !query.isError && query.data?.status === 'ok';

  return (
    <div
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-[#121214] px-3.5 py-1.5 text-xs text-zinc-300"
    >
      <span
        className={`h-2 w-2 rounded-full ${
          query.isPending
            ? 'animate-pulse bg-amber-400'
            : isOnline
              ? 'bg-emerald-400'
              : 'bg-zinc-500'
        }`}
      />
      <span className="font-mono">
        API:{' '}
        {query.isPending
          ? 'Đang kết nối…'
          : isOnline
            ? 'Trực tuyến (Connected)'
            : 'Chế độ Offline Preview'}
      </span>
    </div>
  );
}
