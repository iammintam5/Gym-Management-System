import type { UserRole } from '../auth';
import type { PaginationMeta } from '../users';

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export interface MemberSummary {
  id: string;
  userId: string;
  memberCode: string;
  fullName: string;
  phone?: string | null;
  gender?: Gender | null;
  idPhotoUrl?: string | null;
  email?: string;
  isActive?: boolean;
}

export interface MemberDetail {
  id: string;
  userId: string;
  memberCode: string;
  fullName: string;
  phone?: string | null;
  gender?: Gender | null;
  dateOfBirth?: string | Date | null;
  idPhotoUrl?: string | null;
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
  gender?: Gender | null;
  dateOfBirth?: string | Date;
  idPhotoUrl?: string | null;
}

export interface UpdateMemberRequest {
  fullName?: string;
  phone?: string;
  gender?: Gender | null;
  dateOfBirth?: string | Date | null;
  email?: string;
  idPhotoUrl?: string | null;
}

export interface UpdateMemberSelfRequest {
  fullName?: string;
  phone?: string;
  gender?: Gender | null;
  dateOfBirth?: string | Date | null;
}
