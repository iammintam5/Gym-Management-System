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

function getDefaultDashboardForRoles(roles: string[]): string {
  if (roles.includes('ADMIN')) return '/dashboard';
  if (roles.includes('STAFF')) return '/dashboard/staff';
  if (roles.includes('PT')) return '/dashboard/schedule';
  return '/dashboard/member';
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_KEY)?.value;
  const { pathname } = request.nextUrl;

  if (pathname === '/camera') {
    const roles = token
      ? (decodeJwt(token)?.roles as string[] | undefined)
      : undefined;
    if (!roles) {
      const login = new URL('/login', request.url);
      login.searchParams.set('next', pathname + request.nextUrl.search);
      return NextResponse.redirect(login);
    }
    if (!roles.includes('ADMIN') && !roles.includes('STAFF'))
      return NextResponse.redirect(
        new URL(getDefaultDashboardForRoles(roles), request.url),
      );
  }

  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const payload = decodeJwt(token);
    if (!payload || !payload.roles) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const roles = payload.roles as string[];
    const fallbackUrl = new URL(
      getDefaultDashboardForRoles(roles),
      request.url,
    );

    // Admin-only screens: Overview (/dashboard exact), Trainer Management, Membership Plans, Performance Reports
    if (pathname === '/dashboard' && !roles.includes('ADMIN')) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (pathname.startsWith('/dashboard/trainer') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (pathname.startsWith('/dashboard/admin') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (pathname.startsWith('/dashboard/reports') && !roles.includes('ADMIN')) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (
      pathname.startsWith('/dashboard/audit-logs') &&
      !roles.includes('ADMIN')
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // Staff & Admin screens: Gate Check-in, POS, Member Directory & Freezes
    if (
      pathname.startsWith('/dashboard/staff') &&
      !roles.includes('STAFF') &&
      !roles.includes('ADMIN')
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // PT & Admin screens: Trainer Attendance & Availability
    if (
      pathname.startsWith('/dashboard/pt') &&
      !roles.includes('PT') &&
      !roles.includes('ADMIN')
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // Schedule screen: Admin, Staff, PT
    if (
      pathname.startsWith('/dashboard/schedule') &&
      !roles.includes('ADMIN') &&
      !roles.includes('STAFF') &&
      !roles.includes('PT')
    ) {
      return NextResponse.redirect(fallbackUrl);
    }
  }

  // Prevent logged-in users from accessing login page
  if (pathname === '/login' && token) {
    const payload = decodeJwt(token);
    const roles = (payload?.roles as string[] | undefined) ?? [];
    return NextResponse.redirect(
      new URL(getDefaultDashboardForRoles(roles), request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/camera'],
};
