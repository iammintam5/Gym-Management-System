import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS_TOKEN_KEY } from './lib/auth-tokens';

// Helper to decode JWT payload without verification (verification happens on backend)
function decodeJwt(token: string) {
  try {
    const base64Payload = token.split('.')[1];
    if (!base64Payload) return null;
    const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_KEY)?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const payload = decodeJwt(token);
    if (!payload || !payload.roles) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const roles = payload.roles as string[];

    // Basic role-based routing guards
    if (pathname.startsWith('/dashboard/admin') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    if (pathname.startsWith('/dashboard/staff') && !roles.includes('STAFF') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    if (pathname.startsWith('/dashboard/trainer') && !roles.includes('PT') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Prevent logged-in users from accessing login page
  if (pathname === '/login' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
