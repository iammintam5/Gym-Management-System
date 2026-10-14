export default function MemberDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold uppercase text-white">
          Hội viên
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Thông tin gói tập hiện tại và số buổi còn lại.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <div className="text-xs text-zinc-400">Gói tập hiện tại</div>
          <div className="mt-2 font-heading text-2xl font-bold text-white">
            Regular Plan
          </div>
          <div className="mt-1 text-xs text-[#FF5500]">Đang hoạt động</div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <div className="text-xs text-zinc-400">Lớp tập nhóm còn lại</div>
          <div className="mt-2 font-heading text-2xl font-bold text-white">
            12 / 16 buổi
          </div>
          <div className="mt-2 h-1 w-full bg-zinc-800">
            <div className="h-full w-3/4 bg-[#FF5500]" />
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
          <div className="text-xs text-zinc-400">Huấn luyện 1-1 (PT)</div>
          <div className="mt-2 font-heading text-2xl font-bold text-white">
            3 / 4 buổi
          </div>
          <div className="mt-2 h-1 w-full bg-zinc-800">
            <div className="h-full w-3/4 bg-[#FF5500]" />
          </div>
        </div>
      </div>
    </div>
  );
}
