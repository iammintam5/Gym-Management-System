import { UserRole } from '../auth';
import { GYM_DOMAIN_RULES } from '../common';
import type { PaginationMeta } from '../users';

/**
 * Admin-managed service capabilities on EmployeeProfile.
 * Only TRAINER employees may hold these capabilities; STAFF/ADMIN always remain false.
 */
export interface EmployeeCapabilities {
  canTeachClasses: boolean;
  canCoachPt: boolean;
}

/**
 * Explicit default capabilities by role for creation and profile backfill.
 */
export function defaultEmployeeCapabilitiesForRole(
  roleOrRoles: UserRole | readonly UserRole[],
): EmployeeCapabilities {
  const isTrainer = Array.isArray(roleOrRoles)
    ? roleOrRoles.includes(UserRole.TRAINER)
    : roleOrRoles === UserRole.TRAINER;
  return isTrainer
    ? { canTeachClasses: true, canCoachPt: true }
    : { canTeachClasses: false, canCoachPt: false };
}

/**
 * Specialty compatibility policy (Batch 2B):
 * - `specialties` (`string[]`) is the structured list of trainer specialties.
 * - Legacy `specialization` (`string | null`) is preserved and synchronized for older callers and reports.
 * - Seeding from legacy `specialization` keeps the trimmed text as a single literal item without
 *   splitting delimiters or guessing disciplines.
 * - `GymClass` discipline matching and schema are out of scope for Batch 2B and belong to later class work.
 */
export function normalizeSpecialties(
  input: readonly string[] | null | undefined,
): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const dedupeKey = normalized.toLocaleLowerCase('vi-VN');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(normalized);
  }
  return result;
}

/**
 * Seeds structured specialties from a legacy `specialization` string without guessing or splitting.
 */
export function seedSpecialtiesFromSpecialization(
  specialization: string | null | undefined,
): string[] {
  if (typeof specialization !== 'string') {
    return [];
  }
  const trimmed = specialization.trim();
  return trimmed.length > 0 ? [trimmed] : [];
}

/**
 * Formats structured specialties back into a legacy summary string for backward compatibility.
 */
export function formatSpecialtiesSummary(
  specialties: readonly string[] | null | undefined,
): string | null {
  const normalized = normalizeSpecialties(specialties);
  if (normalized.length === 0) return null;
  const summary = normalized.join(', ');
  const limit = GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH;
  const characters = Array.from(summary);
  // Keep the legacy summary within its input limit while retaining every structured specialty.
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join('')}…`
    : summary;
}

export interface EmployeeSummary {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  phone?: string | null;
  specialization?: string | null;
  specialties: string[];
  canTeachClasses: boolean;
  canCoachPt: boolean;
  email?: string;
  isActive?: boolean;
  roles: UserRole[];
}

export interface EmployeeDetail {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  phone?: string | null;
  specialization?: string | null;
  specialties: string[];
  canTeachClasses: boolean;
  canCoachPt: boolean;
  hiredAt?: string | Date | null;
  email: string;
  isActive: boolean;
  roles: UserRole[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PaginatedEmployeesResponse {
  data: EmployeeDetail[];
  meta: PaginationMeta;
}

export interface CreateEmployeeRequest {
  email: string;
  fullName: string;
  role: UserRole;
  password?: string;
  phone?: string;
  specialization?: string;
  specialties?: string[];
  canTeachClasses?: boolean;
  canCoachPt?: boolean;
  hiredAt?: string | Date;
}

export interface UpdateEmployeeRequest {
  fullName?: string;
  phone?: string;
  specialization?: string | null;
  specialties?: string[];
  canTeachClasses?: boolean;
  canCoachPt?: boolean;
  hiredAt?: string | Date | null;
  email?: string;
}

/**
 * Employee self-service update contract.
 * `canTeachClasses` and `canCoachPt` are intentionally excluded because capabilities are admin-managed only.
 */
export interface UpdateEmployeeSelfRequest {
  fullName?: string;
  phone?: string;
  specialization?: string | null;
  specialties?: string[];
}
