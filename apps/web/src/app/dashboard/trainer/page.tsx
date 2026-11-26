'use client';

import { Toast, useToast } from '@/components/ui/toast';

import { DataState, assertDataLoaded } from '@/components/shared/data-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { ConfirmDialog } from '@/components/ui/dialog';
import { StaffFormModal } from '@/components/ui/staff-form-modal';
import {
  applyEmployeeFormRoleChange,
  buildCreateEmployeePayload,
  buildUpdateEmployeeSubmission,
  commitSpecialtyDraft,
  createInitialEmployeeFormState,
  employeeDetailToFormState,
  formatTrainerServicesBadges,
  resolveTrainerDisplaySpecialties,
  type EmployeeFormState,
  type TrainerServiceBadge,
} from '@/features/trainers/employee-form';
import { cn } from '@/lib/utils';
import { apiClient } from '@/services/api-client';
import {
  UserRole,
  type EmployeeDetail,
  type PaginatedEmployeesResponse,
  type TrainerPerformanceReport,
} from '@gym/contracts';
import {
  ChevronDown,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  SquarePen,
  Unlock,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

const PAGE_SIZE = 10;

interface TrainerRecord {
  id: string;
  userId: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  specialties: string[];
  serviceBadges: ReadonlyArray<TrainerServiceBadge>;
  hiredDate: string;
  completedSessions: number;
  trainingHours: string;
  status: 'Active' | 'Inactive';
  detail: EmployeeDetail;
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
  detail: EmployeeDetail;
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

function getServiceBadgeClass(tone: TrainerServiceBadge['tone']): string {
  if (tone === 'orange') {
    return 'border-[#FF5500]/35 bg-[#FF5500]/12 text-[#FF5500]';
  }
  if (tone === 'amber') {
    return 'border-amber-500/35 bg-amber-500/12 text-amber-400';
  }
  return 'border-white/[0.08] bg-[#18181C] text-zinc-400';
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

  const [modalOpen, setModalOpen] = useState(false);
  const [formState, setFormState] = useState<EmployeeFormState>(() =>
    createInitialEmployeeFormState('trainers'),
  );
  const [saving, setSaving] = useState(false);
  const { notification, showToast, dismissToast } = useToast();
  const [errorMsg, setErrorMsg] = useState('');
  const [lockTarget, setLockTarget] = useState<{
    userId: string;
    id: string;
    name: string;
    isTrainer: boolean;
  } | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const statusRequestRef = useRef(false);
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
          const isTrainer = emp.roles.includes(UserRole.TRAINER);
          if (isTrainer) {
            const perf = perfMap.get(emp.id);
            const hrs = perf?.totalTrainingHours ?? 0;
            pts.push({
              id: emp.id,
              userId: emp.userId,
              code: emp.employeeCode,
              name: emp.fullName,
              email: emp.email,
              phone: formatPhoneDisplay(emp.phone),
              specialties: resolveTrainerDisplaySpecialties(emp),
              serviceBadges: formatTrainerServicesBadges(emp),
              hiredDate: formatHiredDate(emp.hiredAt),
              completedSessions: perf?.completedSessionsCount ?? 0,
              trainingHours: `${hrs.toFixed(1).replace(/\.0$/, '')} giờ`,
              status: emp.isActive ? 'Active' : 'Inactive',
              detail: emp,
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
              specializationNote: emp.specialization ?? '—',
              hiredDate: formatHiredDate(emp.hiredAt),
              phone: formatPhoneDisplay(emp.phone),
              email: emp.email,
              status: emp.isActive ? 'Active' : 'Locked',
              detail: emp,
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
    setFormState(createInitialEmployeeFormState(directoryTab));
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEditEmployeeModal = (detail: EmployeeDetail) => {
    setFormState(employeeDetailToFormState(detail));
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleAddSpecialtyDraft = () => {
    if (!formState.specialtyDraft.trim()) return;
    setFormState((prev) => ({
      ...prev,
      specialties: commitSpecialtyDraft(prev.specialties, prev.specialtyDraft),
      specialtyDraft: '',
    }));
  };

  const handleSpecialtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddSpecialtyDraft();
    }
  };

  const handleRemoveSpecialty = (label: string) => {
    setFormState((prev) => ({
      ...prev,
      specialties: prev.specialties.filter((item) => item !== label),
    }));
  };

  const handleSaveEmployee = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formState.fullName.trim() || !formState.email.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Họ và tên kèm địa chỉ Email.');
      return;
    }
    setSaving(true);
    setErrorMsg('');

    try {
      if (formState.editingId) {
        const submission = buildUpdateEmployeeSubmission(formState);
        if (submission.rolePatch && formState.editingUserId) {
          await apiClient(`/users/${formState.editingUserId}/roles`, {
            method: 'PATCH',
            body: JSON.stringify({ roles: submission.rolePatch }),
          });
        }
        await apiClient(`/employees/${formState.editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(submission.profilePatch),
        });
        await loadEmployees();
        showToast(`Đã cập nhật hồ sơ nhân sự ${formState.fullName.trim()}.`);
      } else {
        const payload = buildCreateEmployeePayload(formState);
        await apiClient('/employees', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        await loadEmployees();
        showToast(
          `Đã tạo tài khoản nhân sự mới cho ${formState.fullName.trim()}.`,
        );
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
    if (statusRequestRef.current) return;
    statusRequestRef.current = true;
    setPendingStatusId(empId);
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
      setLockTarget(null);
      showToast(
        `Đã chuyển trạng thái tài khoản sang ${nextActive ? 'Đang hoạt động' : 'Tạm khóa'}.`,
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Không thể cập nhật trạng thái tài khoản.',
        'error',
      );
    } finally {
      statusRequestRef.current = false;
      setPendingStatusId(null);
    }
  };

  const specialtyOptions = Array.from(
    new Set(trainers.flatMap((t) => t.specialties)),
  );

  const filteredTrainers = trainers.filter((trainer) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      trainer.name.toLowerCase().includes(query) ||
      trainer.code.toLowerCase().includes(query) ||
      trainer.email.toLowerCase().includes(query) ||
      trainer.specialties.some((s) => s.toLowerCase().includes(query)) ||
      trainer.serviceBadges.some((b) => b.label.toLowerCase().includes(query));
    const matchesSpecialty =
      selectedSpecialty === 'All' ||
      trainer.specialties.some(
        (s) => s.toLowerCase() === selectedSpecialty.toLowerCase(),
      );
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
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            Nhân sự
          </h1>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(255,85,0,0.25)] transition-colors hover:bg-[#E64D00] sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          {directoryTab === 'trainers'
            ? 'Thêm huấn luyện viên'
            : 'Thêm nhân viên lễ tân'}
        </button>
      </div>

      <Toast notification={notification} onDismiss={dismissToast} />

      <div className="rounded-2xl border border-white/[0.06] bg-[#141418] p-6">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-1 flex-wrap items-center gap-3">
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

            <div className="relative min-w-[220px] max-w-md flex-1">
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

        {directoryTab === 'trainers' ? (
          <div className="overflow-x-auto">
            <table
              aria-label="Huấn luyện viên"
              className="w-full min-w-[1400px] border-collapse text-left [&_th]:pr-5 [&_td]:pr-5 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0"
            >
              <thead>
                <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="min-w-[210px] pb-4">Huấn luyện viên</th>
                  <th className="min-w-[200px] pb-4">Chuyên môn</th>
                  <th className="min-w-[108px] pb-4">Dịch vụ</th>
                  <th className="pb-4">Ngày vào làm</th>
                  <th className="min-w-[176px] pb-4">Liên hệ</th>
                  <th className="pb-4">Ca hoàn thành</th>
                  <th className="pb-4">Tổng giờ dạy</th>
                  <th className="min-w-[148px] pb-4">Trạng thái</th>
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
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
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
                      {trainer.specialties.length === 0 ? (
                        <span className="text-[12px] text-zinc-500">
                          Chưa cập nhật
                        </span>
                      ) : (
                        <div className="flex max-w-[230px] flex-wrap gap-1.5">
                          {trainer.specialties.slice(0, 2).map((spec) => (
                            <span
                              key={spec}
                              className="inline-flex rounded-full border border-white/[0.08] bg-[#18181C] px-2.5 py-0.5 text-[12px] text-zinc-300"
                            >
                              {spec}
                            </span>
                          ))}
                          {trainer.specialties.length > 2 && (
                            <span className="inline-flex rounded-full border border-white/[0.08] bg-[#18181C] px-2 py-0.5 text-[12px] text-zinc-400">
                              +{trainer.specialties.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {trainer.serviceBadges.map((badge) => (
                          <span
                            key={badge.label}
                            className={cn(
                              'inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-medium',
                              getServiceBadgeClass(badge.tone),
                            )}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="min-w-[116px] whitespace-nowrap py-4 tabular-nums text-zinc-300">
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

                    <td className="whitespace-nowrap py-4 font-semibold tabular-nums text-white">
                      {trainer.completedSessions} buổi
                    </td>

                    <td className="whitespace-nowrap py-4 font-semibold tabular-nums text-[#FF5500]">
                      {trainer.trainingHours}
                    </td>

                    <td className="py-4">
                      <span
                        className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full border px-3 py-0.5 text-[13px] font-medium',
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

                    <td className="min-w-[192px] whitespace-nowrap py-4 text-right">
                      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditEmployeeModal(trainer.detail)}
                          title="Chỉnh sửa hồ sơ"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          <SquarePen className="h-3 w-3" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          disabled={pendingStatusId !== null}
                          aria-busy={pendingStatusId === trainer.id}
                          onClick={() => {
                            if (trainer.status === 'Active') {
                              setLockTarget({
                                userId: trainer.userId,
                                id: trainer.id,
                                name: trainer.name,
                                isTrainer: true,
                              });
                            } else {
                              void handleToggleAccountStatus(
                                trainer.userId,
                                trainer.id,
                                false,
                                true,
                              );
                            }
                          }}
                          title={
                            trainer.status === 'Active'
                              ? 'Khóa tài khoản'
                              : 'Mở khóa tài khoản'
                          }
                          className="inline-flex h-8 min-w-[88px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 text-[13px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
                        >
                          {trainer.status === 'Active' ? (
                            <>
                              <Lock className="h-3 w-3" />
                              {pendingStatusId === trainer.id
                                ? 'Đang xử lý…'
                                : 'Khóa'}
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3 w-3" />
                              {pendingStatusId === trainer.id
                                ? 'Đang xử lý…'
                                : 'Mở khóa'}
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
            <table
              aria-label="Nhân viên"
              className="w-full min-w-[1120px] border-collapse text-left [&_th]:pr-5 [&_td]:pr-5 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0"
            >
              <thead>
                <tr className="border-b border-white/[0.06] text-[13px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="pb-4">Nhân viên</th>
                  <th className="pb-4">Chức danh</th>
                  <th className="pb-4">Phụ trách / Ghi chú</th>
                  <th className="pb-4">Ngày vào làm</th>
                  <th className="min-w-[176px] pb-4">Liên hệ</th>
                  <th className="min-w-[148px] pb-4">Trạng thái</th>
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
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#18181C] text-[13px] font-bold uppercase text-[#FF5500]">
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

                    <td className="min-w-[116px] whitespace-nowrap py-4 tabular-nums text-zinc-300">
                      {emp.hiredDate}
                    </td>

                    <td className="py-4">
                      <p className="tabular-nums text-zinc-200">{emp.phone}</p>
                      <p className="text-[13px] text-zinc-500">{emp.email}</p>
                    </td>

                    <td className="py-4">
                      <span
                        className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full border px-3 py-0.5 text-[13px] font-medium',
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

                    <td className="min-w-[192px] whitespace-nowrap py-4 text-right">
                      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditEmployeeModal(emp.detail)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#18181C] px-2.5 text-[13px] text-zinc-300 hover:border-white/20 hover:text-white"
                        >
                          <SquarePen className="h-3 w-3" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          disabled={pendingStatusId !== null}
                          aria-busy={pendingStatusId === emp.id}
                          onClick={() => {
                            if (emp.status === 'Active') {
                              setLockTarget({
                                userId: emp.userId,
                                id: emp.id,
                                name: emp.name,
                                isTrainer: false,
                              });
                            } else {
                              void handleToggleAccountStatus(
                                emp.userId,
                                emp.id,
                                false,
                                false,
                              );
                            }
                          }}
                          className="inline-flex h-8 min-w-[88px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 text-[13px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
                        >
                          {emp.status === 'Active' ? (
                            <>
                              <Lock className="h-3 w-3" />
                              {pendingStatusId === emp.id
                                ? 'Đang xử lý…'
                                : 'Khóa'}
                            </>
                          ) : (
                            <>
                              <Unlock className="h-3 w-3" />
                              {pendingStatusId === emp.id
                                ? 'Đang xử lý…'
                                : 'Mở khóa'}
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

      <ConfirmDialog
        open={lockTarget !== null}
        title="Khóa tài khoản?"
        description={
          lockTarget
            ? 'Tạm khóa tài khoản của ' +
              lockTarget.name +
              '. Người này sẽ không thể đăng nhập hoặc tiếp tục thao tác trên hệ thống cho đến khi được mở khóa.'
            : ''
        }
        confirmLabel="Khóa tài khoản"
        cancelLabel="Hủy"
        isSubmitting={pendingStatusId !== null}
        onClose={() => {
          if (!statusRequestRef.current) setLockTarget(null);
        }}
        onConfirm={() => {
          if (lockTarget)
            void handleToggleAccountStatus(
              lockTarget.userId,
              lockTarget.id,
              true,
              lockTarget.isTrainer,
            );
        }}
      />

      {modalOpen && (
        <StaffFormModal
          title={
            formState.editingId ? 'Chỉnh sửa hồ sơ nhân sự' : 'Thêm nhân sự mới'
          }
          subtitle="Cấu hình thông tin cá nhân, chuyên môn và dịch vụ phụ trách"
          busy={saving}
          onClose={() => setModalOpen(false)}
          onSubmit={(e) => void handleSaveEmployee(e)}
          footer={
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => setModalOpen(false)}
                className="h-9 rounded-xl border border-white/[0.08] bg-[#18181C] px-4 text-[13px] font-medium text-zinc-300 hover:text-white disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-9 rounded-xl bg-[#FF5500] px-4 text-[13px] font-semibold text-white hover:bg-[#E64D00] disabled:opacity-50"
              >
                {saving
                  ? 'Đang lưu...'
                  : formState.editingId
                    ? 'Lưu thay đổi'
                    : 'Tạo tài khoản'}
              </button>
            </>
          }
        >
          <div>
            <label className="block text-[13px] font-medium text-zinc-400">
              Họ và tên
            </label>
            <input
              type="text"
              value={formState.fullName}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, fullName: e.target.value }))
              }
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
                value={formState.email}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, email: e.target.value }))
                }
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
                value={formState.phone}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, phone: e.target.value }))
                }
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
                value={formState.role}
                onChange={(e) =>
                  setFormState((prev) =>
                    applyEmployeeFormRoleChange(
                      prev,
                      e.target.value as UserRole,
                    ),
                  )
                }
                aria-label="Vai trò công việc"
                className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
              >
                <option value={UserRole.TRAINER}>Huấn luyện viên</option>
                <option value={UserRole.STAFF}>Lễ tân &amp; Thu ngân</option>
                {formState.originalRole === UserRole.ADMIN && (
                  <option value={UserRole.ADMIN}>Quản trị viên CLB</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-400">
                Ngày vào làm
              </label>
              <input
                type="date"
                value={formState.hiredAt}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, hiredAt: e.target.value }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] tabular-nums text-white focus:border-[#FF5500] focus:outline-none"
              />
            </div>
          </div>

          {formState.role === UserRole.TRAINER ? (
            <>
              <div>
                <span className="block text-[13px] font-medium text-zinc-400">
                  Dịch vụ phụ trách
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-2.5">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#18181C] px-3 py-2 text-[13px] text-zinc-200 transition-colors hover:border-white/20">
                    <input
                      type="checkbox"
                      checked={formState.canTeachClasses}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          canTeachClasses: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[#FF5500]"
                    />
                    <span>Lớp nhóm</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-zinc-400">
                  Chuyên môn huấn luyện
                </label>
                {formState.specialties.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {formState.specialties.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1 rounded-full border border-[#FF5500]/35 bg-[#FF5500]/12 px-2.5 py-0.5 text-[12px] font-medium text-white"
                      >
                        <span>{item}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSpecialty(item)}
                          aria-label={`Xóa chuyên môn ${item}`}
                          className="rounded-full p-0.5 text-zinc-300 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex gap-2">
                  <input
                    type="text"
                    value={formState.specialtyDraft}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        specialtyDraft: e.target.value,
                      }))
                    }
                    onKeyDown={handleSpecialtyKeyDown}
                    placeholder="VD: Boxing, Power Yoga, HIIT..."
                    className="h-9 flex-1 rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddSpecialtyDraft}
                    className="h-9 shrink-0 rounded-xl border border-white/[0.1] bg-[#18181C] px-3 text-[12px] font-semibold text-zinc-200 hover:border-white/25 hover:text-white"
                  >
                    Thêm
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[13px] font-medium text-zinc-400">
                Phụ trách / Ghi chú công việc
              </label>
              <input
                type="text"
                value={formState.staffNote}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    staffNote: e.target.value,
                  }))
                }
                placeholder="Lễ tân ca sáng, Thu ngân quầy chính..."
                className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white focus:border-[#FF5500] focus:outline-none"
              />
            </div>
          )}

          {!formState.editingId && (
            <div>
              <label className="block text-[13px] font-medium text-zinc-400">
                Mật khẩu khởi tạo
              </label>
              <input
                type="password"
                value={formState.password}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                placeholder="Để trống để dùng mật khẩu mặc định"
                className="mt-1 h-9 w-full rounded-xl border border-white/[0.08] bg-[#18181C] px-3 text-[13px] text-white placeholder-zinc-500 focus:border-[#FF5500] focus:outline-none"
              />
            </div>
          )}

          {errorMsg && (
            <p className="text-[13px] font-medium text-red-400">{errorMsg}</p>
          )}
        </StaffFormModal>
      )}
    </div>
  );
}
