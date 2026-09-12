import Link from 'next/link';
import { PageHeader } from '@gym/ui';
import { ApiHealth } from '@/components/shared/api-health';
export default function Home() {
  return (
    <>
      <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-emerald-700">
        Gym Management System
      </p>
      <PageHeader title="Quản lý phòng tập, từ một nơi.">
        Nền tảng cho hội viên, gói tập, lớp học và huấn luyện cá nhân.
      </PageHeader>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">
          Không gian làm việc đang được xây dựng
        </h2>
        <p className="my-3 text-slate-600">
          Các chức năng nghiệp vụ sẽ được triển khai trong giai đoạn tiếp theo.
        </p>
        <ApiHealth />
        <Link
          href="/dashboard"
          className="mt-6 inline-block font-medium text-emerald-700 underline"
        >
          Mở dashboard mẫu →
        </Link>
      </div>
    </>
  );
}
