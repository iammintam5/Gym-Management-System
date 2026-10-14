'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { UserRole } from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';

const WORKSPACES = [
  {
    path: 'admin',
    title: 'Quản trị',
    summary: 'Báo cáo doanh thu, gói tập, lớp học và nhân sự.',
    allowed: [UserRole.ADMIN],
  },
  {
    path: 'staff',
    title: 'Quầy lễ tân',
    summary: 'Check-in hội viên, đăng ký gói tập và thu ngân.',
    allowed: [UserRole.ADMIN, UserRole.STAFF],
  },
  {
    path: 'trainer',
    title: 'Huấn luyện viên',
    summary: 'Lịch dạy trong tuần, ca rảnh và điểm danh học viên.',
    allowed: [UserRole.ADMIN, UserRole.PT],
  },
  {
    path: 'member',
    title: 'Hội viên',
    summary: 'Thẻ tập, số buổi còn lại và đặt lịch tập luyện.',
    allowed: [
      UserRole.ADMIN,
      UserRole.STAFF,
      UserRole.PT,
      UserRole.MEMBER,
    ],
  },
] as const;

export default function DashboardPage() {
  const { user } = useAuthStore();
  const roles = user?.roles ?? [UserRole.MEMBER];
  const accessibleWorkspaces = WORKSPACES.filter((ws) =>
    ws.allowed.some((r) => roles.includes(r)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold uppercase text-white">
          Xin chào, {user?.fullName || user?.email || 'Hội viên'}
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Chọn không gian làm việc bên dưới để bắt đầu.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {accessibleWorkspaces.map((ws) => (
          <Link
            key={ws.path}
            href={`/dashboard/${ws.path}`}
            className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5 transition-colors hover:border-[#FF5500]"
          >
            <div>
              <h2 className="text-base font-semibold text-white">
                {ws.title}
              </h2>
              <p className="mt-1 text-xs text-zinc-400">{ws.summary}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-1 group-hover:text-[#FF5500]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
