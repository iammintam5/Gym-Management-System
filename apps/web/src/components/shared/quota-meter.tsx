import { ServiceTypeCode, type SubscriptionQuotaDetail } from '@gym/contracts';
import { cn } from '@/lib/utils';

export interface QuotaMeterProps {
  quota: SubscriptionQuotaDetail;
  className?: string;
}

function getServiceTitleVi(serviceCode: string, fallbackName?: string): string {
  if (serviceCode === ServiceTypeCode.GYM_ACCESS) return 'Check-in Full Gym';
  if (serviceCode === ServiceTypeCode.CLASS)
    return 'Lớp học nhóm (Group Class)';
  if (serviceCode === ServiceTypeCode.PT) return 'Huấn luyện viên 1-1 (PT)';
  return fallbackName || serviceCode;
}

/**
 * Dual-Phase Quota Tracker mapped directly to SubscriptionQuotaDetail from @gym/contracts.
 * Displays: Used (consumed) + Reserved (held by active bookings) + Remaining (available).
 */
export function QuotaMeter({ quota, className }: QuotaMeterProps) {
  const isUnlimited = quota.unlimited || quota.allocated === null;
  const allocated = quota.allocated ?? 0;
  const used = quota.used;
  const reserved = quota.reserved;
  const remaining = quota.remaining ?? Math.max(0, allocated - used - reserved);

  const usedPct =
    !isUnlimited && allocated > 0
      ? Math.min(100, Math.round((used / allocated) * 100))
      : 0;
  const reservedPct =
    !isUnlimited && allocated > 0
      ? Math.min(100 - usedPct, Math.round((reserved / allocated) * 100))
      : 0;

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card p-4 shadow-xs',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-foreground">
          {getServiceTitleVi(quota.service, quota.serviceName)}
        </span>
        {isUnlimited ? (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
            Không giới hạn
          </span>
        ) : (
          <span className="font-mono text-xs font-semibold text-foreground">
            Còn <span className="text-[#FF5500]">{remaining}</span> /{' '}
            {allocated} buổi
          </span>
        )}
      </div>

      {/* Dual-Phase Progress Bar */}
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {isUnlimited ? (
          <div className="h-full w-full bg-emerald-500" />
        ) : (
          <>
            <div
              style={{ width: `${usedPct}%` }}
              className="h-full bg-[#FF5500] transition-all"
              title={`Đã tập: ${used} buổi`}
            />
            <div
              style={{ width: `${reservedPct}%` }}
              className="h-full bg-amber-500 transition-all"
              title={`Đang giữ chỗ: ${reserved} buổi`}
            />
          </>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#FF5500]" />
            Đã tập: <strong className="text-foreground">{used}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" />
            Giữ chỗ: <strong className="text-foreground">{reserved}</strong>
          </span>
        </div>
        {!isUnlimited && (
          <span>
            Khả dụng: <strong className="text-emerald-500">{remaining}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
