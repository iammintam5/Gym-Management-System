'use client';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Flame,
  LayoutGrid,
  Users,
  CreditCard,
  Calendar,
  FileBarChart,
  QrCode,
  Receipt,
  Globe,
  LogOut,
  Bell,
  ChevronDown,
  Menu,
  X,
  CheckCheck,
  UserCog,
  KeyRound,
  Lock,
  Snowflake,
  ShieldCheck,
} from 'lucide-react';
import {
  normalizePersistedUserRoles,
  UserRole,
  type AuthUserProfile,
  type EmployeeDetail,
  type MemberDetail,
  type UserNotificationsResponse,
} from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/auth-tokens';
import { ApiError, apiClient } from '@/services/api-client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
  allowedRoles: UserRole[];
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  // ADMIN Views (5 Core IronGym Screens)
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutGrid,
    exact: true,
    allowedRoles: [UserRole.ADMIN],
  },
  {
    href: '/dashboard/trainer',
    label: 'Nhân sự',
    icon: Users,
    allowedRoles: [UserRole.ADMIN],
  },
  {
    href: '/dashboard/admin',
    label: 'Gói tập',
    icon: CreditCard,
    allowedRoles: [UserRole.ADMIN],
  },
  {
    href: '/dashboard/schedule',
    label: 'Lịch lớp',
    icon: Calendar,
    allowedRoles: [UserRole.ADMIN, UserRole.STAFF, UserRole.TRAINER],
  },
  {
    href: '/dashboard/reports',
    label: 'Báo cáo',
    icon: FileBarChart,
    allowedRoles: [UserRole.ADMIN],
  },
  {
    href: '/dashboard/audit-logs',
    label: 'Nhật ký',
    icon: ShieldCheck,
    allowedRoles: [UserRole.ADMIN],
  },

  // STAFF Views (4 Dedicated Front Desk & Cashier Modules)
  {
    href: '/dashboard/staff',
    label: 'Check-in',
    icon: QrCode,
    exact: true,
    allowedRoles: [UserRole.STAFF],
  },
  {
    href: '/dashboard/staff/pos',
    label: 'Thu ngân',
    icon: Receipt,
    allowedRoles: [UserRole.STAFF, UserRole.ADMIN],
  },
  {
    href: '/dashboard/staff/members',
    label: 'Hội viên',
    icon: Users,
    allowedRoles: [UserRole.STAFF, UserRole.ADMIN],
  },
  {
    href: '/dashboard/staff/freezes',
    label: 'Bảo lưu',
    icon: Snowflake,
    allowedRoles: [UserRole.STAFF, UserRole.ADMIN],
  },

  // MEMBER Views (Member Self-Service Portal)
  {
    href: '/dashboard/member',
    label: 'Thẻ hội viên',
    icon: QrCode,
    exact: true,
    allowedRoles: [UserRole.MEMBER],
  },
  {
    href: '/dashboard/member/schedule',
    label: 'Đặt lịch tập',
    icon: Calendar,
    allowedRoles: [UserRole.MEMBER],
  },
  {
    href: '/dashboard/member/billing',
    label: 'Thanh toán',
    icon: Receipt,
    allowedRoles: [UserRole.MEMBER],
  },
];

