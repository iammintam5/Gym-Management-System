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

export interface MemberFaceConflict {
  memberId: string;
  memberCode: string;
  fullName: string;
}

export interface FaceDescriptorSnapshot {
  descriptor: number[];
  mirroredDescriptor: number[];
  modelVersion: string;
  photoVersion: string;
}

export interface MemberFaceError {
  code:
    | 'DUPLICATE_MEMBER_FACE'
    | 'INVALID_MEMBER_FACE_PHOTO'
    | 'FACE_INDEX_NOT_READY';
  message: string;
  conflicts?: MemberFaceConflict[];
}

export interface MemberDirectoryResponse extends PaginatedMembersResponse {
  subscriptions: import('../subscriptions').SubscriptionDetail[];
}
