'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Clock,
  CalendarCheck,
  Dumbbell,
  History,
  CheckCircle2,
  XCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  AttendanceStatus,
  BookingStatus,
  ScheduleStatus,
  type ClassBookingDetail,
  type PaginatedClassBookingsResponse,
  type PaginatedClassSchedulesResponse,
  type PaginatedPtBookingsResponse,
  type PtAvailabilityDetail,
  type PtBookingDetail,
  type SubscriptionQuotaDetail,
  type TrainerSummary,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { DataState, assertDataLoaded } from '@/components/shared/data-state';
import { apiClient, ApiClientError } from '@/services/api-client';

interface UpcomingBookingCard {
  id: string;
  type: 'Group Class' | 'PT 1-on-1';
  title: string;
  coach: string;
  startsAtIso: string;
  dateTime: string;
  cancelDeadlineNote: string;
  canCancel: boolean;
}

interface AvailableClassRow {
  id: string;
  title: string;
  coach: string;
  schedule: string;
  duration: string;
  spots: string;
  remainingSlots: number;
}

interface AvailablePtSlotRow {
  id: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  coach: string;
  specialty: string;
  schedule: string;
  duration: string;
}

interface PastSessionHistoryRow {
  id: string;
  type: 'Group Class' | 'PT 1-on-1';
  title: string;
  coach: string;
  date: string;
  outcome: 'Attended' | 'Cancelled on Time' | 'No-Show';
  quotaImpact: string;
}

function getInitials(fullName: string): string {
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'PT'
  );
}

