'use client';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Check, X, Trash2, Ban } from 'lucide-react';
import {
  AttendanceStatus,
  BookingStatus,
  type ClassBookingDetail,
  type EmployeeDetail,
  type PaginatedClassSchedulesResponse,
  type PaginatedPtBookingsResponse,
  type PtAvailabilityDetail,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { apiClient, ApiClientError } from '@/services/api-client';

interface SessionAttendee {
  bookingId: string;
  memberCode: string;
  memberName: string;
  sessionTitle: string;
  sessionType: 'Group Class' | 'PT 1-on-1';
  timeSlot: string;
  attendanceStatus: 'Booked' | 'Present' | 'No-Show' | 'Cancelled';
  avatarUrl: string | null;
}

interface TrainerSlotItem {
  slotId: string;
  dayLabel: string;
  timeWindow: string;
  status: 'Open' | 'Booked';
  bookedBy?: string;
}

function getInitials(fullName: string): string {
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'HV'
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sắp tới';
  return d.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return '09:00 – 10:00';
  }
  const fmt = (dt: Date) =>
    dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function mapAttendanceToUi(
  status: BookingStatus,
  attendance: AttendanceStatus,
): SessionAttendee['attendanceStatus'] {
  if (status === BookingStatus.CANCELLED) return 'Cancelled';
  if (
    attendance === AttendanceStatus.PRESENT ||
    status === BookingStatus.COMPLETED
  ) {
    return 'Present';
  }
  if (
    attendance === AttendanceStatus.NO_SHOW ||
    attendance === AttendanceStatus.ABSENT ||
    status === BookingStatus.NO_SHOW
  ) {
    return 'No-Show';
  }
  return 'Booked';
}

export default function PtAttendanceAndSlotsPage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<ReadonlyArray<SessionAttendee>>([]);
  const [slots, setSlots] = useState<ReadonlyArray<TrainerSlotItem>>([]);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [confirmActionKey, setConfirmActionKey] = useState<string | null>(null);

  // Add Available Slot Modal
  const [isSlotModalOpen, setIsSlotModalOpen] = useState(false);
  const [slotDate, setSlotDate] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [slotStartTime, setSlotStartTime] = useState('14:00');
  const [slotEndTime, setSlotEndTime] = useState('15:00');
  const [slotNote, setSlotNote] = useState('Huấn luyện cá nhân 1 kèm 1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasLoadedRef = useRef(false);

  const loadTrainerWorkspace = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [meRes, ptBookingsRes, schedulesRes] = await Promise.allSettled([
        apiClient.get<EmployeeDetail>('/employees/me'),
        apiClient.get<PaginatedPtBookingsResponse>(
          '/pt-bookings/trainer?limit=30',
        ),
        apiClient.get<PaginatedClassSchedulesResponse>(
          '/class-schedules?limit=25',
        ),
      ]);
      assertDataLoaded([schedulesRes], false);
      assertDataLoaded([ptBookingsRes], false);
      assertDataLoaded([meRes], false);

      const myEmployee = meRes.status === 'fulfilled' ? meRes.value : null;
      const ptBookings =
        ptBookingsRes.status === 'fulfilled' ? ptBookingsRes.value.data : [];
      const allSchedules =
        schedulesRes.status === 'fulfilled' ? schedulesRes.value.data : [];

      const mySchedules = myEmployee
        ? allSchedules.filter((s) => s.trainerId === myEmployee.id)
        : [];

      const classRostersRes = await Promise.allSettled(
        mySchedules
          .slice(0, 6)
          .map((sch) =>
            apiClient.get<ClassBookingDetail[]>(
              `/class-bookings/schedule/${sch.id}`,
            ),
          ),
      );
      assertDataLoaded(classRostersRes);

      const combinedRoster: SessionAttendee[] = [];

      classRostersRes.forEach((res) => {
        if (res.status === 'fulfilled') {
          res.value.forEach((bk) => {
            combinedRoster.push({
              bookingId: bk.id,
              memberCode: bk.memberCode,
              memberName: bk.memberFullName,
              sessionTitle: bk.className,
              sessionType: 'Group Class',
              timeSlot: `${formatDayLabel(bk.startsAt)} • ${formatTimeRange(bk.startsAt, bk.endsAt)}`,
              attendanceStatus: mapAttendanceToUi(bk.status, bk.attendance),
              avatarUrl: bk.memberIdPhotoUrl ?? null,
            });
          });
        }
      });

      ptBookings.forEach((ptBk) => {
        combinedRoster.push({
          bookingId: ptBk.id,
          memberCode: ptBk.memberCode,
          memberName: ptBk.memberFullName,
          sessionTitle: 'Huấn luyện PT 1 kèm 1',
          sessionType: 'PT 1-on-1',
          timeSlot: `${formatDayLabel(ptBk.startsAt)} • ${formatTimeRange(ptBk.startsAt, ptBk.endsAt)}`,
          attendanceStatus: mapAttendanceToUi(ptBk.status, ptBk.attendance),
          avatarUrl: ptBk.memberIdPhotoUrl ?? null,
        });
      });

      if (
        ptBookingsRes.status === 'fulfilled' ||
        schedulesRes.status === 'fulfilled'
      ) {
        setRoster(combinedRoster);
      }

      const targetTrainerId = myEmployee?.id ?? null;
      if (targetTrainerId) {
        const availRes = await apiClient.get<PtAvailabilityDetail[]>(
          `/trainers/${targetTrainerId}/availabilities`,
        );
        setSlots(
          availRes.map((av) => {
            const matchingPtBk = ptBookings.find(
              (b) =>
                b.availabilityId === av.id &&
                b.status !== BookingStatus.CANCELLED,
            );
            return {
              slotId: av.id,
              dayLabel: formatDayLabel(av.startsAt),
              timeWindow: formatTimeRange(av.startsAt, av.endsAt),
              status: av.isAvailable && !matchingPtBk ? 'Open' : 'Booked',
              bookedBy: matchingPtBk
                ? `${matchingPtBk.memberFullName} (${matchingPtBk.memberCode})`
                : av.note || undefined,
            };
          }),
        );
      }
      hasLoadedRef.current = true;
    } catch {
      setLoadError('Không thể tải đầy đủ dữ liệu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTrainerWorkspace();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTrainerWorkspace]);

  const handleMarkStatus = async (
    entry: SessionAttendee,
    nextStatus: 'Present' | 'No-Show' | 'Cancelled',
  ) => {
    try {
      if (entry.sessionType === 'Group Class') {
        const attendance =
          nextStatus === 'Present'
            ? AttendanceStatus.PRESENT
            : AttendanceStatus.NO_SHOW;
        await apiClient.post(`/class-bookings/${entry.bookingId}/attendance`, {
          attendance,
        });
        setFeedbackBanner(
          `Đã ghi nhận ${entry.memberName} (${nextStatus === 'Present' ? 'Có mặt' : 'Vắng mặt'}) tại lớp ${entry.sessionTitle}.`,
        );
      } else {
        if (nextStatus === 'Cancelled') {
          await apiClient.post(`/pt-bookings/${entry.bookingId}/cancel`, {});
          setFeedbackBanner(
            `Đã huỷ lịch PT 1-1 của ${entry.memberName} và hoàn lại lượt tập.`,
          );
        } else if (nextStatus === 'Present') {
          await apiClient.post(`/pt-bookings/${entry.bookingId}/attendance`, {
            attendance: AttendanceStatus.PRESENT,
          });
          await apiClient
            .post(`/pt-bookings/${entry.bookingId}/complete`, {})
            .catch(() => null);
          setFeedbackBanner(
            `Đã xác nhận hoàn thành buổi tập PT 1-1 cho ${entry.memberName}.`,
          );
        } else {
          await apiClient.post(`/pt-bookings/${entry.bookingId}/attendance`, {
            attendance: AttendanceStatus.NO_SHOW,
          });
          setFeedbackBanner(
            `Đã ghi nhận vắng mặt không báo trước cho ${entry.memberName}.`,
          );
        }
      }
      await loadTrainerWorkspace();
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : `Không thể cập nhật điểm danh cho ${entry.memberName}.`,
      );
    }
  };

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const startsAtIso = new Date(
      `${slotDate}T${slotStartTime}:00`,
    ).toISOString();
    const endsAtIso = new Date(`${slotDate}T${slotEndTime}:00`).toISOString();

    try {
      await apiClient.post<PtAvailabilityDetail>(
        '/trainers/me/availabilities',
        {
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          note: slotNote.trim() || undefined,
        },
      );
      await loadTrainerWorkspace();
      setFeedbackBanner(
        `Đã mở khung giờ PT 1-1 mới (${slotStartTime} – ${slotEndTime}).`,
      );
      setIsSlotModalOpen(false);
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể mở khung giờ PT (vui lòng kiểm tra trùng lịch).',
      );
      setIsSlotModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    try {
      await apiClient.delete(`/trainers/me/availabilities/${slotId}`);
      await loadTrainerWorkspace();
      setFeedbackBanner('Đã xoá khung giờ trống PT 1-1.');
    } catch (err) {
      setFeedbackBanner(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể xoá khung giờ này.',
      );
    }
  };

  const groupCount = roster.filter(
    (r) => r.sessionType === 'Group Class',
  ).length;
  const ptCount = roster.filter((r) => r.sessionType === 'PT 1-on-1').length;
  const presentCount = roster.filter(
    (r) => r.attendanceStatus === 'Present',
  ).length;
  const openSlotsCount = slots.filter((s) => s.status === 'Open').length;

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadTrainerWorkspace()}
      />
    );

  return (
    <div className="space-y-6">
      {/* Header & Top Action Button */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Điểm danh &amp; Slot PT 1-1
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsSlotModalOpen(true)}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Mở Slot PT
        </button>
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

      {/* Main Row: Session Attendance Table (7 cols) + 1-on-1 Availability Slots (5 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Today's Roster & Attendance */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">
                Danh sách học viên &amp; Điểm danh
              </h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                Xác nhận có mặt để hoàn tất buổi tập hoặc huỷ ca PT 1-1 để hoàn
                lại lượt tập cho hội viên
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#18181C] px-3 py-1 text-[13px] tabular-nums text-zinc-300">
              <span>
                Có mặt:{' '}
                <strong className="text-emerald-400">
                  {presentCount}/{roster.length}
                </strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span>{groupCount} Group Class</span>
              <span className="text-zinc-600">•</span>
              <span>{ptCount} PT 1-1</span>
            </div>
          </div>

          <div className="space-y-3">
            {roster.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-10 text-center text-[13px] text-zinc-500">
                Chưa có học viên nào đặt lịch trong ca dạy hôm nay của bạn.
              </div>
            ) : (
              roster.map((entry) => {
                const noShowKey = `${entry.bookingId}:No-Show`;
                const cancelKey = `${entry.bookingId}:Cancelled`;
                return (
                  <div
                    key={entry.bookingId}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-white/[0.06] bg-[#18181C] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      {entry.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.avatarUrl}
                          alt={entry.memberName}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FF5500]/15 text-[13px] font-bold text-[#FF5500]">
                          {getInitials(entry.memberName)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-white">
                            {entry.memberName}
                          </p>
                          <span className="font-mono text-[13px] text-zinc-500">
                            {entry.memberCode}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-zinc-300">
                          {entry.sessionTitle}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[13px] font-semibold',
                              entry.sessionType === 'Group Class'
                                ? 'bg-[#FF5500]/15 text-[#FF5500]'
                                : 'bg-amber-500/15 text-amber-400',
                            )}
                          >
                            {entry.sessionType === 'Group Class'
                              ? 'Group Class'
                              : 'PT 1-1'}
                          </span>
                          <span className="text-[13px] tabular-nums text-zinc-500">
                            {entry.timeSlot}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmActionKey(null);
                          void handleMarkStatus(entry, 'Present');
                        }}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors',
                          entry.attendanceStatus === 'Present'
                            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                            : 'border-white/[0.08] bg-[#141418] text-zinc-400 hover:text-white',
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Có mặt
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirmActionKey === noShowKey) {
                            setConfirmActionKey(null);
                            void handleMarkStatus(entry, 'No-Show');
                          } else {
                            setConfirmActionKey(noShowKey);
                            window.setTimeout(() => {
                              setConfirmActionKey((prev) =>
                                prev === noShowKey ? null : prev,
                              );
                            }, 3000);
                          }
                        }}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors',
                          confirmActionKey === noShowKey
                            ? 'border-red-500 bg-red-500 text-white'
                            : entry.attendanceStatus === 'No-Show'
                              ? 'border-red-500/50 bg-red-500/20 text-red-300'
                              : 'border-white/[0.08] bg-[#141418] text-zinc-400 hover:text-white',
                        )}
                      >
                        <X className="h-3.5 w-3.5" />
                        {confirmActionKey === noShowKey
                          ? 'Bấm lần 2: No-show'
                          : 'No-show (Bỏ buổi)'}
                      </button>

                      {entry.sessionType === 'PT 1-on-1' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirmActionKey === cancelKey) {
                              setConfirmActionKey(null);
                              void handleMarkStatus(entry, 'Cancelled');
                            } else {
                              setConfirmActionKey(cancelKey);
                              window.setTimeout(() => {
                                setConfirmActionKey((prev) =>
                                  prev === cancelKey ? null : prev,
                                );
                              }, 3000);
                            }
                          }}
                          title="Huỷ ca PT 1-1 và hoàn lượt tập"
                          className={cn(
                            'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
                            confirmActionKey === cancelKey
                              ? 'border-amber-500 bg-amber-500 text-zinc-950 font-semibold'
                              : entry.attendanceStatus === 'Cancelled'
                                ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                                : 'border-white/[0.08] bg-[#141418] text-zinc-400 hover:text-amber-400',
                          )}
                        >
                          <Ban className="h-3 w-3" />
                          {confirmActionKey === cancelKey
                            ? 'Xác nhận huỷ?'
                            : 'Huỷ ca'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: My 1-on-1 Availability Slots */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6 lg:col-span-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">
                Slot trống PT 1-1 của tôi
              </h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                Hệ thống tự động đối chiếu với lịch dạy Group Class để tránh
                trùng giờ
              </p>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[13px] font-semibold tabular-nums text-emerald-400">
              Slot trống: {openSlotsCount}/{slots.length}
            </span>
          </div>

          <div className="space-y-3">
            {slots.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-10 text-center text-[13px] text-zinc-500">
                Chưa có khung giờ PT 1-1 nào. Bấm &ldquo;Mở Slot PT&rdquo; để
                tạo lịch rảnh.
              </div>
            ) : (
              slots.map((slot) => (
                <div
                  key={slot.slotId}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#18181C] p-3.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-white">
                        {slot.dayLabel}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums text-[#FF5500]">
                        {slot.timeWindow}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-zinc-400">
                      {slot.bookedBy
                        ? `Học viên: ${slot.bookedBy}`
                        : 'Đang mở cho hội viên đặt lịch'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[13px] font-semibold',
                        slot.status === 'Booked'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
                      )}
                    >
                      {slot.status === 'Booked' ? 'Đã đặt' : 'Còn trống'}
                    </span>
                    {slot.status === 'Open' && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteSlot(slot.slotId)}
                        title="Xoá khung giờ trống"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal: Add Available 1-on-1 Slot */}
      {isSlotModalOpen && (
        <ModalFrame
          onClose={() => setIsSlotModalOpen(false)}
          labelledBy="app-dashboard-pt-page-heading-0"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3
                className="text-base font-bold text-white"
                id="app-dashboard-pt-page-heading-0"
              >
                Mở khung giờ huấn luyện PT 1-1
              </h3>
              <button
                type="button"
                onClick={() => setIsSlotModalOpen(false)}
                className="text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[13px] text-zinc-400">
              Đăng ký khung giờ rảnh để hội viên có lượt PT 1-1 đặt lịch tập
            </p>

            <form onSubmit={handleCreateSlot} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                  Ngày dạy
                </label>
                <input
                  type="date"
                  required
                  value={slotDate}
                  onChange={(e) => setSlotDate(e.target.value)}
                  aria-label="Ngày dạy"
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                    Giờ bắt đầu
                  </label>
                  <input
                    type="time"
                    required
                    value={slotStartTime}
                    onChange={(e) => setSlotStartTime(e.target.value)}
                    aria-label="Giờ bắt đầu"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                    Giờ kết thúc
                  </label>
                  <input
                    type="time"
                    required
                    value={slotEndTime}
                    onChange={(e) => setSlotEndTime(e.target.value)}
                    aria-label="Giờ kết thúc"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[13px] font-medium text-zinc-300">
                  Nội dung trọng tâm / Ghi chú
                </label>
                <input
                  type="text"
                  value={slotNote}
                  onChange={(e) => setSlotNote(e.target.value)}
                  placeholder="VD: Tăng cơ, Giảm mỡ, Phục hồi..."
                  className="h-10 w-full rounded-xl border border-white/10 bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSlotModalOpen(false)}
                  className="h-9 rounded-xl border border-white/10 px-4 text-[13px] font-semibold text-zinc-300"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Mở khung giờ'}
                </button>
              </div>
            </form>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
