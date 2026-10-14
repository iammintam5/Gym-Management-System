import { getCookie, setCookie, deleteCookie } from 'cookies-next';

export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';

export async function getToken(key: string): Promise<string | undefined> {
  if (typeof window === 'undefined') {
    try {
      const { cookies } = await import('next/headers');
      // In Next.js 15+, cookies() is an async function
      const cookieStore = await cookies();
      return cookieStore.get(key)?.value;
    } catch {
      return undefined;
    }
  }
  return getCookie(key) as string | undefined;
}

export function setToken(key: string, value: string) {
  if (typeof window !== 'undefined') {
    setCookie(key, value, {
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
  }
}

export function clearTokens() {
  if (typeof window !== 'undefined') {
    deleteCookie(ACCESS_TOKEN_KEY);
    deleteCookie(REFRESH_TOKEN_KEY);
  }
}
