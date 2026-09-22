import type { UserRole } from '../auth';
import type { PaginationMeta } from '../users';

export interface EmployeeSummary {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  phone?: string | null;
  specialization?: string | null;
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
  hiredAt?: string | Date;
}

export interface UpdateEmployeeRequest {
  fullName?: string;
  phone?: string;
  specialization?: string | null;
  hiredAt?: string | Date | null;
  email?: string;
}

export interface UpdateEmployeeSelfRequest {
  fullName?: string;
  phone?: string;
  specialization?: string | null;
}
