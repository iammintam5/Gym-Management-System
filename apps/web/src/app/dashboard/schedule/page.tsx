'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  Clock,
  ChevronDown,
  X,
  Calendar,
  Settings2,
  Ban,
  Pencil,
  Check,
  RotateCcw,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  AttendanceStatus,
  BookingStatus,
  ScheduleStatus,
  UserRole,
  type ClassScheduleBookingSummary,
  type ClassScheduleDetail,
  type GymClassDetail,
  type PaginatedClassesResponse,
  type PaginatedClassSchedulesResponse,
  type TrainerSummary,
} from '@gym/contracts';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { DataState, assertDataLoaded } from '@/components/shared/data-state';
import { Dialog } from '@/components/ui/dialog';
import { apiClient, ApiClientError } from '@/services/api-client';

type DayOfWeekKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface ClassSession {
  id: string;
  classId: string;
  timeRange: string;
  startTimeHm: string;
  startsAtIso: string;
  endsAtIso: string;
  durationMinutes: number;
  title: string;
  coach: string;
  trainerId: string;
  bookedCount: number;
  capacity: number;
  remainingSlots: number;
  status: ScheduleStatus;
  isPast: boolean;
}

interface DayColumn {
  key: DayOfWeekKey;
  day: string;
  fullDayLabel: string;
  date: string;
  fullDate: string;
  isoDate: string;
  isToday: boolean;
  sessions: ReadonlyArray<ClassSession>;
}

const DAY_META: ReadonlyArray<{
  key: DayOfWeekKey;
  label: string;
  fullLabel: string;
}> = [
  { key: 'Mon', label: 'Thứ 2', fullLabel: 'Thứ Hai' },
  { key: 'Tue', label: 'Thứ 3', fullLabel: 'Thứ Ba' },
  { key: 'Wed', label: 'Thứ 4', fullLabel: 'Thứ Tư' },
  { key: 'Thu', label: 'Thứ 5', fullLabel: 'Thứ Năm' },
  { key: 'Fri', label: 'Thứ 6', fullLabel: 'Thứ Sáu' },
  { key: 'Sat', label: 'Thứ 7', fullLabel: 'Thứ Bảy' },
  { key: 'Sun', label: 'Chủ nhật', fullLabel: 'Chủ Nhật' },
];

function toLocalIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function computeWeekDays(weekOffset: number): ReadonlyArray<{
  key: DayOfWeekKey;
  day: string;
  fullDayLabel: string;
  date: string;
  fullDate: string;
  isoDate: string;
  isToday: boolean;
}> {
  const now = new Date();
  const todayIso = toLocalIsoDate(now);
  const currentDay = now.getDay();
  const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMon + weekOffset * 7);

  return DAY_META.map((item, idx) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + idx);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const isoDate = toLocalIsoDate(d);
    return {
      key: item.key,
      day: item.label,
      fullDayLabel: item.fullLabel,
      date: `${dd}/${mm}`,
      fullDate: `${dd}/${mm}/${yyyy}`,
      isoDate,
      isToday: isoDate === todayIso,
    };
  });
}

function calculateEndTimeHm(startTimeHm: string, durationMins: number): string {
  const parts = startTimeHm.split(':');
  const hh = Number(parts[0] ?? 0);
  const mm = Number(parts[1] ?? 0);
  if (Number.isNaN(hh) || Number.isNaN(mm) || durationMins <= 0) {
    return '--:--';
  }
  const totalMinutes = hh * 60 + mm + durationMins;
  const endHh = Math.floor(totalMinutes / 60) % 24;
  const endMm = totalMinutes % 60;
  return `${String(endHh).padStart(2, '0')}:${String(endMm).padStart(2, '0')}`;
}

