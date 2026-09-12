import { env } from '@/config/env';
import type { ApiErrorBody } from '@gym/contracts';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function apiClient<T>(
  path: string,
  options: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
    { ...init, headers },
  );
  if (!response.ok) {
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
