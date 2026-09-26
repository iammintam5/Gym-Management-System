export const ScheduleStatus = {
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type ScheduleStatus =
  (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

export interface GymClassDetail {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface PaginatedClassesResponse {
  data: GymClassDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ClassScheduleBookingSummary {
  id: string;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  status: string;
  attendance: string;
  createdAt: string;
}

export interface ClassScheduleDetail {
  id: string;
  classId: string;
  className: string;
  classDescription?: string | null;
  trainerId: string;
  trainerName: string;
  trainerPhone?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  remainingSlots: number;
  status: ScheduleStatus;
  bookings?: ClassScheduleBookingSummary[];
}

export interface PaginatedClassSchedulesResponse {
  data: ClassScheduleDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ClassScheduleSummary {
  id: string;
  classId: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}
