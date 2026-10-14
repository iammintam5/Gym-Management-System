'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@gym/ui';
import type { LoginRequest, LoginResponse } from '@gym/contracts';
import { ApiError, apiClient } from '@/services/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { setToken, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/lib/auth-tokens';
import { useRouter } from 'next/navigation';

const schema = z.object({
  email: z.email('Email không hợp lệ').max(254),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự').max(128),
});

export function LoginForm() {
  const [message, setMessage] = useState('');
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(schema) });

  async function submit(values: LoginRequest) {
    setMessage('');
    try {
      const data = await apiClient<LoginResponse>('auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      
      // Save tokens
      setToken(ACCESS_TOKEN_KEY, data.tokens.accessToken);
      setToken(REFRESH_TOKEN_KEY, data.tokens.refreshToken);
      
      // Update store
      setUser(data.user);
      
      setMessage('Đăng nhập thành công! Đang chuyển hướng...');
      router.push('/dashboard');
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Không thể kết nối tới máy chủ.',
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register('email')}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        {errors.email && (
          <p id="email-error" className="mt-1 text-sm text-red-700">
            {errors.email.message}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-sm font-medium">
          Mật khẩu
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
        {errors.password && (
          <p id="password-error" className="mt-1 text-sm text-red-700">
            {errors.password.message}
          </p>
        )}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Đang gửi…' : 'Đăng nhập'}
      </Button>
      {message && (
        <p role="status" className="text-sm text-slate-600">
          {message}
        </p>
      )}
    </form>
  );
}
