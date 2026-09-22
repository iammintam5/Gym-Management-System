import type { UserRole } from '../auth';

export interface UserSummary {
  id: string;
  email: string;
  roles: UserRole[];
}

export interface UserResponse {
  id: string;
  email: string;
  isActive: boolean;
  roles: UserRole[];
  fullName?: string | null;
  phone?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedUsersResponse {
  data: UserResponse[];
  meta: PaginationMeta;
}

export interface UpdateUserRequest {
  email?: string;
  fullName?: string;
  phone?: string;
}

export interface UpdateUserStatusRequest {
  isActive: boolean;
}

export interface UpdateUserRolesRequest {
  roles: UserRole[];
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
