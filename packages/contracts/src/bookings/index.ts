export enum BookingStatus {
  BOOKED = 'BOOKED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
}

export enum AttendanceStatus {
  PENDING = 'PENDING',
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  NO_SHOW = 'NO_SHOW',
}

export interface ClassBookingDetail {
  id: string;
  scheduleId: string;
  className: string;
  classDescription?: string | null;
  trainerName: string;
  trainerPhone?: string | null;
  startsAt: string;
  endsAt: string;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  subscriptionId: string;
  quotaId: string;
  status: BookingStatus;
  attendance: AttendanceStatus;
  cancelledAt: string | null;
  attendedAt: string | null;
  createdAt: string;
}

export interface PaginatedClassBookingsResponse {
  data: ClassBookingDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PtBookingDetail {
  id: string;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  memberPhone?: string | null;
  trainerId: string;
  trainerName: string;
  trainerPhone?: string | null;
  subscriptionId: string;
  quotaId: string;
  availabilityId?: string | null;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  attendance: AttendanceStatus;
  cancelledAt: string | null;
  attendedAt: string | null;
  createdAt: string;
}

export interface PaginatedPtBookingsResponse {
  data: PtBookingDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

