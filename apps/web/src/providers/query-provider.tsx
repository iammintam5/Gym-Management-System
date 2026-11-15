'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { clearApiClientCache } from '@/services/api-client';

// A new auth identity gets a new client and fresh query observers. Clearing the
// active client in an effect cancels queries that children just started mounting.
function SessionQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id);
  useEffect(() => {
    clearApiClientCache();
  }, [userId]);
  return (
    <SessionQueries key={userId ?? 'anonymous'}>{children}</SessionQueries>
  );
}
