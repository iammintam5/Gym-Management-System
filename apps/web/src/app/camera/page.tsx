import { Suspense } from 'react';
import { CameraStation } from '@/features/checkins/camera-station';

export default function CameraPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-zinc-400">Đang mở trạm camera…</div>
      }
    >
      <CameraStation />
    </Suspense>
  );
}
