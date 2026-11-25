'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  normalizePersistedUserRoles,
  UserRole,
  type LoginRequest,
  type LoginResponse,
} from '@gym/contracts';
import { ApiError, apiClient } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth-store';
import {
  setToken,
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
} from '@/lib/auth-tokens';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, EyeOff } from 'lucide-react';

const schema = z.object({
  email: z.email('Email không hợp lệ').max(254),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự').max(128),
});

const DEMO_ACCOUNTS: ReadonlyArray<{
  role: UserRole;
  label: string;
  email: string;
  password: string;
}> = [
  {
    role: UserRole.ADMIN,
    label: 'Quản trị',
    email: 'admin@gym.com',
    password: 'Admin@123456',
  },
  {
    role: UserRole.STAFF,
    label: 'Lễ tân',
    email: 'staff@gym.com',
    password: 'Staff@123456',
  },
  {
    role: UserRole.TRAINER,
    label: 'HLV',
    email: 'pt@gym.com',
    password: 'Pt@123456',
  },
  {
    role: UserRole.MEMBER,
    label: 'Hội viên',
    email: 'member@gym.com',
    password: 'Member@123456',
  },
];

export function resolveRoleDashboardPath(
  roles: readonly (UserRole | string)[],
): string {
  const normalized = normalizePersistedUserRoles(roles);
  if (normalized.includes(UserRole.ADMIN)) return '/dashboard';
  if (normalized.includes(UserRole.STAFF)) return '/dashboard/staff';
  if (normalized.includes(UserRole.TRAINER)) return '/dashboard/schedule';
  return '/dashboard/member';
}

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  function fillDemoAccount(email: string, password: string) {
    setValue('email', email, { shouldValidate: true });
    setValue('password', password, { shouldValidate: true });
    setErrorMessage(null);
  }

  async function submit(values: LoginRequest) {
    setErrorMessage(null);
    try {
      const data = await apiClient<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });

      setToken(ACCESS_TOKEN_KEY, data.tokens.accessToken);
      setToken(REFRESH_TOKEN_KEY, data.tokens.refreshToken);
      setUser(data.user);

      const next = new URLSearchParams(window.location.search).get('next');
      router.push(
        next && /^\/camera(?:\?|$)/.test(next)
          ? next
          : resolveRoleDashboardPath(data.user.roles),
      );
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : 'Không thể kết nối máy chủ. Vui lòng thử lại.',
      );
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-medium text-zinc-300"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            autoComplete="email"
            placeholder="name@gym.com"
            className="w-full rounded-lg border border-zinc-800 bg-[#0d0d0f] px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 transition-colors focus:border-[#FF5500] focus:outline-none"
            {...register('email')}
          />
          {errors.email ? (
            <p id="email-error" className="mt-1 text-sm text-red-400">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-xs font-medium text-zinc-300"
          >
            Mật khẩu
          </label>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full rounded-lg border border-zinc-800 bg-[#0d0d0f] px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 transition-colors focus:border-[#FF5500] focus:outline-none"
            {...register('password')}
          />
          <button
            type="button"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((value) => !value)}
            className="mt-2 inline-flex items-center gap-2 rounded-lg py-1 text-sm text-zinc-300"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
            {showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          </button>
          {errors.password ? (
            <p id="password-error" className="mt-1 text-sm text-red-400">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <p role="alert" className="text-xs text-red-400">
            {errorMessage}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex w-full cursor-pointer items-center justify-center gap-2 h-11 rounded-xl bg-[#FF5500] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#e04b00] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Đang đăng nhập...</span>
            </>
          ) : (
            <span>Đăng nhập</span>
          )}
        </Button>
      </form>

      {process.env.NODE_ENV !== 'production' && (
        <div className="border-t border-zinc-900 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500">Điền nhanh:</span>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => fillDemoAccount(acc.email, acc.password)}
                  className="cursor-pointer rounded border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
