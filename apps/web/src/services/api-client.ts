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
    public readonly details?: ApiErrorBody | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

export { ApiError as ApiClientError };

type ApiClientRequestOptions = RequestInit & {
  accessToken?: string;
  _retry?: boolean;
  skipCache?: boolean;
};

interface GetCacheEntry {
  data: unknown;
  expiresAt: number;
}

let cacheGeneration = 0;
const getResponseCache = new Map<string, GetCacheEntry>();
const inflightGetRequests = new Map<string, Promise<unknown>>();

function resolveCacheTtlMs(cleanPath: string): number {
  if (
    cleanPath.startsWith('checkins/camera') ||
    cleanPath === 'members' ||
    cleanPath.startsWith('members/') ||
    cleanPath.startsWith('members?')
  ) {
    return 0;
  }
  if (
    cleanPath.startsWith('checkins') ||
    cleanPath.startsWith('notifications')
  ) {
    return 5_000;
  }
  return 20_000;
}

export function clearApiClientCache(): void {
  cacheGeneration++;
  getResponseCache.clear();
  inflightGetRequests.clear();
}

async function executeRequest<T>(
  path: string,
  options: ApiClientRequestOptions = {},
): Promise<T> {
  const { accessToken, _retry, ...init } = options;
  delete init.skipCache;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');

  const tokenToUse = accessToken ?? (await getToken(ACCESS_TOKEN_KEY));
  if (tokenToUse) headers.set('Authorization', `Bearer ${tokenToUse}`);

  const apiUrl = '/api/gym';
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
              clearApiClientCache();
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
          return executeRequest<T>(path, {
            ...options,
            accessToken: newAccessToken ?? undefined,
            _retry: true,
          });
        } catch {
          clearApiClientCache();
          clearTokens();
          useAuthStore.getState().logout();
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login';
        }
      } else {
        clearApiClientCache();
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
      body,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function baseApiClient<T>(
  path: string,
  options: ApiClientRequestOptions = {},
): Promise<T> {
  const cleanPath = path.replace(/^\//, '');
  const method = (options.method ?? 'GET').toUpperCase();

  if (method !== 'GET') {
    const isHeartbeat = cleanPath.endsWith('/heartbeat');
    if (!isHeartbeat) {
      clearApiClientCache();
    }
    const result = await executeRequest<T>(cleanPath, options);
    if (!isHeartbeat) {
      clearApiClientCache();
    }
    return result;
  }

  const ttlMs = options.skipCache ? 0 : resolveCacheTtlMs(cleanPath);
  const now = Date.now();
  for (const [key, entry] of getResponseCache) {
    if (entry.expiresAt <= now) getResponseCache.delete(key);
  }

  if (ttlMs > 0) {
    const cached = getResponseCache.get(cleanPath);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
  }

  const existingInflight = inflightGetRequests.get(cleanPath);
  if (existingInflight && !options.signal) {
    return existingInflight as Promise<T>;
  }

  const generation = cacheGeneration;
  const requestPromise = executeRequest<T>(cleanPath, options)
    .then((data) => {
      if (ttlMs > 0 && generation === cacheGeneration) {
        if (getResponseCache.size >= 64) {
          const oldest = getResponseCache.keys().next().value;
          if (oldest) getResponseCache.delete(oldest);
        }
        getResponseCache.set(cleanPath, {
          data,
          expiresAt: Date.now() + ttlMs,
        });
      }
      return data;
    })
    .finally(() => {
      if (inflightGetRequests.get(cleanPath) === requestPromise)
        inflightGetRequests.delete(cleanPath);
    });

  if (!options.signal) {
    inflightGetRequests.set(cleanPath, requestPromise);
  }

  return requestPromise;
}

export const apiClient = Object.assign(baseApiClient, {
  get<T>(path: string, options?: ApiClientRequestOptions): Promise<T> {
    return baseApiClient<T>(path, { ...options, method: 'GET' });
  },
  post<T>(
    path: string,
    body?: unknown,
    options?: ApiClientRequestOptions,
  ): Promise<T> {
    return baseApiClient<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  patch<T>(
    path: string,
    body?: unknown,
    options?: ApiClientRequestOptions,
  ): Promise<T> {
    return baseApiClient<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  put<T>(
    path: string,
    body?: unknown,
    options?: ApiClientRequestOptions,
  ): Promise<T> {
    return baseApiClient<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },
  delete<T>(path: string, options?: ApiClientRequestOptions): Promise<T> {
    return baseApiClient<T>(path, { ...options, method: 'DELETE' });
  },
});
