'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Flame,
  LayoutDashboard,
  Shield,
  QrCode,
  Dumbbell,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { UserRole, type AuthUserProfile } from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/auth-tokens';
import { apiClient } from '@/services/api-client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  allowedRoles: UserRole[];
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
    allowedRoles: [
      UserRole.ADMIN,
      UserRole.STAFF,
      UserRole.PT,
      UserRole.MEMBER,
    ],
  },
  {
    href: '/dashboard/admin',
    label: 'Quản trị',
    icon: Shield,
    allowedRoles: [UserRole.ADMIN],
  },
  {
    href: '/dashboard/staff',
    label: 'Quầy lễ tân',
    icon: QrCode,
    allowedRoles: [UserRole.ADMIN, UserRole.STAFF],
  },
  {
    href: '/dashboard/trainer',
    label: 'Huấn luyện viên',
    icon: Dumbbell,
    allowedRoles: [UserRole.ADMIN, UserRole.PT],
  },
  {
    href: '/dashboard/member',
    label: 'Hội viên',
    icon: User,
    allowedRoles: [
      UserRole.ADMIN,
      UserRole.STAFF,
      UserRole.PT,
      UserRole.MEMBER,
    ],
  },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function syncProfile() {
      try {
        const profile = await apiClient<AuthUserProfile>('/auth/me');
        if (active) {
          setUser(profile);
        }
      } catch {
        // Handled by 401 interceptor
      }
    }
    if (!user) {
      void syncProfile();
    }
    return () => {
      active = false;
    };
  }, [user, setUser]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore expired session error
    } finally {
      clearTokens();
      logout();
      router.push('/login');
      router.refresh();
    }
  }

  const userRoles = user?.roles ?? [UserRole.MEMBER];
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    item.allowedRoles.some((r) => userRoles.includes(r)),
  );

  return (
    <div className="dark flex min-h-screen bg-[#09090B] text-zinc-100">
      {/* Compact Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-900 bg-[#0d0d0f] transition-transform duration-200 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-zinc-900 px-5">
          <Link href="/" className="flex items-center gap-2">
            <Flame className="h-4 w-4 fill-[#FF5500] text-[#FF5500]" />
            <span className="font-heading text-lg font-bold tracking-wider uppercase text-white">
              AURA<span className="text-[#FF5500]">GYM</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1 text-zinc-400 hover:text-white lg:hidden"
            aria-label="Đóng menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-[#FF5500] text-white'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-900 p-3">
          <button
            type="button"
            disabled={isLoggingOut}
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            <span>{isLoggingOut ? 'Đang thoát...' : 'Đăng xuất'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-900 bg-[#09090B]/90 px-6 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded border border-zinc-800 p-1.5 text-zinc-300 hover:text-white lg:hidden"
              aria-label="Mở menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-zinc-200">
              Bảng điều khiển
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <span className="text-xs text-zinc-400">
                {user.fullName || user.email}
              </span>
            ) : null}
            <button
              type="button"
              disabled={isLoggingOut}
              onClick={handleLogout}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
