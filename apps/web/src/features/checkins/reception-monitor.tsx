'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CheckCircle2,
  XCircle,
  Copy,
  Radio,
  RefreshCw,
} from 'lucide-react';
import {
  CAMERA_STATION_RULES,
  CheckinStatus,
  type CameraStationState,
  type MemberDetail,
  type PaginatedCheckinsResponse,
  type SubscriptionDetail,
  type TodayCheckinStats,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/shared/member-avatar';
import { PaymentStatusBadge } from '@/components/shared/domain-status-badge';
import {
  cn,
  formatDateTimeVi,
  formatDateVi,
  formatPhoneVi,
  formatTimeVi,
} from '@/lib/utils';
import { cameraStationPath, resolveStationId } from './station';

export function ReceptionMonitor() {
  const stationId = resolveStationId(useSearchParams().get('station'));
  const router = useRouter();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'accepted' | 'rejected'>('all');
  const station = useQuery({
    queryKey: ['camera-station', stationId],
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<CameraStationState>([
        'camera-station',
        stationId,
      ]);
      const after = previous?.latest?.checkin.id;
      const state = await apiClient.get<CameraStationState>(
        `/checkins/camera/${encodeURIComponent(stationId)}${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        { signal },
      );
      return state.latestUnchanged
        ? { ...state, latest: previous?.latest ?? null }
        : state;
    },
    refetchInterval: CAMERA_STATION_RULES.pollIntervalMs,
    retry: 1,
  });
  const history = useQuery({
    queryKey: ['reception-checkins'],
    queryFn: () =>
      apiClient.get<PaginatedCheckinsResponse>('/checkins?limit=25'),
    refetchInterval: 10000,
    retry: 1,
  });
  const stats = useQuery({
    queryKey: ['reception-checkin-stats'],
    queryFn: () => apiClient.get<TodayCheckinStats>('/checkins/today-stats'),
    refetchInterval: 10000,
    retry: 1,
  });
  const latest = station.data?.latest ?? null;
  const checkin = latest?.checkin ?? null;
  const profile = useQuery({
    queryKey: ['reception-member', checkin?.memberId],
    queryFn: () => apiClient.get<MemberDetail>(`/members/${checkin?.memberId}`),
    enabled: !!checkin?.memberId,
    staleTime: 30000,
    retry: 1,
  });
  const refetchHistory = history.refetch;
  const refetchStats = stats.refetch;
  useEffect(() => {
    if (!checkin?.id) return;
    void refetchHistory();
    void refetchStats();
  }, [checkin?.id, refetchHistory, refetchStats]);
  const subscriptions = useQuery({
    queryKey: ['reception-subscriptions', checkin?.memberId, checkin?.id],
    queryFn: () =>
      apiClient.get<SubscriptionDetail[]>(
        `/members/${checkin?.memberId}/subscriptions`,
      ),
    enabled: !!checkin?.memberId,
    staleTime: 15000,
    retry: 1,
  });
  const subscription = subscriptions.data?.find(
    (item) => item.id === checkin?.subscriptionId,
  );
  const online = !station.isError && station.data?.online;
  const rows = (history.data?.data ?? []).filter(
    (entry) =>
      filter === 'all' ||
      (filter === 'accepted'
        ? entry.status === CheckinStatus.ACCEPTED
        : entry.status === CheckinStatus.REJECTED),
  );
  const refresh = () => {
    void station.refetch();
    void history.refetch();
    void stats.refetch();
  };
  const copyStation = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(cameraStationPath(stationId), window.location.origin).href,
      );
      setNotice('Đã sao chép liên kết trạm camera.');
    } catch {
      setNotice(
        'Không sao chép được. Mở trạm camera rồi lấy liên kết trên thanh địa chỉ.',
      );
    }
  };
  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Theo dõi check-in
          </h1>
          <p className="mt-1 inline-flex items-center gap-2 text-sm text-zinc-400">
            <span
              className={cn(
                'size-2 rounded-full',
                online ? 'bg-emerald-400' : 'bg-zinc-500',
              )}
            />
            {online ? 'Trạm đang trực tuyến' : 'Đang chờ trạm camera'} ·{' '}
            {stationId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-10"
            onClick={() => void copyStation()}
          >
            <Copy />
            Chép liên kết trạm
          </Button>
          <Link
            href={cameraStationPath(stationId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white"
          >
            <Camera className="size-4" />
            Mở trạm camera
          </Link>
        </div>
      </header>
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-[#141418] p-4 sm:flex-row sm:items-end">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get('station') ?? '',
            ).trim();
            if (!/^[a-zA-Z0-9_-]{1,50}$/.test(value)) {
              setNotice(
                'Mã trạm chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới, tối đa 50 ký tự.',
              );
              return;
            }
            setNotice('');
            router.replace(
              `/dashboard/staff?station=${encodeURIComponent(value)}`,
            );
          }}
        >
          <label
            htmlFor="station-code"
            className="mb-1.5 block text-xs text-zinc-400"
          >
            Trạm đang theo dõi
          </label>
          <div className="flex gap-2">
            <input
              id="station-code"
              name="station"
              key={stationId}
              defaultValue={stationId}
              maxLength={50}
              className="h-10 w-40 rounded-lg border border-border bg-[#09090B] px-3 font-mono text-sm text-white"
            />
            <Button type="submit" variant="outline" className="h-10">
              Theo dõi
            </Button>
          </div>
        </form>
        <dl className="flex gap-6">
          <div>
            <dt className="text-xs text-zinc-400">Hôm nay</dt>
            <dd className="mt-1 font-display text-2xl text-white">
              {stats.isError ? '—' : (stats.data?.total ?? '—')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-400">Thành công</dt>
            <dd className="mt-1 font-display text-2xl text-emerald-400">
              {stats.isError ? '—' : (stats.data?.accepted ?? '—')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-400">Từ chối</dt>
            <dd className="mt-1 font-display text-2xl text-red-300">
              {stats.isError ? '—' : (stats.data?.rejected ?? '—')}
            </dd>
          </div>
        </dl>
      </div>
      {notice && (
        <p role="status" className="text-sm text-zinc-300">
          {notice}
        </p>
      )}
      {station.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
        >
          <span className="flex-1">
            Mất kết nối máy chủ. Thông tin bên dưới là kết quả nhận được gần
            nhất.
          </span>
          <Button variant="outline" onClick={refresh}>
            Thử lại
          </Button>
        </div>
      )}
      <section
        aria-label="Lượt check-in mới nhất từ trạm"
        className="overflow-hidden rounded-2xl border border-border bg-[#141418]"
      >
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-start gap-3 border-b p-5 sm:p-6',
            !checkin
              ? 'border-border'
              : checkin.status === CheckinStatus.ACCEPTED
                ? 'border-emerald-500/20 bg-emerald-500/10'
                : 'border-red-500/20 bg-red-500/10',
          )}
        >
          {!checkin ? (
            <Radio className="mt-1 size-6 text-primary" />
          ) : checkin.status === CheckinStatus.ACCEPTED ? (
            <CheckCircle2 className="mt-1 size-6 text-emerald-400" />
          ) : (
            <XCircle className="mt-1 size-6 text-red-400" />
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              {station.isPending
                ? 'Đang kết nối trạm…'
                : !checkin
                  ? 'Chờ lượt check-in từ camera'
                  : checkin.status === CheckinStatus.ACCEPTED
                    ? 'Check-in thành công'
                    : 'Từ chối check-in'}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              {checkin
                ? (checkin.rejectionReason ??
                  'Hội viên đã được ghi nhận vào tập.')
                : 'Kết quả nhận diện sẽ tự cập nhật tại đây.'}
            </p>
            {checkin && (
              <p className="mt-2 text-xs text-zinc-400">
                Lượt gần nhất lúc {formatDateTimeVi(checkin.checkedInAt)}
              </p>
            )}
          </div>
        </div>
        {checkin ? (
          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(250px,1fr)_minmax(0,1fr)]">
            <div className="grid grid-cols-2 gap-4">
              <figure>
                <MemberAvatar
                  src={checkin.memberIdPhotoUrl}
                  fullName={checkin.memberFullName}
                  aspect="portrait"
                  size="xl"
                  className="aspect-[3/4] h-auto w-full rounded-xl"
                />
                <figcaption className="mt-2 text-center text-xs text-zinc-400">
                  Ảnh gốc trong hồ sơ
                </figcaption>
              </figure>
              <figure>
                <MemberAvatar
                  src={latest?.capturedPhoto}
                  fullName="Ảnh chụp tại trạm"
                  aspect="portrait"
                  size="xl"
                  className="aspect-[3/4] h-auto w-full rounded-xl"
                />
                <figcaption className="mt-2 text-center text-xs text-zinc-400">
                  Ảnh tại lần check-in này
                </figcaption>
              </figure>
            </div>
            <div>
              <p className="font-mono text-sm text-primary">
                {checkin.memberCode}
              </p>
              <h3 className="mt-1 text-2xl font-bold text-white">
                {checkin.memberFullName}
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                {profile.data
                  ? formatPhoneVi(profile.data.phone)
                  : profile.isError
                    ? 'Chưa tải được số điện thoại'
                    : 'Đang tải hồ sơ…'}
              </p>
              <dl className="mt-5 space-y-4 border-t border-border pt-5">
                <div>
                  <dt className="text-xs text-zinc-400">
                    Gói tại lần check-in
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {checkin.planName ?? 'Không có gói hợp lệ'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-400">Thời hạn gói</dt>
                  <dd className="mt-1 text-sm text-zinc-200">
                    {subscription
                      ? `${formatDateVi(subscription.startDate)} – ${formatDateVi(subscription.endDate)}`
                      : subscriptions.isError
                        ? 'Không tải được chi tiết gói'
                        : '—'}
                  </dd>
                </div>
                {subscription && (
                  <div>
                    <dt className="mb-2 text-xs text-zinc-400">Thanh toán</dt>
                    <dd>
                      <PaymentStatusBadge status={subscription.paymentStatus} />
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-sm text-zinc-400">
            Mở trang camera trên điện thoại với cùng mã trạm. Khách chỉ cần nhìn
            vào camera, hệ thống sẽ tự động nhận diện và gửi kết quả về đây.
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-[#141418]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 className="font-semibold text-white">Lịch sử check-in</h2>
            <p className="mt-1 text-xs text-zinc-400">
              25 lượt gần nhất tại phòng tập
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Lọc kết quả"
              className="flex rounded-lg border border-border p-1"
            >
              {(
                [
                  { value: 'all', label: 'Tất cả' },
                  { value: 'accepted', label: 'Thành công' },
                  { value: 'rejected', label: 'Từ chối' },
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className={cn(
                    'rounded px-3 py-2 text-xs',
                    filter === item.value
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              aria-label="Làm mới dữ liệu"
              onClick={refresh}
            >
              <RefreshCw className={history.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
        {history.isError && (
          <p role="alert" className="px-5 py-3 text-sm text-amber-300">
            Chưa tải được lịch sử mới nhất. Bấm làm mới để thử lại.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm">
            <caption className="sr-only">
              Lịch sử check-in tại phòng tập
            </caption>
            <thead className="border-b border-border text-xs text-zinc-400">
              <tr>
                {[
                  'Thời gian',
                  'Hội viên',
                  'Gói tập',
                  'Kết quả',
                  'Chi tiết',
                ].map((label) => (
                  <th key={label} scope="col" className="px-5 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!rows.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-zinc-400"
                  >
                    {history.isPending
                      ? 'Đang tải…'
                      : history.isError
                        ? 'Chưa có dữ liệu để hiển thị.'
                        : 'Không có lượt phù hợp trong danh sách gần nhất.'}
                  </td>
                </tr>
              ) : (
                rows.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-zinc-300">
                      {formatDateTimeVi(entry.checkedInAt)}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">
                        {entry.memberFullName}
                      </p>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        {entry.memberCode}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-zinc-300">
                      {entry.planName ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap px-5 py-4 text-xs',
                        entry.status === CheckinStatus.ACCEPTED
                          ? 'text-emerald-400'
                          : 'text-red-300',
                      )}
                    >
                      {entry.status === CheckinStatus.ACCEPTED
                        ? 'Thành công'
                        : 'Từ chối'}
                    </td>
                    <td className="max-w-xs px-5 py-4 text-xs text-zinc-400">
                      {entry.rejectionReason ??
                        `Ghi nhận bởi ${entry.recordedByName ?? 'Lễ tân'}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-zinc-500">
        {station.dataUpdatedAt
          ? `Đồng bộ lần cuối lúc ${formatTimeVi(new Date(station.dataUpdatedAt))}`
          : 'Đang kết nối máy chủ…'}
      </p>
    </div>
  );
}
