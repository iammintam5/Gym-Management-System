import Link from 'next/link';
import { Flame } from 'lucide-react';
import { LoginForm } from '@/features/auth/login-form';

export default function LoginPage() {
  return (
    <div className="dark grid min-h-screen bg-[#09090B] text-zinc-50 lg:grid-cols-2">
      {/* Left Column: Full-bleed Gym Photography */}
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1400&q=85"
          alt="Aura Gym"
          className="absolute inset-0 h-full w-full object-cover grayscale contrast-125"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/60 to-black/40" />

        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-2">
            <Flame className="h-5 w-5 fill-[#FF5500] text-[#FF5500]" />
            <span className="font-heading text-xl font-bold tracking-wider uppercase text-white">
              AURA<span className="text-[#FF5500]">GYM</span>
            </span>
          </Link>
        </div>

        <div className="relative z-10 max-w-md space-y-2">
          <h1 className="font-heading text-5xl leading-none font-bold uppercase text-white">
            BỨT PHÁ <span className="text-[#FF5500]">GIỚI HẠN</span>
          </h1>
          <p className="text-xs leading-relaxed text-zinc-300">
            Kỷ luật, sức mạnh và sự bền bỉ — chào mừng bạn trở lại không gian
            tập luyện chuyên nghiệp tại Aura Gym.
          </p>
        </div>
      </div>

      {/* Right Column: Clean Login Form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 lg:hidden"
            >
              <Flame className="h-5 w-5 fill-[#FF5500] text-[#FF5500]" />
              <span className="font-heading text-xl font-bold tracking-wider uppercase text-white">
                AURA<span className="text-[#FF5500]">GYM</span>
              </span>
            </Link>

            <h2 className="font-heading text-3xl font-bold uppercase text-white">
              Đăng nhập
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Nhập email và mật khẩu để tiếp tục.
            </p>
          </div>

          <LoginForm />
        </div>
      </div>
    </div>
  );
}
