import { Suspense } from 'react';
import { ReceptionMonitor } from '@/features/checkins/reception-monitor';
export default function StaffCheckinPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6 text-sm text-zinc-400">Đang tải màn hình lễ tân…</p>
      }
    >
      <ReceptionMonitor />
    </Suspense>
  );
}
