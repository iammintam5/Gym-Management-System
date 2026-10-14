const RECENT_CHECKINS = [
  { code: 'MEM-00000001', name: 'Nguyen Van A', time: '08:15', plan: 'Regular Plan' },
  { code: 'MEM-00000002', name: 'Tran Thi B', time: '08:02', plan: 'Premium Plan' },
  { code: 'MEM-00000003', name: 'Le Hoang C', time: '07:45', plan: 'Basic Plan' },
] as const;

export default function StaffDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold uppercase text-white">
          Quầy lễ tân
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Kiểm soát ra vào cổng và tra cứu nhanh hội viên.
        </p>
      </div>

      {/* Quick Check-in Bar */}
      <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-5">
        <label
          htmlFor="checkin-code"
          className="mb-2 block text-xs font-medium text-zinc-300"
        >
          Mã định danh hội viên
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="checkin-code"
            type="text"
            placeholder="Nhập hoặc quét mã (VD: MEM-00000001)..."
            className="flex-1 rounded-lg border border-zinc-800 bg-[#09090B] px-3.5 py-2.5 font-mono text-sm text-white placeholder-zinc-600 focus:border-[#FF5500] focus:outline-none"
          />
          <button
            type="button"
            className="rounded-lg bg-[#FF5500] px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#e04b00]"
          >
            Xác nhận vào cổng
          </button>
        </div>
      </div>

      {/* Recent Check-ins Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0d0d0f]">
        <div className="border-b border-zinc-800 px-5 py-3.5 text-xs font-semibold text-white">
          Lượt vào cổng gần đây
        </div>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-800/80 text-zinc-400">
            <tr>
              <th className="px-5 py-3 font-medium">Mã hội viên</th>
              <th className="px-5 py-3 font-medium">Họ tên</th>
              <th className="px-5 py-3 font-medium">Gói tập</th>
              <th className="px-5 py-3 font-medium">Giờ vào</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
            {RECENT_CHECKINS.map((row) => (
              <tr key={row.code}>
                <td className="px-5 py-3 font-mono text-[#FF5500]">
                  {row.code}
                </td>
                <td className="px-5 py-3 font-medium text-white">{row.name}</td>
                <td className="px-5 py-3">{row.plan}</td>
                <td className="px-5 py-3 font-mono text-zinc-400">{row.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
