import { ServiceTypeCode } from '../common';

export const TrainerServiceFilter = {
  CLASS: ServiceTypeCode.CLASS,
  PT: ServiceTypeCode.PT,
} as const;
export type TrainerServiceFilter =
  (typeof TrainerServiceFilter)[keyof typeof TrainerServiceFilter];

export interface QueryTrainersRequest {
  service?: TrainerServiceFilter;
}

export interface TrainerSummary {
  id: string;
  fullName: string;
  specialization: string | null;
  specialties: string[];
  canTeachClasses: boolean;
  canCoachPt: boolean;
}

export interface PtAvailabilityDetail {
  id: string;
  trainerId: string;
  trainerName?: string;
  startsAt: string;
  endsAt: string;
  isAvailable: boolean;
  note: string | null;
  createdAt?: string;
}

/** Counter lookup uses the gym's local calendar date (Asia/Ho_Chi_Minh). */
export interface QueryStaffPtSlotsRequest {
  memberId: string;
  date: string;
}

export interface StaffPtSlot {
  availabilityId: string;
  startsAt: string;
  endsAt: string;
}
