import { env } from '@/config/env';
import type { ApiErrorBody, TokenPair } from '@gym/contracts';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  getToken,
  setToken,
  clearTokens,
} from '@/lib/auth-tokens';
import { useAuthStore } from '@/stores/auth-store';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

export async function apiClient<T>(
  path: string,
  options: RequestInit & { accessToken?: string; _retry?: boolean } = {},
): Promise<T> {
  const { accessToken, _retry, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');

  const tokenToUse = accessToken ?? (await getToken(ACCESS_TOKEN_KEY));
  if (tokenToUse) headers.set('Authorization', `Bearer ${tokenToUse}`);

  const apiUrl = env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  const response = await fetch(`${apiUrl}/${path.replace(/^\//, '')}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    // Attempt token refresh on 401
    if (response.status === 401 && !_retry && typeof window !== 'undefined') {
      const refreshToken = await getToken(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = fetch(`${apiUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          })
            .then(async (res) => {
              if (!res.ok) throw new Error('Refresh failed');
              const data = (await res.json()) as TokenPair;
              setToken(ACCESS_TOKEN_KEY, data.accessToken);
              setToken(REFRESH_TOKEN_KEY, data.refreshToken);
              return data.accessToken;
            })
            .finally(() => {
              isRefreshing = false;
              refreshPromise = null;
            });
        }
        try {
          const newAccessToken = await refreshPromise;
          // Retry original request
          return apiClient<T>(path, {
            ...options,
            accessToken: newAccessToken ?? undefined,
            _retry: true,
          });
        } catch {
          clearTokens();
          useAuthStore.getState().logout();
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login';
        }
      } else {
        clearTokens();
        useAuthStore.getState().logout();
      }
    }

    const body = (await response
      .json()
      .catch(() => null)) as ApiErrorBody | null;
    const message = body?.message;
    throw new ApiError(
      response.status,
      Array.isArray(message)
        ? message.join(', ')
        : (message ?? `HTTP ${response.status}`),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
