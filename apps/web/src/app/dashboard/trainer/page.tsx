const TODAY_SESSIONS = [
  {
    time: '09:00 - 10:00',
    type: 'PT 1-1',
    title: 'Strength & Hypertrophy',
    member: 'Nguyen Van A',
  },
  {
    time: '14:00 - 15:30',
    type: 'Lớp nhóm',
    title: 'HIIT Conditioning (12 học viên)',
    member: 'Phòng Studio B',
  },
  {
    time: '17:30 - 18:30',
    type: 'PT 1-1',
    title: 'Core & Mobility',
    member: 'Tran Thi B',
  },
] as const;

export default function TrainerDashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold uppercase text-white">
          Lịch huấn luyện
        </h1>
        <p className="mt-1 text-xs text-zinc-400">
          Danh sách ca dạy và lịch hẹn học viên hôm nay.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0d0d0f]">
        <div className="border-b border-zinc-800 px-5 py-3.5 text-xs font-semibold text-white">
          Ca dạy trong ngày
        </div>
        <div className="divide-y divide-zinc-800/60">
          {TODAY_SESSIONS.map((s) => (
            <div
              key={s.time}
              className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-semibold text-[#FF5500]">
                    {s.time}
                  </span>
                  <span className="rounded border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    {s.type}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                  {s.title}
                </div>
                <div className="text-xs text-zinc-400">{s.member}</div>
              </div>

              <button
                type="button"
                className="self-start rounded-lg border border-zinc-800 px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-[#FF5500] hover:text-white sm:self-center"
              >
                Điểm danh
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
