import { PublicPlansSection } from '@/features/membership-plans/public-plans-section';

const STATS = [
  { label: 'Hội viên đang hoạt động', value: '128' },
  { label: 'Lượt check-in hôm nay', value: '42' },
  { label: 'Lớp học trong tuần', value: '18' },
  { label: 'Huấn luyện viên', value: '6' },
] as const;

export default function AdminDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold uppercase text-white">
          Quản trị hệ thống
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Tổng quan hoạt động phòng tập và danh sách gói hội viên.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5"
          >
            <div className="text-xs text-zinc-400">{stat.label}</div>
            <div className="mt-2 font-heading text-3xl font-bold text-white">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="font-heading text-lg font-bold uppercase text-white">
          Danh mục gói tập hiện hành
        </h2>
        <PublicPlansSection />
      </div>
    </div>
  );
}