interface ShellNotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  const diffMin = Math.max(
    1,
    Math.round((Date.now() - date.getTime()) / 60000),
  );
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  return date.toLocaleDateString('vi-VN');
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser, logout } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    ReadonlyArray<ShellNotificationItem>
  >([]);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<'profile' | 'password'>(
    'profile',
  );
  const [profileFullName, setProfileFullName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileDob, setProfileDob] = useState('');
  const [profileSpecialization, setProfileSpecialization] = useState('');
  const [profileCanTeachClasses, setProfileCanTeachClasses] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileSavedMsg, setProfileSavedMsg] = useState('');
  const [profileErrorMsg, setProfileErrorMsg] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      loadedUserIdRef.current = null;
    }

    async function fetchProfileAndNotifs() {
      const hasUsableRoles =
        !!user && normalizePersistedUserRoles(user.roles).length > 0;
      let currentUser = hasUsableRoles ? user : null;
      if (!currentUser) {
        try {
          const profile = await apiClient<AuthUserProfile>('/auth/me', {
            skipCache: true,
          });
          if (active && profile) {
            setUser(profile);
            currentUser = profile;
          }
        } catch {
          if (active) {
            clearTokens();
            logout();
            router.replace('/login');
          }
          return;
        }
      }

      if (!currentUser || !active) return;

      if (loadedUserIdRef.current === currentUser.id) {
        return;
      }
      loadedUserIdRef.current = currentUser.id;

      if (hasUsableRoles) {
        try {
          const freshProfile = await apiClient<AuthUserProfile>('/auth/me', {
            skipCache: true,
          });
          if (!active) return;
          if (freshProfile) {
            setUser(freshProfile);
            currentUser = freshProfile;
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            if (active) {
              clearTokens();
              logout();
              router.replace('/login');
            }
            return;
          }
        }
      }

      setProfileFullName(currentUser.fullName ?? '');
      setProfilePhone(currentUser.phone ?? '');

      const notifPromise = apiClient<UserNotificationsResponse>(
        '/notifications/my',
      )
        .then((notifRes) => {
          if (active) {
            setNotifications(
              notifRes.data.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                time: formatRelativeTime(n.createdAt),
                unread: !n.isRead,
              })),
            );
          }
        })
        .catch(() => {
          // Keep empty notifications when API is unreachable
        });

      const roleProfilePromise = (async () => {
        try {
          const currentRoles = normalizePersistedUserRoles(currentUser.roles);
          if (currentRoles.includes(UserRole.MEMBER)) {
            const memberMe = await apiClient<MemberDetail>('/members/me');
            if (active) {
              setProfileFullName(memberMe.fullName);
              setProfilePhone(memberMe.phone ?? '');
              if (memberMe.dateOfBirth) {
                setProfileDob(String(memberMe.dateOfBirth).slice(0, 10));
              }
            }
          } else if (
            currentRoles.includes(UserRole.TRAINER) ||
            currentRoles.includes(UserRole.STAFF)
          ) {
            const empMe = await apiClient<EmployeeDetail>('/employees/me');
            if (active) {
              setProfileFullName(empMe.fullName);
              setProfilePhone(empMe.phone ?? '');
              setProfileSpecialization(empMe.specialization ?? '');
              setProfileCanTeachClasses(Boolean(empMe.canTeachClasses));
            }
          }
        } catch {
          // Keep user defaults if role profile endpoint is unavailable
        }
      })();

      await Promise.allSettled([notifPromise, roleProfilePromise]);
    }

    void fetchProfileAndNotifs();

    return () => {
      active = false;
    };
  }, [user, setUser, logout, router]);

  const handleLogout = async () => {
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout network error and clear local tokens
    } finally {
      loadedUserIdRef.current = null;
      clearTokens();
      logout();
      router.replace('/login');
    }
  };

  const userRoles = normalizePersistedUserRoles(user?.roles);
  const isAdmin = userRoles.includes(UserRole.ADMIN);
  const isMember = userRoles.includes(UserRole.MEMBER);
  const isStaffOnly = userRoles.includes(UserRole.STAFF) && !isAdmin;
  const isPtOnly =
    userRoles.includes(UserRole.TRAINER) &&
    !isAdmin &&
    !userRoles.includes(UserRole.STAFF);
  const isTrainerOrStaff =
    userRoles.includes(UserRole.TRAINER) || userRoles.includes(UserRole.STAFF);

  const rawVisibleNavItems = NAV_ITEMS.filter((item) => {
    if (userRoles.length === 0) return false;
    return item.allowedRoles.some((r) => userRoles.includes(r));
  });

  const visibleNavItems = isStaffOnly
    ? [...rawVisibleNavItems].sort((a, b) => {
        const staffPriority: Record<string, number> = {
          '/dashboard/staff': 1,
          '/dashboard/staff/pos': 2,
          '/dashboard/staff/members': 3,
          '/dashboard/staff/freezes': 4,
          '/dashboard/schedule': 5,
        };
        return (staffPriority[a.href] ?? 99) - (staffPriority[b.href] ?? 99);
      })
    : isPtOnly
      ? [...rawVisibleNavItems].sort((a, b) => {
          const ptPriority: Record<string, number> = {
            '/dashboard/schedule': 2,
          };
          return (ptPriority[a.href] ?? 99) - (ptPriority[b.href] ?? 99);
        })
      : rawVisibleNavItems;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAccountModalOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const displayName =
    user?.fullName ||
    (user?.email ? (user.email.split('@')[0] ?? 'Người dùng') : 'Người dùng');

  const unreadCount = notifications.filter((n) => n.unread).length;

  const handleMarkAllRead = async () => {
    try {
      await apiClient('/notifications/read-all', { method: 'PATCH' });
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
    } catch {
      // Keep unread indicators until the server confirms the update.
    }
  };

  const handleMarkOneRead = async (id: string) => {
    try {
      await apiClient(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, unread: false } : n)),
      );
    } catch {
      // Keep unread indicators until the server confirms the update.
    }
  };

  const handleSaveAccountForm = async () => {
    setProfileSavedMsg('');
    setProfileErrorMsg('');
    setSavingAccount(true);

    try {
      if (accountTab === 'profile') {
        if (isMember) {
          await apiClient('/members/me', {
            method: 'PATCH',
            body: JSON.stringify({
              fullName: profileFullName,
              phone: profilePhone,
              dateOfBirth: profileDob || undefined,
            }),
          });
        } else if (isTrainerOrStaff) {
          await apiClient('/employees/me', {
            method: 'PATCH',
            body: JSON.stringify({
              fullName: profileFullName,
              phone: profilePhone,
              specialization: profileSpecialization || null,
            }),
          });
        } else if (user?.id) {
          await apiClient(`/users/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              fullName: profileFullName,
              phone: profilePhone,
            }),
          });
        }

        if (user) {
          setUser({
            ...user,
            fullName: profileFullName,
            phone: profilePhone,
          });
        }
        setProfileSavedMsg('Đã cập nhật hồ sơ cá nhân thành công.');
      } else {
        if (!currentPassword || !newPassword) {
          setProfileErrorMsg(
            'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.',
          );
          setSavingAccount(false);
          return;
        }
        if (newPassword.length < 8) {
          setProfileErrorMsg('Mật khẩu mới phải có tối thiểu 8 ký tự.');
          setSavingAccount(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setProfileErrorMsg('Mật khẩu xác nhận không khớp với mật khẩu mới.');
          setSavingAccount(false);
          return;
        }
        if (user?.id) {
          await apiClient(`/users/${user.id}/change-password`, {
            method: 'POST',
            body: JSON.stringify({
              currentPassword,
              newPassword,
            }),
          });
        }
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setProfileSavedMsg('Đã đổi mật khẩu thành công.');
      }

      setTimeout(() => {
        setProfileSavedMsg('');
        setAccountModalOpen(false);
      }, 1100);
    } catch (err) {
      setProfileErrorMsg(
        err instanceof Error ? err.message : 'Không thể lưu thay đổi lúc này.',
      );
    } finally {
      setSavingAccount(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-[#FAFAFA] flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-3 focus:text-black"
      >
        Đến nội dung chính
      </a>
      {/* Desktop Sidebar (IronGym Style) */}
      <aside className="hidden lg:flex lg:w-[240px] lg:flex-col lg:fixed lg:inset-y-0 border-r border-white/[0.06] bg-[#111114] z-30">
        {/* Top Centered Brand Block */}
        <div className="flex flex-col items-center justify-center pt-8 pb-7 px-6">
          <Link href="/" className="group flex flex-col items-center gap-2.5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF5500] text-white shadow-[0_8px_24px_rgba(255,85,0,0.35)] transition-transform group-hover:scale-105">
              <Flame className="h-6 w-6 fill-current" />
            </span>
            <span className="font-display text-lg font-bold uppercase tracking-[0.14em] text-white">
              AURA GYM
            </span>
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-[#FF5500] text-white shadow-[0_6px_20px_rgba(255,85,0,0.3)]'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Utility Links */}
        <div className="p-4 space-y-1 border-t border-white/[0.06]">
          <Link
            href="/"
            className="flex items-center gap-3.5 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span>Trang chủ</span>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3.5 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <ModalFrame
          onClose={() => setMobileMenuOpen(false)}
          label="Menu điều hướng"
          className="m-0 h-dvh max-h-none w-screen max-w-none lg:hidden"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-[240px] bg-[#111114] border-r border-white/[0.06] flex flex-col z-10">
            <div className="flex items-center justify-between px-5 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF5500] text-white">
                  <Flame className="h-5 w-5 fill-current" />
                </span>
                <span className="font-display text-base font-bold uppercase tracking-wider text-white">
                  AURA GYM
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Đóng menu điều hướng"
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-[#FF5500] text-white'
                        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="p-3 border-t border-white/[0.06] space-y-1">
              <Link
                href="/"
                className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white"
              >
                <Globe className="h-4 w-4" />
                <span>Trang chủ</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </aside>
        </ModalFrame>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:pl-[240px] min-w-0">
        {/* Seamless IronGym Top Utility Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.05] px-6 lg:px-8 bg-[#0B0B0E]/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Mở menu điều hướng"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden rounded-xl border border-white/10 bg-[#141418] p-2.5 text-zinc-300 hover:text-white"
            >
              <Menu className="h-5 w-5" />
            </button>

            {isStaffOnly && pathname !== '/dashboard/staff' && (
              <Link
                href="/dashboard/staff"
                className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#141418] px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-[#FF5500]/50 hover:text-white"
              >
                <QrCode className="h-3.5 w-3.5 text-[#FF5500]" />
                <span>Mở cổng Check-in</span>
              </Link>
            )}
          </div>

          {/* Right Utility Controls */}
          <div className="relative flex items-center gap-3">
            {/* Notifications Bell & Popover */}
            <div className="relative">
              <button
                type="button"
                aria-label="Thông báo"
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.07] bg-[#141418] text-zinc-400 transition-colors hover:border-white/15 hover:text-white"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-[#FF5500]" />
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2.5 w-80 sm:w-96 rounded-2xl border border-white/[0.08] bg-[#141418] p-4 shadow-2xl z-50">
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">
                        Thông báo
                      </span>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-[#FF5500]/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[#FF5500]">
                          {unreadCount} mới
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleMarkAllRead()}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white"
                    >
                      <CheckCheck className="h-3.5 w-3.5 text-[#FF5500]" />
                      Đánh dấu đã đọc
                    </button>
                  </div>

                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-6 text-center text-xs text-zinc-500">
                        Chưa có thông báo mới.
                      </p>
                    ) : (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void handleMarkOneRead(item.id)}
                          className={cn(
                            'flex w-full flex-col rounded-xl border p-3 text-left transition-colors',
                            item.unread
                              ? 'border-[#FF5500]/30 bg-[#18181C]'
                              : 'border-white/[0.04] bg-[#18181C]/50 opacity-75',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-white">
                              {item.title}
                            </span>
                            <span className="text-[10px] tabular-nums text-zinc-500">
                              {item.time}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                            {item.body}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile & Password Button */}
            <button
              type="button"
              onClick={() => {
                setNotifOpen(false);
                setProfileErrorMsg('');
                setProfileSavedMsg('');
                setAccountModalOpen(true);
              }}
              className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#141418] py-1.5 pl-1.5 pr-3.5 transition-colors hover:border-white/20"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FF5500] text-xs font-bold uppercase text-white">
                {displayName.charAt(0)}
              </div>
              <span className="hidden sm:inline-block text-xs font-medium text-zinc-200 capitalize">
                {displayName}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            </button>
          </div>
        </header>

        {/* Self-Service Profile & Change Password Modal */}
        {accountModalOpen && (
          <ModalFrame
            onClose={() => setAccountModalOpen(false)}
            labelledBy="components-layout-dashboard-shell-heading-0"
            maxWidthClassName="max-w-md"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                <div>
                  <h2
                    className="text-base font-bold text-white"
                    id="components-layout-dashboard-shell-heading-0"
                  >
                    Tài khoản &amp; Bảo mật
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {user?.email ?? 'Quản lý thông tin cá nhân và mật khẩu'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="rounded-lg p-1 text-zinc-400 hover:text-white"
                  aria-label="Đóng"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Tabs */}
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-[#18181C] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAccountTab('profile');
                    setProfileErrorMsg('');
                    setProfileSavedMsg('');
                  }}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all',
                    accountTab === 'profile'
                      ? 'bg-[#FF5500] text-white'
                      : 'text-zinc-400 hover:text-white',
                  )}
                >
                  <UserCog className="h-3.5 w-3.5" />
                  Hồ sơ cá nhân
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountTab('password');
                    setProfileErrorMsg('');
                    setProfileSavedMsg('');
                  }}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all',
                    accountTab === 'password'
                      ? 'bg-[#FF5500] text-white'
                      : 'text-zinc-400 hover:text-white',
                  )}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Đổi mật khẩu
                </button>
              </div>

              {accountTab === 'profile' ? (
                <div className="mt-4 space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400">
                      Họ và tên
                    </label>
                    <input
                      type="text"
                      value={profileFullName}
                      onChange={(e) => setProfileFullName(e.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs text-white focus:border-[#FF5500] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                    />
                  </div>
                  {isMember && (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400">
                          Ngày sinh
                        </label>
                        <input
                          type="date"
                          value={profileDob}
                          onChange={(e) => setProfileDob(e.target.value)}
                          className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#18181C] p-3 text-[11px] text-zinc-400">
                        <Lock className="h-3.5 w-3.5 shrink-0 text-[#FF5500]" />
                        <span>
                          Ảnh ID Check-in 3:4 đã được khóa. Vui lòng đến quầy lễ
                          tân kèm CCCD để chụp Webcam cập nhật.
                        </span>
                      </div>
                    </>
                  )}
                  {isTrainerOrStaff && (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-400">
                          {userRoles.includes(UserRole.TRAINER)
                            ? 'Chuyên môn huấn luyện'
                            : 'Ca trực / Phụ trách quầy'}
                        </label>
                        <input
                          type="text"
                          value={profileSpecialization}
                          onChange={(e) =>
                            setProfileSpecialization(e.target.value)
                          }
                          placeholder={
                            userRoles.includes(UserRole.TRAINER)
                              ? 'VD: Strength & Conditioning, HIIT...'
                              : 'VD: Lễ tân ca sáng, Thu ngân POS...'
                          }
                          className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
                        />
                      </div>
                      {userRoles.includes(UserRole.TRAINER) && (
                        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#18181C] p-3 text-[11px] text-zinc-400">
                          <Lock className="h-3.5 w-3.5 shrink-0 text-[#FF5500]" />
                          <span>
                            Dịch vụ phụ trách:{' '}
                            <strong className="text-zinc-200">
                              {profileCanTeachClasses
                                ? 'Lớp nhóm'
                                : 'Chưa nhận lớp mới'}
                            </strong>
                            . Phạm vi phụ trách dịch vụ do Quản trị viên cấp.
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400">
                      Mật khẩu hiện tại
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs text-white focus:border-[#FF5500] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400">
                      Mật khẩu mới
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Tối thiểu 8 ký tự"
                      className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs text-white focus:border-[#FF5500] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-400">
                      Xác nhận mật khẩu mới
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu mới"
                      className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-xs text-white focus:border-[#FF5500] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {profileErrorMsg && (
                <p className="mt-3 text-xs font-medium text-red-400">
                  {profileErrorMsg}
                </p>
              )}

              {profileSavedMsg && (
                <p className="mt-3 text-xs font-medium text-emerald-400">
                  {profileSavedMsg}
                </p>
              )}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-xs font-medium text-zinc-300 hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={savingAccount}
                  onClick={() => void handleSaveAccountForm()}
                  className="h-9 rounded-xl bg-[#FF5500] px-4 text-xs font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
                >
                  {savingAccount ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </div>
          </ModalFrame>
        )}

        {/* Page Content */}
        <main id="main-content" className="flex-1 px-4 pb-10 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
