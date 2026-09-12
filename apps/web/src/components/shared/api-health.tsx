'use client';
import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@gym/contracts';
import { apiClient } from '@/services/api-client';
export function ApiHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiClient<HealthResponse>('health', { signal }),
  });
  return (
    <p role="status" className="text-sm text-slate-600">
      API:{' '}
      {query.isPending
        ? 'Đang kết nối…'
        : query.isError
          ? 'Chưa kết nối được. Hãy kiểm tra backend.'
          : query.data.status === 'ok'
            ? 'Sẵn sàng'
            : 'Phản hồi không hợp lệ'}
    </p>
  );
}
