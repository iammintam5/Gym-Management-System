import Link from 'next/link';
import { PageHeader } from '@gym/ui';
export default function Dashboard() {
  return (
    <>
      <PageHeader title="Dashboard">
        Các trang mẫu chưa chứa dữ liệu cá nhân. Chức năng dành cho từng nhóm sẽ
        được bổ sung sau.
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          ['member', 'Hội viên'],
          ['trainer', 'Huấn luyện viên'],
          ['staff', 'Nhân viên'],
          ['admin', 'Quản trị viên'],
        ].map(([path, label]) => (
          <Link
            key={path}
            href={`/dashboard/${path}`}
            className="rounded-xl border border-slate-200 bg-white p-6 font-medium hover:border-emerald-600"
          >
            {label} →
          </Link>
        ))}
      </div>
    </>
  );
}
