import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { UserRole, normalizePersistedUserRoles } from '@gym/contracts';
import { ACCESS_TOKEN_KEY } from './lib/auth-tokens';

// Helper to decode JWT payload without verification (verification happens on backend)
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Payload = token.split('.')[1];
    if (!base64Payload) return null;
    const payload = Buffer.from(base64Payload, 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getDefaultDashboardForRoles(roles: readonly UserRole[]): string {
  if (roles.includes(UserRole.ADMIN)) return '/dashboard';
  if (roles.includes(UserRole.STAFF)) return '/dashboard/staff';
  if (roles.includes(UserRole.TRAINER)) return '/dashboard/schedule';
  return '/dashboard/member';
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_KEY)?.value;
  const { pathname } = request.nextUrl;

  if (pathname === '/camera') {
    const payload = token ? decodeJwt(token) : null;
    const roles = normalizePersistedUserRoles(payload?.roles);
    if (roles.length === 0) {
      const login = new URL('/login', request.url);
      login.searchParams.set('next', pathname + request.nextUrl.search);
      const response = NextResponse.redirect(login);
      if (token) response.cookies.delete(ACCESS_TOKEN_KEY);
      return response;
    }
    if (!roles.includes(UserRole.ADMIN) && !roles.includes(UserRole.STAFF)) {
      return NextResponse.redirect(
        new URL(getDefaultDashboardForRoles(roles), request.url),
      );
    }
  }

  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    const payload = decodeJwt(token);
    const roles = normalizePersistedUserRoles(payload?.roles);
    if (!payload || roles.length === 0) {
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete(ACCESS_TOKEN_KEY);
      return response;
    }

    const fallbackUrl = new URL(
      getDefaultDashboardForRoles(roles),
      request.url,
    );

    // Admin-only screens: Overview (/dashboard exact), Personnel Management, Membership Plans, Performance Reports
    if (pathname === '/dashboard' && !roles.includes(UserRole.ADMIN)) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (
      pathname.startsWith('/dashboard/trainer') &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (
      pathname.startsWith('/dashboard/admin') &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (
      pathname.startsWith('/dashboard/reports') &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }
    if (
      pathname.startsWith('/dashboard/audit-logs') &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // Staff & Admin screens: Gate Check-in, POS, Member Directory & Freezes
    if (
      pathname.startsWith('/dashboard/staff') &&
      !roles.includes(UserRole.STAFF) &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // Trainer & Admin screens: Trainer Attendance & Availability
    if (
      pathname.startsWith('/dashboard/pt') &&
      !roles.includes(UserRole.TRAINER) &&
      !roles.includes(UserRole.ADMIN)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }

    // Schedule screen: Admin, Staff, Trainer
    if (
      pathname.startsWith('/dashboard/schedule') &&
      !roles.includes(UserRole.ADMIN) &&
      !roles.includes(UserRole.STAFF) &&
      !roles.includes(UserRole.TRAINER)
    ) {
      return NextResponse.redirect(fallbackUrl);
    }
  }

  // Prevent logged-in users with valid roles from accessing login page
  if (pathname === '/login' && token) {
    const payload = decodeJwt(token);
    const roles = normalizePersistedUserRoles(payload?.roles);
    if (roles.length > 0) {
      return NextResponse.redirect(
        new URL(getDefaultDashboardForRoles(roles), request.url),
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/camera'],
};
