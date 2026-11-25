import { PaymentStatus } from '../common';

export enum SubscriptionStatus {
  UPCOMING = 'UPCOMING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** EXPIRED is a read-model state. Persist ACTIVE until another lifecycle event occurs. */
export function effectiveSubscriptionStatus(
  status: SubscriptionStatus,
  endDate: string | Date,
  now = new Date(),
): SubscriptionStatus {
  return status === SubscriptionStatus.ACTIVE &&
    now.getTime() > new Date(endDate).getTime()
    ? SubscriptionStatus.EXPIRED
    : status;
}

export interface SubscriptionMemberSummary {
  id: string;
  memberCode: string;
  fullName: string;
  email?: string;
  phone?: string | null;
  idPhotoUrl?: string | null;
  dateOfBirth?: string | null;
}

export interface SubscriptionPlanSummary {
  id: string;
  name: string;
  durationDays: number;
  price: number;
}

export interface SubscriptionQuotaSummary {
  id: string;
  service: string;
  serviceName: string;
  allocated: number | null;
  reserved: number;
  used: number;
}

export interface SubscriptionPaymentSummary {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method?: string | null;
  confirmedAt?: string | null;
}

export interface SubscriptionSummary {
  id: string;
  memberId: string;
  planId: string;
  startDate: string;
  endDate: string;
  status: SubscriptionStatus;
}

export interface AssignedPtTrainer {
  id: string;
  fullName: string;
}

export interface PtAssignmentDetail {
  suggestedTrainer?: AssignedPtTrainer | null;
  subscriptionId: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  planName: string;
  startsAt: string;
  endsAt: string;
  status: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  trainer: AssignedPtTrainer | null;
  trainerAvailable: boolean;
  version: number;
}

export interface AssignPtTrainerInput {
  trainerId: string;
  expectedVersion: number;
  reason?: string;
}

export interface AssignedPtSlot {
  availabilityId: string;
  subscriptionId: string;
  trainerId: string;
  trainerName: string;
  startsAt: string;
  endsAt: string;
}

export interface SubscriptionDetail {
  assignedTrainer?: AssignedPtTrainer | null;
  ptAssignmentVersion?: number;
  freezeCount?: number;
  id: string;
  memberId: string;
  planId: string;
  previousSubscriptionId: string | null;
  startDate: string;
  endDate: string;
  storedStatus: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  agreedPrice: number;
  activatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  member: SubscriptionMemberSummary;
  plan: SubscriptionPlanSummary;
  quotas: SubscriptionQuotaSummary[];
  payments?: SubscriptionPaymentSummary[];
}

export interface PaginatedSubscriptionsResponse {
  data: SubscriptionDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateSubscriptionRequest {
  idempotencyKey?: string;
  memberId: string;
  planId: string;
  startDate?: string;
  paymentMethod?: string;
  paymentStatus?: PaymentStatus;
  note?: string;
}

export interface CancelSubscriptionRequest {
  reason: string;
}

export interface RenewSubscriptionRequest {
  idempotencyKey?: string;
  planId?: string;
  paymentMethod?: string;
  paymentStatus?: PaymentStatus;
  note?: string;
}
