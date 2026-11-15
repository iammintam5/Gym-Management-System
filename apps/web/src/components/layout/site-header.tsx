'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { clearTokens } from '@/lib/auth-tokens';
import { apiClient } from '@/services/api-client';

export function SiteHeader() {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuthStore();

  async function handleLogout() {
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

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-900 bg-[#09090B]/90 backdrop-blur-md">
      <nav
        aria-label="Điều hướng chính"
        className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"
      >
        <Link href="/" className="flex items-center gap-2">
          <Flame className="h-5 w-5 fill-[#FF5500] text-[#FF5500]" />
          <span className="font-heading text-xl font-bold tracking-wider uppercase text-white">
            AURA<span className="text-[#FF5500]">GYM</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 text-sm text-zinc-300 md:flex">
          <Link href="/" className="transition-colors hover:text-white">
            Trang chủ
          </Link>
          <Link
            href="/#programs"
            className="transition-colors hover:text-white"
          >
            Chương trình
          </Link>
          <Link
            href="/#schedule"
            className="transition-colors hover:text-white"
          >
            Lịch tập
          </Link>
          <Link
            href="/#packages"
            className="transition-colors hover:text-white"
          >
            Bảng giá
          </Link>
          <Link
            href="/#trainers"
            className="transition-colors hover:text-white"
          >
            Huấn luyện viên
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated && user ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-[10px] bg-[#FF5500] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
              >
                Vào bảng điều khiển
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                title="Đăng xuất"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-zinc-800 px-3.5 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-[10px] bg-[#FF5500] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
