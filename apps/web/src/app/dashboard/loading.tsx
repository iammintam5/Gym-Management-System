import { DashboardSkeleton } from '@/components/shared/data-state';

export default function DashboardRouteLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-white/[0.08]" />
        <div className="h-10 w-36 animate-pulse rounded-xl bg-white/[0.06]" />
      </div>
      <DashboardSkeleton variant="dashboard" />
    </div>
  );
}
