export interface TrainerSummary {
  id: string;
  fullName: string;
  specialization: string | null;
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