function formatDateTimeSlot(startIso: string, endIso?: string): string {
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return 'Sắp tới';
  const day = s.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const startStr = s.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (!endIso) return `${day} • ${startStr}`;
  const e = new Date(endIso);
  const endStr = Number.isNaN(e.getTime())
    ? ''
    : ` – ${e.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  return `${day} • ${startStr}${endStr}`;
}

function getDurationMins(startIso: string, endIso: string): string {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return '60 phút';
  return `${Math.round((e - s) / 60000)} phút`;
}

export default function MemberBookSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [myBookings, setMyBookings] = useState<
    ReadonlyArray<UpcomingBookingCard>
  >([]);
  const [availableClasses, setAvailableClasses] = useState<
    ReadonlyArray<AvailableClassRow>
  >([]);
  const [availablePtSlots, setAvailablePtSlots] = useState<
    ReadonlyArray<AvailablePtSlotRow>
  >([]);
  const [pastSessions, setPastSessions] = useState<
    ReadonlyArray<PastSessionHistoryRow>
  >([]);

  const [classQuotaLabel, setClassQuotaLabel] = useState('0 / 0');
  const [ptQuotaLabel, setPtQuotaLabel] = useState('0 / 0');
  const [classRemaining, setClassRemaining] = useState<number | null>(0);
  const [ptRemaining, setPtRemaining] = useState<number | null>(0);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadMemberSchedule = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [schedulesRes, myClassBkRes, myPtBkRes, quotasRes, trainersRes] =
        await Promise.allSettled([
          apiClient.get<PaginatedClassSchedulesResponse>(
            '/class-schedules?limit=30',
          ),
          apiClient.get<PaginatedClassBookingsResponse>(
            '/class-bookings/my?limit=30',
          ),
          apiClient.get<PaginatedPtBookingsResponse>(
            '/pt-bookings/my?limit=30',
          ),
          apiClient.get<SubscriptionQuotaDetail[]>(
            '/subscriptions/me/current/quotas',
          ),
          apiClient.get<TrainerSummary[]>('/trainers'),
        ]);

      assertDataLoaded([schedulesRes, myClassBkRes, myPtBkRes]);
      assertDataLoaded([quotasRes], true);
      setClassRemaining(0);
      setPtRemaining(0);
      setClassQuotaLabel('0 / 0');
      setPtQuotaLabel('0 / 0');
      if (quotasRes.status === 'fulfilled') {
        const clsQ = quotasRes.value.find((q) => q.service === 'CLASS');
        if (clsQ) {
          setClassRemaining(
            clsQ.allocated === null ? null : (clsQ.remaining ?? 0),
          );
          setClassQuotaLabel(
            clsQ.allocated === null
              ? 'Không giới hạn'
              : `${clsQ.remaining ?? 0} / ${clsQ.allocated} buổi`,
          );
        }
        const ptQ = quotasRes.value.find((q) => q.service === 'PT');
        if (ptQ) {
          setPtRemaining(ptQ.allocated === null ? null : (ptQ.remaining ?? 0));
          setPtQuotaLabel(
            ptQ.allocated === null
              ? 'Không giới hạn'
              : `${ptQ.remaining ?? 0} / ${ptQ.allocated} buổi`,
          );
        }
      }

      if (schedulesRes.status === 'fulfilled') {
        const activeSchedules = schedulesRes.value.data.filter(
          (s) =>
            s.status === ScheduleStatus.SCHEDULED &&
            new Date(s.startsAt).getTime() > Date.now(),
        );
        setAvailableClasses(
          activeSchedules.slice(0, 6).map((sch) => ({
            id: sch.id,
            title: sch.className,
            coach: sch.trainerName,
            schedule: formatDateTimeSlot(sch.startsAt),
            duration: getDurationMins(sch.startsAt, sch.endsAt),
            spots: `${sch.bookedCount}/${sch.capacity}`,
            remainingSlots: sch.remainingSlots,
          })),
        );

        // Fetch public trainer availabilities from all active trainers (both class coaches and dedicated 1-on-1 PTs)
        const trainerMap = new Map<string, string>();
        for (const sch of schedulesRes.value.data) {
          if (sch.trainerId && !trainerMap.has(sch.trainerId)) {
            trainerMap.set(sch.trainerId, sch.trainerName);
          }
        }
        if (trainersRes.status === 'fulfilled') {
          for (const tr of trainersRes.value) {
            if (!trainerMap.has(tr.id)) {
              trainerMap.set(tr.id, tr.fullName);
            }
          }
        }

        const trainerEntries = Array.from(trainerMap.entries()).slice(0, 8);
        if (trainerEntries.length > 0) {
          const availLists = await Promise.allSettled(
            trainerEntries.map(([tId]) =>
              apiClient.get<PtAvailabilityDetail[]>(
                `/trainers/${tId}/availabilities`,
              ),
            ),
          );

          assertDataLoaded(availLists);
          const openSlots: AvailablePtSlotRow[] = [];
          availLists.forEach((res, idx) => {
            const trainerInfo = trainerEntries[idx];
            if (res.status === 'fulfilled' && trainerInfo) {
              res.value
                .filter(
                  (av) =>
                    av.isAvailable &&
                    new Date(av.startsAt).getTime() > Date.now(),
                )
                .forEach((av) => {
                  openSlots.push({
                    id: av.id,
                    trainerId: av.trainerId,
                    startsAt: av.startsAt,
                    endsAt: av.endsAt,
                    coach: av.trainerName || trainerInfo[1],
                    specialty: av.note || 'Huấn luyện cá nhân 1-1',
                    schedule: formatDateTimeSlot(av.startsAt, av.endsAt),
                    duration: getDurationMins(av.startsAt, av.endsAt),
                  });
                });
            }
          });

          setAvailablePtSlots(openSlots.slice(0, 6));
        }
      }

      const classBookings: ClassBookingDetail[] =
        myClassBkRes.status === 'fulfilled' ? myClassBkRes.value.data : [];
      const ptBookings: PtBookingDetail[] =
        myPtBkRes.status === 'fulfilled' ? myPtBkRes.value.data : [];

      if (
        myClassBkRes.status === 'fulfilled' ||
        myPtBkRes.status === 'fulfilled'
      ) {
        const upcoming: UpcomingBookingCard[] = [];
        const past: PastSessionHistoryRow[] = [];
        const nowMs = Date.now();

        for (const bk of classBookings) {
          if (
            bk.status === BookingStatus.BOOKED &&
            bk.attendance === AttendanceStatus.PENDING
          ) {
            const hoursUntilStart =
              (new Date(bk.startsAt).getTime() - nowMs) / (1000 * 60 * 60);
            const canCancel = hoursUntilStart >= 2;
            upcoming.push({
              id: bk.id,
              type: 'Group Class',
              title: bk.className,
              coach: bk.trainerName,
              startsAtIso: bk.startsAt,
              dateTime: formatDateTimeSlot(bk.startsAt, bk.endsAt),
              cancelDeadlineNote: canCancel
                ? 'Miễn phí huỷ chỗ trước giờ học tối thiểu 2 tiếng'
                : 'Đã trong khung 2 tiếng trước giờ học — không thể tự huỷ',
              canCancel,
            });
          } else {
            const outcome: PastSessionHistoryRow['outcome'] =
              bk.status === BookingStatus.CANCELLED
                ? 'Cancelled on Time'
                : bk.attendance === AttendanceStatus.PRESENT ||
                    bk.status === BookingStatus.COMPLETED
                  ? 'Attended'
                  : 'No-Show';
            past.push({
              id: bk.id,
              type: 'Group Class',
              title: bk.className,
              coach: bk.trainerName,
              date: formatDateTimeSlot(bk.startsAt),
              outcome,
              quotaImpact:
                outcome === 'Cancelled on Time'
                  ? 'Hoàn lại lượt (huỷ trước >2h)'
                  : outcome === 'Attended'
                    ? 'Đã dùng 1 buổi Lớp'
                    : 'Trừ 1 buổi Lớp (vắng mặt)',
            });
          }
        }

        for (const pbk of ptBookings) {
          if (
            pbk.status === BookingStatus.BOOKED &&
            pbk.attendance === AttendanceStatus.PENDING
          ) {
            const hoursUntilStart =
              (new Date(pbk.startsAt).getTime() - nowMs) / (1000 * 60 * 60);
            const canCancel = hoursUntilStart >= 6;
            upcoming.push({
              id: pbk.id,
              type: 'PT 1-on-1',
              title: 'Huấn luyện PT 1 kèm 1',
              coach: pbk.trainerName,
              startsAtIso: pbk.startsAt,
              dateTime: formatDateTimeSlot(pbk.startsAt, pbk.endsAt),
              cancelDeadlineNote: canCancel
                ? 'Miễn phí huỷ lịch trước giờ tập tối thiểu 6 tiếng'
                : 'Đã trong khung 6 tiếng trước giờ tập — không thể tự huỷ',
              canCancel,
            });
          } else {
            const outcome: PastSessionHistoryRow['outcome'] =
              pbk.status === BookingStatus.CANCELLED
                ? 'Cancelled on Time'
                : pbk.attendance === AttendanceStatus.PRESENT ||
                    pbk.status === BookingStatus.COMPLETED
                  ? 'Attended'
                  : 'No-Show';
            past.push({
              id: pbk.id,
              type: 'PT 1-on-1',
              title: 'Huấn luyện PT 1 kèm 1',
              coach: pbk.trainerName,
              date: formatDateTimeSlot(pbk.startsAt),
              outcome,
              quotaImpact:
                outcome === 'Cancelled on Time'
                  ? 'Hoàn lại lượt (huỷ trước >6h)'
                  : outcome === 'Attended'
                    ? 'Đã dùng 1 buổi PT'
                    : 'Trừ 1 buổi PT (vắng mặt)',
            });
          }
        }

        setMyBookings(upcoming);
        setPastSessions(past);
      }
      hasLoadedRef.current = true;
    } catch {
      setLoadError('Không thể tải dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemberSchedule();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMemberSchedule]);

  const handleReserveClass = async (cls: AvailableClassRow) => {
    setBusyId(cls.id);
    try {
      await apiClient.post('/class-bookings', {
        scheduleId: cls.id,
      });
      setFeedbackBanner(
        `Đã đặt chỗ lớp ${cls.title} cùng HLV ${cls.coach}. Hệ thống đang giữ 1 buổi Lớp.`,
      );
      await loadMemberSchedule();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể đặt chỗ lớp ${cls.title}.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleBookPtSlot = async (slot: AvailablePtSlotRow) => {
    setBusyId(slot.id);
    try {
      await apiClient.post('/pt-bookings', {
        trainerId: slot.trainerId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        availabilityId: slot.id,
      });
      setFeedbackBanner(
        `Đã đặt lịch PT 1-1 cùng HLV ${slot.coach} (${slot.schedule}). Hệ thống đang giữ 1 buổi PT.`,
      );
      await loadMemberSchedule();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể đặt lịch PT 1-1 với HLV ${slot.coach}.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelBooking = async (booking: UpcomingBookingCard) => {
    setBusyId(booking.id);
    try {
      if (booking.type === 'Group Class') {
        await apiClient.post(`/class-bookings/${booking.id}/cancel`, {});
      } else {
        await apiClient.post(`/pt-bookings/${booking.id}/cancel`, {});
      }
      setFeedbackBanner(
        `Đã huỷ lịch ${booking.title} và hoàn lại buổi tập khả dụng cho bạn.`,
      );
      await loadMemberSchedule();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể huỷ lịch ${booking.title}.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadMemberSchedule()}
      />
    );

  return (
    <div className="space-y-6">
      {/* Header + Remaining Quota Strip */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Đặt lịch Group Class &amp; PT 1-1
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[13px] tabular-nums">
          <span className="rounded-xl border border-white/[0.08] bg-[#141418] px-3.5 py-2 text-zinc-300">
            Group Class khả dụng:{' '}
            <strong className="font-mono text-[#FF5500]">
              {classQuotaLabel}
            </strong>
          </span>
          <span className="rounded-xl border border-white/[0.08] bg-[#141418] px-3.5 py-2 text-zinc-300">
            PT 1-1 khả dụng:{' '}
            <strong className="font-mono text-amber-400">{ptQuotaLabel}</strong>
          </span>
        </div>
      </div>

      {feedbackBanner && (
        <div className="flex items-center justify-between rounded-xl border border-[#FF5500]/30 bg-[#FF5500]/10 px-4 py-3 text-[13px] text-white">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-zinc-400 hover:text-white"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Row 1: My Reserved Sessions */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CalendarCheck className="h-4 w-4 text-[#FF5500]" />
            <div>
              <h2 className="text-base font-semibold text-white">
                Lịch tập đã đặt chỗ của tôi
              </h2>
              <p className="text-[13px] text-zinc-500">
                Huỷ lịch đúng quy định sẽ tự động hoàn lại buổi tập vào tài
                khoản của bạn
              </p>
            </div>
          </div>
          <span className="rounded-full bg-[#FF5500]/15 px-3 py-0.5 text-[13px] font-semibold tabular-nums text-[#FF5500]">
            {myBookings.length} buổi đã đặt
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {myBookings.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-8 text-center text-[13px] text-zinc-500">
              Bạn chưa có lịch đặt chỗ sắp tới. Hãy chọn lớp Group Class hoặc
              Slot PT 1-1 bên dưới.
            </div>
          ) : (
            myBookings.map((booking) => (
              <div
                key={booking.id}
                className="flex flex-col justify-between gap-4 rounded-xl border border-white/[0.06] bg-[#18181C] p-4 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[13px] font-semibold',
                        booking.type === 'Group Class'
                          ? 'bg-[#FF5500]/15 text-[#FF5500]'
                          : 'bg-amber-500/15 text-amber-400',
                      )}
                    >
                      {booking.type === 'Group Class'
                        ? 'Group Class'
                        : 'PT 1-1'}
                    </span>
                    <span className="text-[13px] tabular-nums text-zinc-400">
                      {booking.dateTime}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-white">
                    {booking.title} — {booking.coach}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-zinc-500">
                    {booking.cancelDeadlineNote}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busyId === booking.id || !booking.canCancel}
                  onClick={() => void handleCancelBooking(booking)}
                  className={cn(
                    'self-start rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition-colors sm:self-center',
                    booking.canCancel
                      ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50'
                      : 'cursor-not-allowed border-white/[0.06] bg-[#141418] text-zinc-500',
                  )}
                >
                  {!booking.canCancel
                    ? booking.type === 'Group Class'
                      ? 'Khóa huỷ (<2h)'
                      : 'Khóa huỷ (<6h)'
                    : busyId === booking.id
                      ? 'Đang huỷ...'
                      : 'Huỷ lịch đặt'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Row 2: Available Group Classes */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              Group Class đang mở đăng ký
            </h2>
            <p className="text-[13px] text-zinc-500">
              Thời lượng 30 đến 180 phút/ca • Hỗ trợ huỷ miễn phí trước giờ học
              2 tiếng
            </p>
          </div>
          <span className="text-[13px] tabular-nums text-zinc-400">
            Hạn mức Group Class:{' '}
            <strong className="text-white">{classQuotaLabel}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {availableClasses.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-8 text-center text-[13px] text-zinc-500">
              Hiện chưa có ca Group Class nào đang mở đăng ký.
            </div>
          ) : (
            availableClasses.map((cls) => {
              const noClassQuota =
                classRemaining !== null && classRemaining <= 0;
              return (
                <div
                  key={cls.id}
                  className="flex flex-col justify-between rounded-xl border border-white/[0.06] bg-[#18181C] p-4 hover:border-white/15"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">
                        {cls.title}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium tabular-nums text-zinc-400">
                        <Users className="h-3.5 w-3.5 text-[#FF5500]" />
                        {cls.spots}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-zinc-400">
                      HLV: {cls.coach}
                    </p>
                    <div className="mt-3 flex items-center gap-3 text-[13px] tabular-nums text-zinc-300">
                      <span>{cls.schedule}</span>
                      <span className="inline-flex items-center gap-1 text-zinc-500">
                        <Clock className="h-3 w-3" />
                        {cls.duration}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      busyId === cls.id ||
                      cls.remainingSlots <= 0 ||
                      noClassQuota
                    }
                    onClick={() => void handleReserveClass(cls)}
                    className="mt-4 h-9 w-full rounded-xl bg-[#FF5500] text-[13px] font-semibold text-white transition-colors hover:bg-[#E64D00] disabled:opacity-50"
                  >
                    {cls.remainingSlots <= 0
                      ? 'Đã kín chỗ'
                      : noClassQuota
                        ? 'Hết buổi Group Class'
                        : busyId === cls.id
                          ? 'Đang đặt chỗ...'
                          : 'Đặt chỗ lớp học'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Row 3: Available 1-on-1 Personal Trainer Slots */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Dumbbell className="h-4 w-4 text-amber-400" />
            <div>
              <h2 className="text-base font-semibold text-white">
                Slot trống PT 1-1
              </h2>
              <p className="text-[13px] text-zinc-500">
                Đặt Slot tập kèm riêng với Coach cá nhân • Hỗ trợ huỷ trước giờ
                tập 6 tiếng
              </p>
            </div>
          </div>
          <span className="text-[13px] tabular-nums text-zinc-400">
            Hạn mức PT: <strong className="text-white">{ptQuotaLabel}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {availablePtSlots.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-8 text-center text-[13px] text-zinc-500">
              Hiện chưa có khung giờ trống PT 1-1 nào từ huấn luyện viên.
            </div>
          ) : (
            availablePtSlots.map((slot) => {
              const noPtQuota = ptRemaining !== null && ptRemaining <= 0;
              return (
                <div
                  key={slot.id}
                  className="flex flex-col justify-between rounded-xl border border-white/[0.06] bg-[#18181C] p-4 hover:border-white/15"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-[13px] font-bold text-amber-400">
                        {getInitials(slot.coach)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">
                          {slot.coach}
                        </p>
                        <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[13px] font-semibold text-amber-400">
                          {slot.specialty}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[13px] tabular-nums text-zinc-300">
                      <span>{slot.schedule}</span>
                      <span className="text-zinc-500">{slot.duration}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busyId === slot.id || noPtQuota}
                    onClick={() => void handleBookPtSlot(slot)}
                    className="mt-4 h-9 w-full rounded-xl border border-white/20 bg-transparent text-[13px] font-semibold text-white transition-colors hover:border-[#FF5500] hover:bg-[#FF5500] disabled:opacity-50"
                  >
                    {noPtQuota
                      ? 'Hết buổi PT 1-1'
                      : busyId === slot.id
                        ? 'Đang đặt lịch...'
                        : 'Đặt lịch PT 1-1'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Row 4: Past Sessions & Attendance History */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <History className="h-4 w-4 text-[#FF5500]" />
          <div>
            <h2 className="text-base font-semibold text-white">
              Lịch sử buổi tập &amp; Điểm danh
            </h2>
            <p className="text-[13px] text-zinc-500">
              Theo dõi các buổi đã tham gia, lịch huỷ đúng hạn được hoàn lượt và
              các buổi vắng mặt
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="pb-3.5">Buổi tập</th>
                <th className="pb-3.5">Loại hình</th>
                <th className="pb-3.5">Huấn luyện viên</th>
                <th className="pb-3.5">Thời gian</th>
                <th className="pb-3.5">Biến động lượt tập</th>
                <th className="pb-3.5 text-right">Kết quả điểm danh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] text-[13px]">
              {pastSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-[13px] text-zinc-500"
                  >
                    Chưa có lịch sử tham gia hoặc huỷ buổi tập nào.
                  </td>
                </tr>
              ) : (
                pastSessions.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5 font-semibold text-white">
                      {row.title}
                    </td>
                    <td className="py-3.5">
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-[13px] font-semibold',
                          row.type === 'Group Class'
                            ? 'bg-[#FF5500]/15 text-[#FF5500]'
                            : 'bg-amber-500/15 text-amber-400',
                        )}
                      >
                        {row.type === 'Group Class' ? 'Group Class' : 'PT 1-1'}
                      </span>
                    </td>
                    <td className="py-3.5 text-zinc-300">{row.coach}</td>
                    <td className="py-3.5 tabular-nums text-zinc-400">
                      {row.date}
                    </td>
                    <td className="py-3.5 tabular-nums text-zinc-300">
                      {row.quotaImpact}
                    </td>
                    <td className="py-3.5 text-right">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold',
                          row.outcome === 'Attended' &&
                            'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
                          row.outcome === 'Cancelled on Time' &&
                            'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
                          row.outcome === 'No-Show' &&
                            'border-red-500/40 bg-red-500/10 text-red-400',
                        )}
                      >
                        {row.outcome === 'Attended' && (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {row.outcome === 'Cancelled on Time' && (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        {row.outcome === 'No-Show' && (
                          <XCircle className="h-3 w-3" />
                        )}
                        {row.outcome === 'Attended'
                          ? 'Đã tham gia'
                          : row.outcome === 'Cancelled on Time'
                            ? 'Huỷ đúng hạn'
                            : 'No-show (Bỏ buổi)'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
