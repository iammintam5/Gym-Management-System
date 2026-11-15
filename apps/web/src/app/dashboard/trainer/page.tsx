'use client';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';

import { ModalFrame } from '@/components/ui/modal-frame';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Search,
  ChevronDown,
  SquarePen,
  ShieldCheck,
  Lock,
  Unlock,
  X,
} from 'lucide-react';
import {
  UserRole,
  type EmployeeDetail,
  type PaginatedEmployeesResponse,
  type TrainerPerformanceReport,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/shared/table-pagination';

const PAGE_SIZE = 10;

interface TrainerRecord {
  id: string;
  userId: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  hiredDate: string;
  completedSessions: number;
  trainingHours: string;
  status: 'Active' | 'Inactive';
}

interface StaffEmployeeRecord {
  id: string;
  userId: string;
  code: string;
  name: string;
  roleTitle: string;
  roleCode: UserRole;
  specializationNote: string;
  hiredDate: string;
  phone: string;
  email: string;
  status: 'Active' | 'Locked';
}

function formatHiredDate(val?: string | Date | null): string {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('vi-VN');
}

function formatPhoneDisplay(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw;
}

export default function TrainerManagementPage() {
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [directoryTab, setDirectoryTab] = useState<'trainers' | 'staff'>(
    'trainers',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('All');
  const [trainers, setTrainers] = useState<ReadonlyArray<TrainerRecord>>([]);
  const [staffList, setStaffList] = useState<
    ReadonlyArray<StaffEmployeeRecord>
  >([]);

  // Modal state for Create / Edit Employee
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formFullName, setFormFullName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>(UserRole.PT);
  const [formSpecialty, setFormSpecialty] = useState('');
  const [formHiredAt, setFormHiredAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmLockId, setConfirmLockId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadEmployees = useCallback(async () => {
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setLoadError('');
    try {
      const [empRes, perfRes] = await Promise.allSettled([
        apiClient<PaginatedEmployeesResponse>('/employees?limit=100'),
        apiClient<TrainerPerformanceReport>('/reports/trainer-performance'),
      ]);
      assertDataLoaded([perfRes], false);
      assertDataLoaded([empRes], false);

      if (empRes.status === 'fulfilled') {
        const perfMap = new Map(
          perfRes.status === 'fulfilled'
            ? perfRes.value.items.map((p) => [p.trainerId, p])
            : [],
        );

        const pts: TrainerRecord[] = [];
        const staffs: StaffEmployeeRecord[] = [];

        empRes.value.data.forEach((emp: EmployeeDetail) => {
          const isPt = emp.roles.includes(UserRole.PT);
          if (isPt) {
            const perf = perfMap.get(emp.id);
            const hrs = perf?.totalTrainingHours ?? 0;
            pts.push({
              id: emp.id,
              userId: emp.userId,
              code: emp.employeeCode,
              name: emp.fullName,
              email: emp.email,
              phone: formatPhoneDisplay(emp.phone),
              specialty: emp.specialization ?? 'Thể hình tổng hợp',
              hiredDate: formatHiredDate(emp.hiredAt),
              completedSessions: perf?.completedSessionsCount ?? 0,
              trainingHours: `${hrs.toFixed(1).replace(/\.0$/, '')} giờ`,
              status: emp.isActive ? 'Active' : 'Inactive',
            });
          } else {
            const primaryRole = emp.roles.includes(UserRole.ADMIN)
              ? UserRole.ADMIN
              : UserRole.STAFF;
            staffs.push({
              id: emp.id,
              userId: emp.userId,
              code: emp.employeeCode,
              name: emp.fullName,
              roleTitle:
                primaryRole === UserRole.ADMIN
                  ? 'Quản trị viên CLB'
                  : 'Lễ tân & Thu ngân',
              roleCode: primaryRole,
              specializationNote:
                emp.specialization ?? 'Lễ tân & Chăm sóc hội viên',
              hiredDate: formatHiredDate(emp.hiredAt),
              phone: formatPhoneDisplay(emp.phone),
              email: emp.email,
              status: emp.isActive ? 'Active' : 'Locked',
            });
          }
        });

        setTrainers(pts);
        setStaffList(staffs);
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
      void loadEmployees();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEmployees]);

  const openCreateModal = () => {
    setEditingId(null);
    setEditingUserId(null);
    setFormFullName('');
    setFormEmail('');
    setFormPhone('');
    setFormPassword('');
    setFormRole(directoryTab === 'trainers' ? UserRole.PT : UserRole.STAFF);
    setFormSpecialty('');
    setFormHiredAt(new Date().toISOString().slice(0, 10));
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditTrainerModal = (t: TrainerRecord) => {
    setEditingId(t.id);
    setEditingUserId(t.userId);
    setFormFullName(t.name);
    setFormEmail(t.email);
    setFormPhone(t.phone === '—' ? '' : t.phone.replace(/\s/g, ''));
    setFormRole(UserRole.PT);
    setFormSpecialty(t.specialty);
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditStaffModal = (s: StaffEmployeeRecord) => {
    setEditingId(s.id);
    setEditingUserId(s.userId);
    setFormFullName(s.name);
    setFormEmail(s.email);
    setFormPhone(s.phone === '—' ? '' : s.phone.replace(/\s/g, ''));
    setFormRole(s.roleCode);
    setFormSpecialty(s.specializationNote);
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSaveEmployee = async () => {
    if (!formFullName.trim() || !formEmail.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Họ và tên kèm địa chỉ Email.');
      return;
    }
    setSaving(true);
    setErrorMsg('');

    try {
      if (editingId) {
        await apiClient(`/employees/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: formFullName,
            email: formEmail,
            phone: formPhone || undefined,
            specialization: formSpecialty || null,
          }),
        });
        if (editingUserId) {
          await apiClient(`/users/${editingUserId}/roles`, {
            method: 'PATCH',
            body: JSON.stringify({ roles: [formRole] }),
          });
        }
        await loadEmployees();
        setFeedbackMsg(`Đã cập nhật hồ sơ nhân sự ${formFullName}.`);
      } else {
        await apiClient('/employees', {
          method: 'POST',
          body: JSON.stringify({
            fullName: formFullName,
            email: formEmail,
            password: formPassword || 'Password@123',
            role: formRole,
            phone: formPhone || undefined,
            specialization: formSpecialty || undefined,
            hiredAt: formHiredAt || undefined,
          }),
        });
        await loadEmployees();
        setFeedbackMsg(`Đã tạo tài khoản nhân sự mới cho ${formFullName}.`);
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể lưu thông tin nhân sự.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAccountStatus = async (
    userId: string,
    empId: string,
    currentlyActive: boolean,
    isTrainer: boolean,
  ) => {
    const nextActive = !currentlyActive;
    try {
      await apiClient(`/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (isTrainer) {
        setTrainers((prev) =>
          prev.map((t) =>
            t.id === empId
              ? { ...t, status: nextActive ? 'Active' : 'Inactive' }
              : t,
          ),
        );
      } else {
        setStaffList((prev) =>
          prev.map((s) =>
            s.id === empId
              ? { ...s, status: nextActive ? 'Active' : 'Locked' }
              : s,
          ),
        );
      }
      setFeedbackMsg(
        `Đã chuyển trạng thái tài khoản sang ${nextActive ? 'Đang hoạt động' : 'Tạm khóa'}.`,
      );
    } catch (err) {
      setFeedbackMsg(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật trạng thái tài khoản.',
      );
    }
  };

  const specialtyOptions = Array.from(
    new Set(trainers.map((t) => t.specialty).filter(Boolean)),
  );

  const filteredTrainers = trainers.filter((trainer) => {
    const matchesSearch =
      trainer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trainer.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trainer.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSpecialty =
      selectedSpecialty === 'All' ||
      trainer.specialty.toLowerCase().includes(selectedSpecialty.toLowerCase());
    return matchesSearch && matchesSpecialty;
  });

  const filteredStaff = staffList.filter(
    (emp) =>
      emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const [currentPage, setCurrentPage] = useState(1);
  const activeTotalItems =
    directoryTab === 'trainers'
      ? filteredTrainers.length
      : filteredStaff.length;
  const totalPages = Math.max(1, Math.ceil(activeTotalItems / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTrainers = filteredTrainers.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const paginatedStaff = filteredStaff.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  if (loading || loadError)
    return (
      <DataState
        loading={loading}
        error={loadError}
        onRetry={() => void loadEmployees()}
      />
    );

  return (
    <div className="space-y-6">
      {/* Header & Top Action Button (Exact IronGym Screen 2 Layout) */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Quản lý Đội ngũ PT &amp; Nhân sự
          </h1>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          {directoryTab === 'trainers'
            ? 'Thêm PT / Coach'
            : 'Thêm nhân viên lễ tân'}
        </button>
      </div>

      {feedbackMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-300">
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg('')}
            className="text-emerald-300 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Directory Table Card */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        {/* Top Role Switcher + Search & Filter Toolbar */}
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Pill Switcher: Personal Trainers vs Front Desk Staff */}
            <div className="inline-flex h-10 items-center rounded-xl border border-white/[0.08] bg-[#18181C] p-1">
              <button
                type="button"
                onClick={() => {
                  setDirectoryTab('trainers');
                  setCurrentPage(1);
                }}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all',
                  directoryTab === 'trainers'
                    ? 'bg-[#FF5500] text-white'
                    : 'text-zinc-400 hover:text-white',
                )}
              >
                Huấn luyện viên
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirectoryTab('staff');
                  setCurrentPage(1);
                }}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all',
                  directoryTab === 'staff'
                    ? 'bg-[#FF5500] text-white'
                    : 'text-zinc-400 hover:text-white',
                )}
              >
                Lễ tân &amp; Quản trị
              </button>
            </div>

            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={
                  directoryTab === 'trainers'
                    ? 'Tìm HLV theo tên, chuyên môn hoặc mã EMP...'
                    : 'Tìm nhân viên theo tên, email hoặc mã EMP...'
                }
                className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181C] pl-10 pr-4 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
              />
            </div>
          </div>

          {directoryTab === 'trainers' && (
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-zinc-500">Chuyên môn:</span>
              <div className="relative">
                <select
                  value={selectedSpecialty}
                  onChange={(e) => {
                    setSelectedSpecialty(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Lọc theo chuyên môn"
                  className="h-10 appearance-none rounded-xl border border-white/[0.08] bg-[#18181C] pl-4 pr-9 text-[13px] text-zinc-200 focus:border-[#FF5500] focus:outline-none"
                >
                  <option value="All">Tất cả chuyên môn</option>
                  {specialtyOptions.map((spec) => (
                    <option key={spec} value={spec}>
                      {spec}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>
          )}
        </div>

        {/* Table Content */}
        {directoryTab === 'trainers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="pb-4">Huấn luyện viên</th>
                  <th className="pb-4">Chuyên môn</th>
                  <th className="pb-4">Ngày vào làm</th>
                  <th className="pb-4">Liên hệ</th>
                  <th className="pb-4">Số ca hoàn thành</th>
                  <th className="pb-4">Tổng giờ dạy</th>
                  <th className="pb-4">Trạng thái</th>
                  <th className="pb-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-[13px]">
                {paginatedTrainers.map((trainer) => (
                  <tr
                    key={trainer.code}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
                          {trainer.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-white">
                            {trainer.name}
                          </p>
                          <p className="font-mono text-[13px] text-zinc-500">
                            {trainer.code}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-4">
                      <span className="inline-flex rounded-full border border-white/[0.08] bg-[#18181C] px-3 py-1 text-[13px] text-zinc-300">
                        {trainer.specialty}
                      </span>
                    </td>

                    <td className="py-4 tabular-nums text-zinc-300">
                      {trainer.hiredDate}
                    </td>

                    <td className="py-4">
                      <p className="tabular-nums text-zinc-200">
                        {trainer.phone}
                      </p>
                      <p className="text-[13px] text-zinc-500">
                        {trainer.email}
                      </p>
                    </td>

                    <td className="py-4 font-semibold tabular-nums text-white">
                      {trainer.completedSessions} buổi
                    </td>

                    <td className="py-4 font-semibold tabular-nums text-[#FF5500]">
                      {trainer.trainingHours}
                    </td>

                    <td className="py-4">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-medium',
                          trainer.status === 'Active'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : 'border-red-500/40 bg-red-500/10 text-red-400',
                        )}
                      >
                        {trainer.status === 'Active'
                          ? 'Đang hoạt động'
                          : 'Tạm khóa'}
                      </span>
                    </td>

                    <td className="py-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditTrainerModal(trainer)}
                          title="Chỉnh sửa hồ sơ"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          <SquarePen className="h-3 w-3" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              trainer.status === 'Active' &&
                              confirmLockId !== trainer.id
                            ) {
                              setConfirmLockId(trainer.id);
                              window.setTimeout(() => {
                                setConfirmLockId((prev) =>
                                  prev === trainer.id ? null : prev,
                                );
                              }, 3000);
                              return;
                            }
                            setConfirmLockId(null);
                            void handleToggleAccountStatus(
                              trainer.userId,
                              trainer.id,
                              trainer.status === 'Active',
                              true,
                            );
                          }}
                          title={
                            trainer.status === 'Active'
                              ? 'Khóa tài khoản'
                              : 'Mở khóa tài khoản'
                          }
                          className={cn(
                            'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
                            confirmLockId === trainer.id
                              ? 'border-red-500 bg-red-500 text-white font-semibold'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
                          )}
                        >
                          {trainer.status === 'Active' ? (
                            <>
                              <Lock className="h-3 w-3" />
                              {confirmLockId === trainer.id
                                ? 'Xác nhận khóa?'
                                : 'Khóa'}
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3 w-3" />
                              Mở khóa
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="pb-4">Nhân viên</th>
                  <th className="pb-4">Chức danh</th>
                  <th className="pb-4">Phụ trách / Ghi chú</th>
                  <th className="pb-4">Ngày vào làm</th>
                  <th className="pb-4">Liên hệ</th>
                  <th className="pb-4">Trạng thái</th>
                  <th className="pb-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-[13px]">
                {paginatedStaff.map((emp) => (
                  <tr
                    key={emp.code}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
                          {emp.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-white">{emp.name}</p>
                          <p className="font-mono text-[13px] text-zinc-500">
                            {emp.code}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#18181C] px-3 py-1 text-[13px] text-zinc-300">
                        <ShieldCheck className="h-3 w-3 text-[#FF5500]" />
                        {emp.roleTitle}
                      </span>
                    </td>

                    <td className="py-4 text-zinc-300">
                      {emp.specializationNote}
                    </td>

                    <td className="py-4 tabular-nums text-zinc-300">
                      {emp.hiredDate}
                    </td>

                    <td className="py-4">
                      <p className="tabular-nums text-zinc-200">{emp.phone}</p>
                      <p className="text-[13px] text-zinc-500">{emp.email}</p>
                    </td>

                    <td className="py-4">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-0.5 text-[13px] font-medium',
                          emp.status === 'Active'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : 'border-red-500/40 bg-red-500/10 text-red-400',
                        )}
                      >
                        {emp.status === 'Active'
                          ? 'Đang hoạt động'
                          : 'Tạm khóa'}
                      </span>
                    </td>

                    <td className="py-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditStaffModal(emp)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 hover:border-white/20 hover:text-white"
                        >
                          <SquarePen className="h-3 w-3" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              emp.status === 'Active' &&
                              confirmLockId !== emp.id
                            ) {
                              setConfirmLockId(emp.id);
                              window.setTimeout(() => {
                                setConfirmLockId((prev) =>
                                  prev === emp.id ? null : prev,
                                );
                              }, 3000);
                              return;
                            }
                            setConfirmLockId(null);
                            void handleToggleAccountStatus(
                              emp.userId,
                              emp.id,
                              emp.status === 'Active',
                              false,
                            );
                          }}
                          className={cn(
                            'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
                            confirmLockId === emp.id
                              ? 'border-red-500 bg-red-500 text-white font-semibold'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
                          )}
                        >
                          {emp.status === 'Active' ? (
                            <>
                              <Lock className="h-3 w-3" />
                              {confirmLockId === emp.id
                                ? 'Xác nhận khóa?'
                                : 'Khóa'}
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3 w-3" />
                              Mở khóa
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TablePagination
          totalItems={activeTotalItems}
          pageSize={PAGE_SIZE}
          currentPage={safePage}
          onPageChange={setCurrentPage}
          itemLabel={
            directoryTab === 'trainers' ? 'huấn luyện viên' : 'nhân viên'
          }
        />
      </div>

      {/* Create / Edit Employee Modal */}
      {modalOpen && (
        <ModalFrame
          onClose={() => setModalOpen(false)}
          labelledBy="app-dashboard-trainer-page-heading-0"
          maxWidthClassName="max-w-md"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
              <div>
                <h2
                  className="text-base font-bold text-white"
                  id="app-dashboard-trainer-page-heading-0"
                >
                  {editingId ? 'Chỉnh sửa hồ sơ nhân sự' : 'Thêm nhân sự mới'}
                </h2>
                <p className="text-[13px] text-zinc-400">
                  Cấu hình thông tin cá nhân, chuyên môn và vai trò công việc
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Họ và tên
                </label>
                <input
                  type="text"
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  placeholder="VD: Trần Quốc Bảo"
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Địa chỉ Email
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="trainer@gym.local"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="0903 451 882"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Vai trò công việc
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    aria-label="Vai trò công việc"
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                  >
                    <option value={UserRole.PT}>Huấn luyện viên (PT)</option>
                    <option value={UserRole.STAFF}>
                      Lễ tân &amp; Thu ngân
                    </option>
                    <option value={UserRole.ADMIN}>Quản trị viên CLB</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Ngày vào làm
                  </label>
                  <input
                    type="date"
                    value={formHiredAt}
                    onChange={(e) => setFormHiredAt(e.target.value)}
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Chuyên môn / Ghi chú phụ trách
                </label>
                <input
                  type="text"
                  value={formSpecialty}
                  onChange={(e) => setFormSpecialty(e.target.value)}
                  placeholder="Boxing, Tăng cơ & Sức mạnh, Lễ tân ca sáng..."
                  className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              {!editingId && (
                <div>
                  <label className="block text-[13px] font-medium text-zinc-400">
                    Mật khẩu khởi tạo
                  </label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
                  />
                </div>
              )}

              {errorMsg && (
                <p className="text-[13px] font-medium text-red-400">
                  {errorMsg}
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300 hover:text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveEmployee()}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {saving
                  ? 'Đang lưu...'
                  : editingId
                    ? 'Lưu thay đổi'
                    : 'Tạo tài khoản'}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
