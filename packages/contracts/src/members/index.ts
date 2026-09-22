import type { UserRole } from '../auth';
import type { PaginationMeta } from '../users';

export interface MemberSummary {
  id: string;
  userId: string;
  memberCode: string;
  fullName: string;
  phone?: string | null;
  email?: string;
  isActive?: boolean;
}

export interface MemberDetail {
  id: string;
  userId: string;
  memberCode: string;
  fullName: string;
  phone?: string | null;
  dateOfBirth?: string | Date | null;
  email: string;
  isActive: boolean;
  roles: UserRole[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface PaginatedMembersResponse {
  data: MemberDetail[];
  meta: PaginationMeta;
}

export interface CreateMemberRequest {
  email: string;
  fullName: string;
  password?: string;
  phone?: string;
  dateOfBirth?: string | Date;
}

export interface UpdateMemberRequest {
  fullName?: string;
  phone?: string;
  dateOfBirth?: string | Date | null;
  email?: string;
}

export interface UpdateMemberSelfRequest {
  fullName?: string;
  phone?: string;
  dateOfBirth?: string | Date | null;
}
