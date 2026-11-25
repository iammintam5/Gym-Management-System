import {
  formatSpecialtiesSummary,
  normalizeSpecialties,
  seedSpecialtiesFromSpecialization,
  UserRole,
  type CreateEmployeeRequest,
  type EmployeeDetail,
  type UpdateEmployeeRequest,
} from '@gym/contracts';

export interface EmployeeFormState {
  editingId: string | null;
  editingUserId: string | null;
  originalRole: UserRole | null;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  hiredAt: string;
  specialties: string[];
  specialtyDraft: string;
  staffNote: string;
  canTeachClasses: boolean;
  canCoachPt: boolean;
}

export interface TrainerServiceBadge {
  label: string;
  tone: 'orange' | 'amber' | 'muted';
}

export function createInitialEmployeeFormState(
  tab: 'trainers' | 'staff',
  todayIso = new Date().toISOString().slice(0, 10),
): EmployeeFormState {
  const isTrainerTab = tab === 'trainers';
  return {
    editingId: null,
    editingUserId: null,
    originalRole: null,
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: isTrainerTab ? UserRole.TRAINER : UserRole.STAFF,
    hiredAt: todayIso,
    specialties: [],
    specialtyDraft: '',
    staffNote: '',
    canTeachClasses: isTrainerTab,
    canCoachPt: false,
  };
}

export function employeeDetailToFormState(
  emp: EmployeeDetail,
): EmployeeFormState {
  const primaryRole = emp.roles.includes(UserRole.TRAINER)
    ? UserRole.TRAINER
    : emp.roles.includes(UserRole.ADMIN)
      ? UserRole.ADMIN
      : UserRole.STAFF;
  const isTrainer = primaryRole === UserRole.TRAINER;

  return {
    editingId: emp.id,
    editingUserId: emp.userId,
    originalRole: primaryRole,
    fullName: emp.fullName,
    email: emp.email,
    phone: emp.phone ?? '',
    password: '',
    role: primaryRole,
    hiredAt: emp.hiredAt ? String(emp.hiredAt).slice(0, 10) : '',
    specialties: isTrainer ? resolveTrainerDisplaySpecialties(emp) : [],
    specialtyDraft: '',
    staffNote: isTrainer ? '' : (emp.specialization ?? ''),
    canTeachClasses: isTrainer ? Boolean(emp.canTeachClasses) : false,
    canCoachPt: isTrainer ? Boolean(emp.canCoachPt) : false,
  };
}

export function applyEmployeeFormRoleChange(
  state: EmployeeFormState,
  nextRole: UserRole,
): EmployeeFormState {
  if (nextRole === UserRole.TRAINER) {
    const restoreDefaults = !state.canTeachClasses && !state.canCoachPt;
    return {
      ...state,
      role: nextRole,
      canTeachClasses: restoreDefaults ? true : state.canTeachClasses,
      canCoachPt: false,
    };
  }

  return {
    ...state,
    role: nextRole,
    canTeachClasses: false,
    canCoachPt: false,
  };
}

export function commitSpecialtyDraft(
  specialties: readonly string[],
  draft: string,
): string[] {
  const parsedDraft = draft
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return normalizeSpecialties([...specialties, ...parsedDraft]);
}

export function buildCreateEmployeePayload(
  state: EmployeeFormState,
): CreateEmployeeRequest {
  const base: CreateEmployeeRequest = {
    fullName: state.fullName.trim(),
    email: state.email.trim(),
    role: state.role,
    password: state.password.trim() || undefined,
    phone: state.phone.trim() || undefined,
    hiredAt: state.hiredAt || undefined,
  };

  if (state.role === UserRole.TRAINER) {
    const finalSpecialties = commitSpecialtyDraft(
      state.specialties,
      state.specialtyDraft,
    );
    return {
      ...base,
      specialties: finalSpecialties,
      specialization: formatSpecialtiesSummary(finalSpecialties) ?? undefined,
      canTeachClasses: state.canTeachClasses,
      canCoachPt: false,
    };
  }

  return {
    ...base,
    specialization: state.staffNote.trim() || undefined,
  };
}

export function buildUpdateEmployeeSubmission(state: EmployeeFormState): {
  rolePatch: UserRole[] | null;
  profilePatch: UpdateEmployeeRequest;
} {
  const rolePatch =
    state.editingUserId &&
    state.originalRole &&
    state.role !== state.originalRole
      ? [state.role]
      : null;

  const basePatch: UpdateEmployeeRequest = {
    fullName: state.fullName.trim(),
    email: state.email.trim(),
    phone: state.phone.trim() || undefined,
    hiredAt: state.hiredAt || null,
  };

  if (state.role === UserRole.TRAINER) {
    const finalSpecialties = commitSpecialtyDraft(
      state.specialties,
      state.specialtyDraft,
    );
    return {
      rolePatch,
      profilePatch: {
        ...basePatch,
        specialties: finalSpecialties,
        specialization: formatSpecialtiesSummary(finalSpecialties),
        canTeachClasses: state.canTeachClasses,
        canCoachPt: false,
      },
    };
  }

  return {
    rolePatch,
    profilePatch: {
      ...basePatch,
      specialization: state.staffNote.trim() || null,
    },
  };
}

export function resolveTrainerDisplaySpecialties(
  emp: Pick<EmployeeDetail, 'specialties' | 'specialization'>,
): string[] {
  const normalized = normalizeSpecialties(emp.specialties);
  if (normalized.length > 0) {
    return normalized;
  }
  return seedSpecialtiesFromSpecialization(emp.specialization);
}

export function formatTrainerServicesBadges(
  emp: Pick<EmployeeDetail, 'canTeachClasses' | 'canCoachPt'>,
): ReadonlyArray<TrainerServiceBadge> {
  const badges: TrainerServiceBadge[] = [];
  if (emp.canTeachClasses) {
    badges.push({ label: 'Lớp nhóm', tone: 'orange' });
  }
  if (badges.length === 0) {
    badges.push({ label: 'Tạm ngưng nhận lịch', tone: 'muted' });
  }
  return badges;
}