function getSmartDefaultScheduleDateTime(preferredIsoDate?: string): {
  isoDate: string;
  startTimeHm: string;
} {
  const now = new Date();
  const todayIso = toLocalIsoDate(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowIso = toLocalIsoDate(tomorrow);

  if (preferredIsoDate && preferredIsoDate > todayIso) {
    return { isoDate: preferredIsoDate, startTimeHm: '08:00' };
  }

  const nextHour = now.getHours() + 1;
  if (nextHour <= 20) {
    const startHour = Math.max(8, nextHour);
    return {
      isoDate: todayIso,
      startTimeHm: `${String(startHour).padStart(2, '0')}:00`,
    };
  }

  return { isoDate: tomorrowIso, startTimeHm: '08:00' };
}

function formatVietnameseDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const dt = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function computeWeekOffsetForIsoDate(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;

  const now = new Date();
  const currentDay = now.getDay();
  const diffToCurrentMon = currentDay === 0 ? -6 : 1 - currentDay;
  const currentMonday = new Date(now);
  currentMonday.setHours(0, 0, 0, 0);
  currentMonday.setDate(now.getDate() + diffToCurrentMon);

  const targetDay = target.getDay();
  const diffToTargetMon = targetDay === 0 ? -6 : 1 - targetDay;
  const targetMonday = new Date(target);
  targetMonday.setHours(0, 0, 0, 0);
  targetMonday.setDate(target.getDate() + diffToTargetMon);

  const diffDays = Math.round(
    (targetMonday.getTime() - currentMonday.getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.round(diffDays / 7);
}

export default function ClassSchedulePage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = Boolean(user?.roles?.includes(UserRole.ADMIN));
  const isStaff = Boolean(user?.roles?.includes(UserRole.STAFF));
  const canManageSchedule = isAdmin || isStaff;

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedClassIdFilter, setSelectedClassIdFilter] =
    useState<string>('ALL');
  const [selectedCoachFilter, setSelectedCoachFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [classTemplates, setClassTemplates] = useState<
    ReadonlyArray<GymClassDetail>
  >([]);
  const [eligibleClassTrainers, setEligibleClassTrainers] = useState<
    ReadonlyArray<TrainerSummary>
  >([]);
  const [trainerOptions, setTrainerOptions] = useState<
    ReadonlyArray<TrainerSummary>
  >([]);
  const [scheduleColumns, setScheduleColumns] = useState<
    ReadonlyArray<DayColumn>
  >(() =>
    computeWeekDays(0).map((d) => ({
      ...d,
      sessions: [],
    })),
  );

  // Modal 1: Add / Edit / Inspect Class Schedule Session
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [editingBookedCount, setEditingBookedCount] = useState<number>(0);
  const [modalTab, setModalTab] = useState<'FORM' | 'ROSTER'>('FORM');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);

  const [formClassId, setFormClassId] = useState('');
  const [formTrainerId, setFormTrainerId] = useState('');
  const [formDate, setFormDate] = useState(() => toLocalIsoDate(new Date()));
  const [formStartTime, setFormStartTime] = useState('08:00');
  const [formDurationMinutes, setFormDurationMinutes] = useState('60');
  const [formCapacity, setFormCapacity] = useState('20');
  const [confirmCancelSchedule, setConfirmCancelSchedule] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Roster inside Modal 1
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterItems, setRosterItems] = useState<
    ReadonlyArray<ClassScheduleBookingSummary>
  >([]);

  // Modal 2: Manage Class Types (Admin)
  const [classTypesModalOpen, setClassTypesModalOpen] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDesc, setNewClassDesc] = useState('');
  const [classModalError, setClassModalError] = useState<string | null>(null);
  const [isSubmittingClass, setIsSubmittingClass] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassDesc, setEditClassDesc] = useState('');
  const hasLoadedRef = useRef(false);

  const loadScheduleData = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    const weekCols = computeWeekDays(weekOffset);
    const firstDayIso = weekCols[0]?.isoDate;
    const lastDayIso = weekCols[weekCols.length - 1]?.isoDate;

    const fromIso = firstDayIso
      ? new Date(`${firstDayIso}T00:00:00`).toISOString()
      : '';
    const toIso = lastDayIso
      ? new Date(`${lastDayIso}T23:59:59.999`).toISOString()
      : '';
    const scheduleQuery =
      fromIso && toIso
        ? `/class-schedules?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&limit=100`
        : '/class-schedules?limit=100';

    try {
      const [classesRes, schedulesRes, trainersRes] = await Promise.allSettled([
        apiClient<PaginatedClassesResponse>('/classes?limit=100'),
        apiClient<PaginatedClassSchedulesResponse>(scheduleQuery),
        apiClient<TrainerSummary[]>('/trainers?service=CLASS'),
      ]);

      assertDataLoaded([classesRes, schedulesRes]);

      if (classesRes.status === 'fulfilled') {
        const list = classesRes.value.data;
        setClassTemplates(list);
        const firstActive = list.find((c) => c.isActive) ?? list[0];
        if (firstActive) {
          setFormClassId((prev) => prev || firstActive.id);
        }
      }

      const eligibleList =
        trainersRes.status === 'fulfilled' ? trainersRes.value : [];
      setEligibleClassTrainers(eligibleList);

      const trainerMap = new Map<string, TrainerSummary>();
      for (const t of eligibleList) {
        trainerMap.set(t.id, t);
      }

      if (schedulesRes.status === 'fulfilled') {
        for (const sch of schedulesRes.value.data) {
          if (sch.trainerId && !trainerMap.has(sch.trainerId)) {
            trainerMap.set(sch.trainerId, {
              id: sch.trainerId,
              fullName: sch.trainerName,
              specialization: null,
              specialties: [],
              canTeachClasses: false,
              canCoachPt: false,
            });
          }
        }
      }

      setTrainerOptions(Array.from(trainerMap.values()));
      if (eligibleList[0]) {
        const defaultTrainerId = eligibleList[0].id;
        setFormTrainerId((prev) => prev || defaultTrainerId);
      }

      if (schedulesRes.status === 'fulfilled') {
        const grouped: Record<DayOfWeekKey, ClassSession[]> = {
          Mon: [],
          Tue: [],
          Wed: [],
          Thu: [],
          Fri: [],
          Sat: [],
          Sun: [],
        };

        const dateToKey = new Map<string, DayOfWeekKey>();
        for (const col of weekCols) {
          dateToKey.set(col.isoDate, col.key);
        }

        const nowMs = Date.now();
        const activeSchedules = schedulesRes.value.data.filter(
          (sch) => sch.status !== ScheduleStatus.CANCELLED,
        );

        for (const sch of activeSchedules) {
          const startDt = new Date(sch.startsAt);
          const endDt = new Date(sch.endsAt);
          if (Number.isNaN(startDt.getTime())) continue;

          const startIsoDate = toLocalIsoDate(startDt);
          const matchedKey = dateToKey.get(startIsoDate);
          if (!matchedKey) continue;

          const startHh = String(startDt.getHours()).padStart(2, '0');
          const startMm = String(startDt.getMinutes()).padStart(2, '0');
          const startTimeHm = `${startHh}:${startMm}`;

          const endStr = Number.isNaN(endDt.getTime())
            ? ''
            : ` - ${String(endDt.getHours()).padStart(2, '0')}:${String(endDt.getMinutes()).padStart(2, '0')}`;

          const durationMinutes =
            !Number.isNaN(endDt.getTime()) &&
            endDt.getTime() > startDt.getTime()
              ? Math.round((endDt.getTime() - startDt.getTime()) / 60000)
              : 60;

          const isPast =
            sch.status === ScheduleStatus.COMPLETED ||
            (!Number.isNaN(endDt.getTime())
              ? endDt.getTime() < nowMs
              : startDt.getTime() < nowMs);

          grouped[matchedKey].push({
            id: sch.id,
            classId: sch.classId,
            timeRange: `${startTimeHm}${endStr}`,
            startTimeHm,
            startsAtIso: sch.startsAt,
            endsAtIso: sch.endsAt,
            durationMinutes,
            title: sch.className,
            coach: sch.trainerName,
            trainerId: sch.trainerId,
            bookedCount: sch.bookedCount,
            capacity: sch.capacity,
            remainingSlots: sch.remainingSlots,
            status: sch.status,
            isPast,
          });
        }

        for (const key of Object.keys(grouped) as DayOfWeekKey[]) {
          grouped[key].sort((a, b) =>
            a.startsAtIso.localeCompare(b.startsAtIso),
          );
        }

        setScheduleColumns(
          weekCols.map((col) => ({
            ...col,
            sessions: grouped[col.key],
          })),
        );
      } else {
        setScheduleColumns(
          weekCols.map((col) => ({
            ...col,
            sessions: [],
          })),
        );
      }
      hasLoadedRef.current = true;
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối máy chủ để tải lịch lớp nhóm.',
      );
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadScheduleData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadScheduleData]);

  const loadSessionRoster = useCallback(async (scheduleId: string) => {
    setRosterLoading(true);
    try {
      const list = await apiClient<ClassScheduleBookingSummary[]>(
        `/class-schedules/${scheduleId}/bookings`,
      );
      setRosterItems(Array.isArray(list) ? list : []);
    } catch {
      setRosterItems([]);
    } finally {
      setRosterLoading(false);
    }
  }, []);

  const openCreateSessionModal = (preferredIsoDate?: string) => {
    setEditingScheduleId(null);
    setEditingBookedCount(0);
    setConfirmCancelSchedule(false);
    setCancelReason('');
    setModalError(null);
    setModalTab('FORM');
    setRosterItems([]);

    const defaults = getSmartDefaultScheduleDateTime(preferredIsoDate);
    setFormDate(defaults.isoDate);
    setFormStartTime(defaults.startTimeHm);

    const firstActiveClass =
      classTemplates.find((c) => c.isActive) ?? classTemplates[0];
    if (firstActiveClass) {
      setFormClassId(firstActiveClass.id);
    }
    setFormTrainerId((prev) =>
      eligibleClassTrainers.some((t) => t.id === prev)
        ? prev
        : (eligibleClassTrainers[0]?.id ?? ''),
    );
    setFormDurationMinutes('60');
    setFormCapacity('20');
    setScheduleModalOpen(true);
  };

  const openInspectOrEditSessionModal = (
    session: ClassSession,
    isoDate: string,
  ) => {
    setEditingScheduleId(session.id);
    setEditingBookedCount(session.bookedCount);
    setConfirmCancelSchedule(false);
    setCancelReason('');
    setModalError(null);
    setModalTab(canManageSchedule ? 'FORM' : 'ROSTER');

    setFormClassId(session.classId);
    setFormTrainerId(session.trainerId || (trainerOptions[0]?.id ?? ''));
    setFormDate(isoDate);
    setFormStartTime(session.startTimeHm || '08:00');
    setFormDurationMinutes(String(session.durationMinutes || 60));
    setFormCapacity(String(session.capacity));
    setScheduleModalOpen(true);

    void loadSessionRoster(session.id);
  };

  const handleSaveScheduleSession = async () => {
    setModalError(null);
    if (!formDate || !formClassId || !formTrainerId) {
      setModalError(
        'Vui lòng chọn đầy đủ bộ môn, huấn luyện viên và ngày học.',
      );
      return;
    }

    const durationMins = Number(formDurationMinutes);
    if (Number.isNaN(durationMins) || durationMins < 30 || durationMins > 180) {
      setModalError('Thời lượng mỗi ca học nhóm phải từ 30 đến 180 phút.');
      return;
    }

    const capacityNum = Number(formCapacity);
    if (Number.isNaN(capacityNum) || capacityNum < 1) {
      setModalError('Sức chứa lớp học phải lớn hơn 0.');
      return;
    }

    if (editingScheduleId && capacityNum < editingBookedCount) {
      setModalError(
        `Không thể giảm sức chứa xuống thấp hơn số học viên đã đặt chỗ hiện tại.`,
      );
      return;
    }

    const startsAtDate = new Date(`${formDate}T${formStartTime}:00`);
    if (Number.isNaN(startsAtDate.getTime())) {
      setModalError('Ngày hoặc giờ bắt đầu không hợp lệ.');
      return;
    }

    if (!editingScheduleId && startsAtDate.getTime() <= Date.now()) {
      setModalError(
        'Thời gian bắt đầu ca học phải lớn hơn thời điểm hiện tại.',
      );
      return;
    }

    const endsAtDate = new Date(
      startsAtDate.getTime() + durationMins * 60 * 1000,
    );

    setIsSubmittingSchedule(true);
    try {
      if (editingScheduleId) {
        await apiClient.patch<ClassScheduleDetail>(
          `/class-schedules/${editingScheduleId}`,
          {
            trainerId: formTrainerId,
            startsAt: startsAtDate.toISOString(),
            endsAt: endsAtDate.toISOString(),
            capacity: capacityNum,
          },
        );
      } else {
        await apiClient.post<ClassScheduleDetail>('/class-schedules', {
          classId: formClassId,
          trainerId: formTrainerId,
          startsAt: startsAtDate.toISOString(),
          endsAt: endsAtDate.toISOString(),
          capacity: capacityNum,
        });
      }

      const selectedClass = classTemplates.find((c) => c.id === formClassId);
      const formattedDate = formatVietnameseDateDisplay(formDate);
      setScheduleModalOpen(false);
      setEditingScheduleId(null);
      setFeedbackBanner({
        type: 'success',
        message: editingScheduleId
          ? `Đã cập nhật lịch lớp ${selectedClass?.name ?? ''} vào ${formattedDate} lúc ${formStartTime}.`
          : `Đã xếp lịch lớp ${selectedClass?.name ?? ''} vào ${formattedDate} lúc ${formStartTime}.`,
      });

      const targetOffset = computeWeekOffsetForIsoDate(formDate);
      if (targetOffset !== weekOffset) {
        setWeekOffset(targetOffset);
      } else {
        await loadScheduleData();
      }
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : 'Không thể lưu lịch lớp học (có thể trùng ca dạy của HLV).';
      setModalError(msg);
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const handleCancelScheduleSession = async (
    scheduleId: string,
    title: string,
  ) => {
    setModalError(null);
    setIsSubmittingSchedule(true);
    try {
      await apiClient.post(`/class-schedules/${scheduleId}/cancel`, {
        reason:
          cancelReason.trim() ||
          'Huỷ ca học và hoàn lại lượt đặt chỗ cho hội viên',
      });
      setConfirmCancelSchedule(false);
      setCancelReason('');
      setScheduleModalOpen(false);
      setEditingScheduleId(null);
      setFeedbackBanner({
        type: 'success',
        message: `Đã huỷ ca học "${title}" và tự động hoàn lượt cho các hội viên đã đăng ký.`,
      });
      await loadScheduleData();
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : 'Không thể huỷ ca học.';
      setModalError(msg);
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const handleCreateClassTemplate = async () => {
    if (!newClassName.trim()) {
      setClassModalError('Vui lòng nhập tên bộ môn lớp nhóm.');
      return;
    }
    setClassModalError(null);
    setIsSubmittingClass(true);
    try {
      const created = await apiClient.post<GymClassDetail>('/classes', {
        name: newClassName.trim(),
        description:
          newClassDesc.trim() || 'Lớp huấn luyện nhóm tiêu chuẩn tại phòng tập',
      });
      setNewClassName('');
      setNewClassDesc('');
      setFormClassId(created.id);
      setFeedbackBanner({
        type: 'success',
        message: `Đã tạo bộ môn mới: ${created.name}.`,
      });
      await loadScheduleData();
    } catch (err) {
      setClassModalError(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể tạo bộ môn mới.',
      );
    } finally {
      setIsSubmittingClass(false);
    }
  };

  const startEditClassTemplate = (cls: GymClassDetail) => {
    setEditingClassId(cls.id);
    setEditClassName(cls.name);
    setEditClassDesc(cls.description ?? '');
    setClassModalError(null);
  };

  const handleSaveClassTemplateEdit = async (classId: string) => {
    if (!editClassName.trim()) {
      setClassModalError('Tên bộ môn không được để trống.');
      return;
    }
    setClassModalError(null);
    setIsSubmittingClass(true);
    try {
      await apiClient.patch<GymClassDetail>(`/classes/${classId}`, {
        name: editClassName.trim(),
        description: editClassDesc.trim() || undefined,
      });
      setEditingClassId(null);
      await loadScheduleData();
    } catch (err) {
      setClassModalError(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể cập nhật thông tin bộ môn.',
      );
    } finally {
      setIsSubmittingClass(false);
    }
  };

  const handleToggleClassTemplateStatus = async (cls: GymClassDetail) => {
    setClassModalError(null);
    try {
      await apiClient.patch<GymClassDetail>(`/classes/${cls.id}/status`, {
        isActive: !cls.isActive,
      });
      await loadScheduleData();
    } catch (err) {
      setClassModalError(
        err instanceof ApiClientError
          ? err.message
          : 'Không thể cập nhật trạng thái bộ môn.',
      );
    }
  };

  const filteredColumns = useMemo(() => {
    return scheduleColumns.map((col) => ({
      ...col,
      sessions: col.sessions.filter((s) => {
        const matchClass =
          selectedClassIdFilter === 'ALL' ||
          s.classId === selectedClassIdFilter;
        const matchCoach =
          selectedCoachFilter === 'ALL' || s.trainerId === selectedCoachFilter;
        return matchClass && matchCoach;
      }),
    }));
  }, [scheduleColumns, selectedClassIdFilter, selectedCoachFilter]);

  const firstDay = scheduleColumns[0]?.date ?? '';
  const lastDay = scheduleColumns[scheduleColumns.length - 1]?.fullDate ?? '';
  const hasActiveFilter =
    selectedClassIdFilter !== 'ALL' || selectedCoachFilter !== 'ALL';

  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);
  const selectedFormClass = useMemo(
    () => classTemplates.find((c) => c.id === formClassId),
    [classTemplates, formClassId],
  );
  const selectedDateDisplay = useMemo(
    () => formatVietnameseDateDisplay(formDate),
    [formDate],
  );
  const previewEndTimeHm = useMemo(
    () => calculateEndTimeHm(formStartTime, Number(formDurationMinutes) || 0),
    [formStartTime, formDurationMinutes],
  );
  const modalTrainerOptions = useMemo(() => {
    if (!editingScheduleId) {
      return eligibleClassTrainers;
    }
    if (!formTrainerId || eligibleClassTrainers.some((t) => t.id === formTrainerId)) {
      return eligibleClassTrainers;
    }
    const currentAssigned = trainerOptions.find((t) => t.id === formTrainerId);
    if (!currentAssigned) {
      return eligibleClassTrainers;
    }
    return [
      ...eligibleClassTrainers,
      {
        ...currentAssigned,
        fullName: `${currentAssigned.fullName} (Đang phụ trách ca này)`,
      },
    ];
  }, [editingScheduleId, eligibleClassTrainers, formTrainerId, trainerOptions]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-white">
            Lịch lớp nhóm
          </h1>
          <p className="mt-1 text-[13px] text-zinc-400">
            Thời khóa biểu lớp tập nhóm theo tuần, phân công huấn luyện viên và
            quản lý sĩ số từng ca.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setClassModalError(null);
                setEditingClassId(null);
                setClassTypesModalOpen(true);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#141418] px-3.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:border-white/[0.16] hover:text-white"
            >
              <Settings2 className="h-4 w-4 text-zinc-400" />
              Danh mục bộ môn
            </button>
          )}
          {canManageSchedule && (
            <button
              type="button"
              onClick={() => openCreateSessionModal()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white transition-all hover:bg-[#E64D00] active:scale-[0.98]"
            >
              <Plus className="h-4 w-4 stroke-[2.2]" />
              Thêm ca học
            </button>
          )}
        </div>
      </div>

      {feedbackBanner && (
        <div
          className={cn(
            'flex items-center justify-between rounded-xl border px-4 py-2.5 text-[13px]',
            feedbackBanner.type === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300',
          )}
        >
          <span>{feedbackBanner.message}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="rounded p-1 hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Clean Toolbar: Week Switcher + Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-[#141418] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-white/[0.06] bg-[#0E0E11] p-1">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              Tuần trước
            </button>
            <span className="inline-flex items-center gap-1.5 px-3 text-[13px] font-semibold tabular-nums text-white">
              <Calendar className="h-3.5 w-3.5 text-[#FF5500]" />
              {firstDay} – {lastDay}
            </span>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Tuần sau
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#FF5500]/30 bg-[#FF5500]/10 px-3 text-[12px] font-semibold text-[#FF5500] transition-colors hover:bg-[#FF5500]/20"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Tuần này
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <select
              value={selectedClassIdFilter}
              onChange={(e) => setSelectedClassIdFilter(e.target.value)}
              className="h-9 appearance-none rounded-xl border border-white/[0.06] bg-[#18181C] pl-3.5 pr-9 text-[13px] font-medium text-zinc-200 transition-colors hover:border-white/[0.12] focus:border-[#FF5500] focus:outline-none"
            >
              <option value="ALL" className="bg-[#141418] text-zinc-200">
                Bộ môn: Tất cả
              </option>
              {classTemplates.map((cls) => (
                <option
                  key={cls.id}
                  value={cls.id}
                  className="bg-[#141418] text-zinc-200"
                >
                  {cls.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          </div>

          <div className="relative">
            <select
              value={selectedCoachFilter}
              onChange={(e) => setSelectedCoachFilter(e.target.value)}
              className="h-9 appearance-none rounded-xl border border-white/[0.06] bg-[#18181C] pl-3.5 pr-9 text-[13px] font-medium text-zinc-200 transition-colors hover:border-white/[0.12] focus:border-[#FF5500] focus:outline-none"
            >
              <option value="ALL" className="bg-[#141418] text-zinc-200">
                Huấn luyện viên: Tất cả
              </option>
              {trainerOptions.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  className="bg-[#141418] text-zinc-200"
                >
                  {t.fullName}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSelectedClassIdFilter('ALL');
                setSelectedCoachFilter('ALL');
              }}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[12px] font-medium text-zinc-300 transition-colors hover:border-white/[0.16] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Xoá lọc
            </button>
          )}
        </div>
      </div>

      {/* 7-Column Weekly Grid */}
      <DataState
        loading={loading}
        error={loadError}
        variant="schedule"
        onRetry={() => void loadScheduleData()}
      />

      {!loading && !loadError && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {filteredColumns.map((col) => (
            <div key={col.key} className="flex flex-col space-y-2.5">
              {/* Day Column Header */}
              <div
                className={cn(
                  'flex items-center justify-between rounded-xl border px-3.5 py-2.5',
                  col.isToday
                    ? 'border-[#FF5500]/50 bg-[#FF5500]/[0.08]'
                    : 'border-white/[0.06] bg-[#141418]',
                )}
              >
                <span
                  className={cn(
                    'text-[13px] font-bold',
                    col.isToday ? 'text-[#FF5500]' : 'text-white',
                  )}
                >
                  {col.day}
                </span>
                <span
                  className={cn(
                    'text-[12px] font-medium tabular-nums',
                    col.isToday ? 'text-[#FF5500]' : 'text-zinc-400',
                  )}
                >
                  {col.date}
                </span>
              </div>

              {/* Sessions Stack */}
              <div className="flex-1 space-y-2.5">
                {col.sessions.map((session) => {
                  const isFull = session.bookedCount >= session.capacity;

                  return (
                    <div
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        openInspectOrEditSessionModal(session, col.isoDate)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInspectOrEditSessionModal(session, col.isoDate);
                        }
                      }}
                      className={cn(
                        'group cursor-pointer rounded-2xl border border-white/[0.06] bg-[#141418] p-3.5 transition-all hover:border-[#FF5500]/50',
                        session.isPast && 'opacity-60 hover:opacity-100',
                      )}
                    >
                      <div className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                        <Clock className="h-3 w-3 text-[#FF5500]" />
                        {session.timeRange}
                      </div>

                      <h3 className="mt-2.5 text-[14px] font-bold leading-snug text-white transition-colors group-hover:text-[#FF5500]">
                        {session.title}
                      </h3>

                      <p className="mt-1 truncate text-[12px] text-zinc-400">
                        HLV: {session.coach}
                      </p>

                      <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2.5 text-[12px] tabular-nums">
                        <span className="inline-flex items-center gap-1 font-medium text-zinc-400">
                          <Users className="h-3.5 w-3.5" />
                          {session.bookedCount}/{session.capacity}
                        </span>
                        {isFull && (
                          <span className="text-[11px] font-semibold text-[#FF5500]">
                            Đầy chỗ
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {col.sessions.length === 0 && (
                  <div
                    role={
                      canManageSchedule && col.isoDate >= todayIso
                        ? 'button'
                        : undefined
                    }
                    tabIndex={
                      canManageSchedule && col.isoDate >= todayIso
                        ? 0
                        : undefined
                    }
                    onClick={() => {
                      if (canManageSchedule && col.isoDate >= todayIso) {
                        openCreateSessionModal(col.isoDate);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        canManageSchedule &&
                        col.isoDate >= todayIso &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault();
                        openCreateSessionModal(col.isoDate);
                      }
                    }}
                    className={cn(
                      'flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-white/[0.06] bg-[#141418]/30 p-4 text-center text-[12px] text-zinc-500',
                      canManageSchedule &&
                        col.isoDate >= todayIso &&
                        'cursor-pointer transition-colors hover:border-white/[0.14] hover:text-zinc-300',
                    )}
                  >
                    Trống lịch
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal 1: Add / Edit / Inspect Class Schedule Session */}
      <Dialog
        open={scheduleModalOpen}
        onClose={() => {
          if (!isSubmittingSchedule) {
            setScheduleModalOpen(false);
          }
        }}
        title={
          editingScheduleId
            ? canManageSchedule
              ? 'Cập nhật ca học'
              : 'Chi tiết ca học'
            : 'Xếp lịch ca học'
        }
        description={
          editingScheduleId
            ? 'Điều chỉnh huấn luyện viên, khung giờ hoặc xem danh sách hội viên đăng ký.'
            : 'Chọn bộ môn, huấn luyện viên, khung giờ và sức chứa lớp học.'
        }
        maxWidthClassName="max-w-lg"
      >
        <div className="mt-4 space-y-4">
          {editingScheduleId && canManageSchedule && (
            <div className="grid grid-cols-2 rounded-xl border border-white/[0.06] bg-[#0E0E11] p-1">
              <button
                type="button"
                onClick={() => setModalTab('FORM')}
                className={cn(
                  'h-8 rounded-lg text-[12px] font-semibold transition-colors',
                  modalTab === 'FORM'
                    ? 'bg-[#FF5500] text-white'
                    : 'text-zinc-400 hover:text-white',
                )}
              >
                Thông tin ca học
              </button>
              <button
                type="button"
                onClick={() => setModalTab('ROSTER')}
                className={cn(
                  'h-8 rounded-lg text-[12px] font-semibold transition-colors',
                  modalTab === 'ROSTER'
                    ? 'bg-[#FF5500] text-white'
                    : 'text-zinc-400 hover:text-white',
                )}
              >
                Danh sách học viên
              </button>
            </div>
          )}

          {modalError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{modalError}</span>
            </div>
          )}

          {/* TAB 1: Form */}
          {(!editingScheduleId || modalTab === 'FORM') && canManageSchedule && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                  Bộ môn lớp nhóm
                </label>
                <div className="relative">
                  <select
                    value={formClassId}
                    disabled={Boolean(editingScheduleId)}
                    onChange={(e) => setFormClassId(e.target.value)}
                    className="h-10 w-full appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-3.5 pr-9 text-[13px] text-white transition-colors focus:border-[#FF5500] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {classTemplates
                      .filter((c) => c.isActive || c.id === formClassId)
                      .map((cls) => (
                        <option
                          key={cls.id}
                          value={cls.id}
                          className="bg-[#141418] text-white"
                        >
                          {cls.name}
                        </option>
                      ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                  Huấn luyện viên
                </label>
                <div className="relative">
                  <select
                    value={formTrainerId}
                    onChange={(e) => setFormTrainerId(e.target.value)}
                    className="h-10 w-full appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-3.5 pr-9 text-[13px] text-white transition-colors focus:border-[#FF5500] focus:outline-none"
                  >
                    {modalTrainerOptions.length === 0 ? (
                      <option value="" className="bg-[#141418] text-zinc-400">
                        Chưa có huấn luyện viên phụ trách lớp nhóm
                      </option>
                    ) : (
                      modalTrainerOptions.map((t) => (
                        <option
                          key={t.id}
                          value={t.id}
                          className="bg-[#141418] text-white"
                        >
                          {t.specialties.length > 0
                            ? `${t.fullName} — ${t.specialties.join(', ')}`
                            : t.fullName}
                        </option>
                      ))
                    )}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                    Ngày học
                  </label>
                  <input
                    type="date"
                    min={editingScheduleId ? undefined : todayIso}
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] tabular-nums text-white transition-colors focus:border-[#FF5500] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                    Giờ bắt đầu
                  </label>
                  <input
                    type="time"
                    value={formStartTime}
                    onChange={(e) => setFormStartTime(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] tabular-nums text-white transition-colors focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                    Thời lượng phút
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={180}
                    step={15}
                    value={formDurationMinutes}
                    onChange={(e) => setFormDurationMinutes(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] tabular-nums text-white transition-colors focus:border-[#FF5500] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-zinc-300">
                    Sức chứa tối đa
                  </label>
                  <input
                    type="number"
                    min={Math.max(1, editingBookedCount)}
                    max={100}
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3.5 text-[13px] tabular-nums text-white transition-colors focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#18181C] px-3.5 py-2 text-[12px] text-zinc-400">
                <span className="capitalize">{selectedDateDisplay}</span>
                <span className="font-semibold tabular-nums text-white">
                  {formStartTime} – {previewEndTimeHm}
                </span>
              </div>

              {editingScheduleId && confirmCancelSchedule && (
                <div className="space-y-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5">
                  <p className="text-[12px] font-semibold text-red-300">
                    Xác nhận huỷ ca học này và hoàn lại lượt đặt chỗ cho hội
                    viên?
                  </p>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Lý do huỷ ca học..."
                    className="h-9 w-full rounded-lg border border-red-500/30 bg-[#141418] px-3 text-[12px] text-white placeholder:text-zinc-500 focus:border-red-400 focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSubmittingSchedule}
                      onClick={() => setConfirmCancelSchedule(false)}
                      className="h-8 rounded-lg border border-white/10 bg-[#18181C] px-3 text-[12px] font-medium text-zinc-300 hover:text-white"
                    >
                      Không
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingSchedule}
                      onClick={() =>
                        void handleCancelScheduleSession(
                          editingScheduleId,
                          selectedFormClass?.name ?? 'Lớp học',
                        )
                      }
                      className="h-8 rounded-lg bg-red-500 px-3 text-[12px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      {isSubmittingSchedule ? 'Đang huỷ...' : 'Xác nhận huỷ'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-4">
                {editingScheduleId && !confirmCancelSchedule ? (
                  <button
                    type="button"
                    disabled={isSubmittingSchedule}
                    onClick={() => setConfirmCancelSchedule(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-[13px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Huỷ ca học
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingSchedule}
                    onClick={() => setScheduleModalOpen(false)}
                    className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300 transition-colors hover:text-white"
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingSchedule}
                    onClick={() => void handleSaveScheduleSession()}
                    className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#E64D00] disabled:opacity-50"
                  >
                    {isSubmittingSchedule
                      ? 'Đang lưu...'
                      : editingScheduleId
                        ? 'Lưu thay đổi'
                        : 'Tạo ca học'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Enrolled Student Roster */}
          {editingScheduleId &&
            (modalTab === 'ROSTER' || !canManageSchedule) && (
              <div className="space-y-3">
                {rosterLoading ? (
                  <div className="py-8 text-center text-[13px] text-zinc-400">
                    Đang tải danh sách học viên...
                  </div>
                ) : rosterItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#18181C]/50 py-8 text-center">
                    <UserCheck className="mx-auto h-6 w-6 text-zinc-500" />
                    <p className="mt-2 text-[13px] font-medium text-zinc-300">
                      Chưa có hội viên đăng ký trong ca học này
                    </p>
                  </div>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {rosterItems.map((bk) => {
                      const isPresent =
                        bk.attendance === AttendanceStatus.PRESENT;
                      const isNoShow =
                        bk.attendance === AttendanceStatus.NO_SHOW ||
                        bk.attendance === AttendanceStatus.ABSENT;
                      const isCancelled = bk.status === BookingStatus.CANCELLED;

                      return (
                        <div
                          key={bk.id}
                          className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#18181C] px-3.5 py-2.5"
                        >
                          <div>
                            <p className="text-[13px] font-semibold text-white">
                              {bk.memberFullName}
                            </p>
                            <p className="text-[11px] font-medium tabular-nums text-zinc-400">
                              {bk.memberCode}
                            </p>
                          </div>

                          <div>
                            {isCancelled ? (
                              <span className="rounded-md border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
                                Đã huỷ
                              </span>
                            ) : isPresent ? (
                              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                                Có mặt
                              </span>
                            ) : isNoShow ? (
                              <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                                Vắng mặt
                              </span>
                            ) : (
                              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                                Đã đặt chỗ
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex justify-end border-t border-white/[0.06] pt-3">
                  <button
                    type="button"
                    onClick={() => setScheduleModalOpen(false)}
                    className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300 hover:text-white"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}
        </div>
      </Dialog>

      {/* Modal 2: Manage Class Types */}
      <Dialog
        open={classTypesModalOpen}
        onClose={() => setClassTypesModalOpen(false)}
        title="Danh mục bộ môn"
        description="Thêm hoặc cập nhật bộ môn lớp nhóm."
        maxWidthClassName="max-w-lg"
      >
        <div className="mt-4 space-y-3">
          {classModalError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{classModalError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              type="text"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="Tên bộ môn..."
              className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            />
            <input
              type="text"
              value={newClassDesc}
              onChange={(e) => setNewClassDesc(e.target.value)}
              placeholder="Mô tả ngắn..."
              className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
            />
            <button
              type="button"
              disabled={isSubmittingClass}
              onClick={() => void handleCreateClassTemplate()}
              className="h-9 rounded-xl bg-[#FF5500] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#E64D00] disabled:opacity-50"
            >
              + Thêm bộ môn
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pt-2">
            {classTemplates.map((cls) => {
              const isEditingThis = editingClassId === cls.id;

              return (
                <div
                  key={cls.id}
                  className="rounded-xl border border-white/[0.06] bg-[#18181C] p-3"
                >
                  {isEditingThis ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={editClassName}
                          onChange={(e) => setEditClassName(e.target.value)}
                          placeholder="Tên bộ môn"
                          className="h-8 rounded-lg border border-white/[0.12] bg-[#141418] px-2.5 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                        />
                        <input
                          type="text"
                          value={editClassDesc}
                          onChange={(e) => setEditClassDesc(e.target.value)}
                          placeholder="Mô tả ngắn"
                          className="h-8 rounded-lg border border-white/[0.12] bg-[#141418] px-2.5 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingClassId(null)}
                          className="h-7 rounded-lg border border-white/10 px-2.5 text-[12px] text-zinc-300 hover:text-white"
                        >
                          Huỷ
                        </button>
                        <button
                          type="button"
                          disabled={isSubmittingClass}
                          onClick={() =>
                            void handleSaveClassTemplateEdit(cls.id)
                          }
                          className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#FF5500] px-2.5 text-[12px] font-semibold text-white hover:bg-[#E64D00]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Lưu
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-white">
                          {cls.name}
                        </p>
                        <p className="truncate text-[12px] text-zinc-400">
                          {cls.description ?? 'Lớp huấn luyện nhóm tiêu chuẩn'}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEditClassTemplate(cls)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#141418] px-2.5 text-[12px] font-medium text-zinc-300 hover:text-white"
                        >
                          <Pencil className="h-3 w-3" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleClassTemplateStatus(cls)
                          }
                          className={cn(
                            'h-8 rounded-lg border px-2.5 text-[12px] font-semibold',
                            cls.isActive
                              ? 'border-emerald-500/40 text-emerald-400'
                              : 'border-zinc-500/40 text-zinc-400',
                          )}
                        >
                          {cls.isActive ? 'Đang mở' : 'Tạm ngưng'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
