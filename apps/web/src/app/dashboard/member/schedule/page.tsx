'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookingStatus,
  ScheduleStatus,
  type ClassBookingDetail,
  type ClassScheduleDetail,
  type PaginatedClassBookingsResponse,
  type PaginatedClassSchedulesResponse,
  type SubscriptionQuotaDetail,
} from '@gym/contracts';
import { apiClient, ApiClientError } from '@/services/api-client';
import { DataState } from '@/components/shared/data-state';

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
});
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Không thể cập nhật lịch lớp. Vui lòng thử lại.';

export default function MemberBookSchedulePage() {
  const [classes, setClasses] = useState<ClassScheduleDetail[]>([]);
  const [bookings, setBookings] = useState<ClassBookingDetail[]>([]);
  const [quota, setQuota] = useState<SubscriptionQuotaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(0);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const options = { signal, skipCache: true };
      const [schedules, mine, quotas] = await Promise.all([
        apiClient.get<PaginatedClassSchedulesResponse>(
          '/class-schedules?limit=100&status=SCHEDULED&from=' +
            encodeURIComponent(new Date().toISOString()),
          options,
        ),
        apiClient.get<PaginatedClassBookingsResponse>(
          '/class-bookings/my?limit=100',
          options,
        ),
        apiClient
          .get<SubscriptionQuotaDetail[]>(
            '/subscriptions/me/current/quotas',
            options,
          )
          .catch((cause: unknown) => {
            if (cause instanceof ApiClientError && cause.status === 404)
              return [];
            throw cause;
          }),
      ]);
      if (signal?.aborted || current !== sequence.current) return;
      const now = Date.now();
      setClasses(
        schedules.data.filter(
          (item) =>
            item.status === ScheduleStatus.SCHEDULED &&
            new Date(item.startsAt).getTime() > now,
        ),
      );
      setBookings(mine.data);
      setQuota(quotas.find((item) => item.service === 'CLASS') ?? null);
      setAsOf(now);
    } catch (cause) {
      if (!signal?.aborted && current === sequence.current)
        setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted && current === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function act(id: string, cancel = false) {
    if (inFlight.current) return;
    if (cancel && !window.confirm('Hủy chỗ trong lớp này?')) return;
    inFlight.current = true;
    setBusy(id);
    setNotice('');
    try {
      await apiClient.post(
        cancel ? '/class-bookings/' + id + '/cancel' : '/class-bookings',
        cancel ? {} : { scheduleId: id },
      );
      setNotice(
        cancel
          ? 'Đã hủy chỗ và trả lại lượt giữ.'
          : 'Đã đăng ký lớp. Một lượt được giữ cho buổi học.',
      );
      await load();
    } catch (cause) {
      setNotice(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const upcoming = bookings.filter(
    (item) =>
      item.status === BookingStatus.BOOKED &&
      new Date(item.endsAt).getTime() > asOf,
  );
  const history = bookings.filter(
    (item) => !upcoming.some((current) => current.id === item.id),
  );
  const remaining = quota?.allocated === null ? null : (quota?.remaining ?? 0);
  const slot = (start: string, end: string) =>
    dateTime.format(new Date(start)) + ' – ' + time.format(new Date(end));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Lịch lớp nhóm</h1>
        <p className="text-sm text-zinc-400">
          Lượt khả dụng:{' '}
          <strong className="text-white">
            {remaining === null ? 'Không giới hạn' : remaining}
          </strong>
        </p>
      </header>
      <DataState loading={loading} error={error} onRetry={() => void load()} />
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-200"
        >
          {notice}
        </p>
      )}
      {!loading && !error && (
        <>
          <section className="rounded-xl border border-white/10 bg-[#141418] p-5">
            <h2 className="font-semibold text-white">Lớp đã đăng ký</h2>
            {upcoming.length ? (
              <div className="mt-3 divide-y divide-white/10">
                {upcoming.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <div>
                      <p className="font-medium text-white">{item.className}</p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {item.trainerName} · {slot(item.startsAt, item.endsAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        busy !== null ||
                        new Date(item.startsAt).getTime() - asOf < 2 * 3600000
                      }
                      onClick={() => void act(item.id, true)}
                      className="rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40"
                    >
                      Hủy chỗ
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">Chưa có lớp sắp tới.</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              Hội viên có thể tự hủy trước giờ học ít nhất 2 tiếng.
            </p>
          </section>
          <section className="rounded-xl border border-white/10 bg-[#141418] p-5">
            <h2 className="font-semibold text-white">Lớp đang mở đăng ký</h2>
            {classes.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-3 font-normal">Lớp · HLV</th>
                      <th className="py-3 font-normal">Thời gian</th>
                      <th className="py-3 font-normal">Còn chỗ</th>
                      <th className="py-3">
                        <span className="sr-only">Đăng ký</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {classes.map((item) => {
                      const booked = bookings.some(
                        (booking) =>
                          booking.scheduleId === item.id &&
                          booking.status === BookingStatus.BOOKED,
                      );
                      return (
                        <tr key={item.id}>
                          <td className="py-4 text-white">
                            {item.className}
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.trainerName}
                            </p>
                          </td>
                          <td className="py-4 text-zinc-300">
                            {slot(item.startsAt, item.endsAt)}
                          </td>
                          <td className="py-4 text-zinc-400">
                            {item.remainingSlots}/{item.capacity}
                          </td>
                          <td className="py-4 text-right">
                            <button
                              type="button"
                              disabled={
                                busy !== null ||
                                booked ||
                                item.remainingSlots < 1 ||
                                remaining === 0
                              }
                              onClick={() => void act(item.id)}
                              className="rounded-lg bg-[#FF5500] px-3 py-2 font-semibold text-white disabled:opacity-40"
                            >
                              {booked
                                ? 'Đã đăng ký'
                                : busy === item.id
                                  ? 'Đang đăng ký…'
                                  : 'Đăng ký'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">
                Chưa có lớp mở đăng ký.
              </p>
            )}
          </section>
          <details className="rounded-xl border border-white/10 p-5">
            <summary className="cursor-pointer text-sm text-zinc-300">
              Lịch sử lớp gần đây ({history.length})
            </summary>
            {history.map((item) => (
              <div
                key={item.id}
                className="mt-3 border-t border-white/10 pt-3 text-sm"
              >
                <p className="text-white">{item.className}</p>
                <p className="mt-1 text-zinc-400">
                  {slot(item.startsAt, item.endsAt)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {item.status === BookingStatus.CANCELLED
                    ? 'Đã hủy'
                    : item.status === BookingStatus.COMPLETED
                      ? 'Đã tham gia'
                      : item.status === BookingStatus.NO_SHOW
                        ? 'Vắng mặt'
                        : 'Chờ ghi nhận'}
                </p>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
