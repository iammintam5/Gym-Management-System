import { PaymentStatus } from '../common';

export type PaymentMethod = 'CASH' | 'TRANSFER';

export interface PaymentPtPurchaseSummary {
  id: string;
  packageCode: string | null;
  packageName: string;
  sessionCount: number | null;
  sessionMinutes: number;
}

export interface PaymentRecordDetail {
  id: string;
  subscriptionId: string | null;
  ptPurchaseId?: string | null;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  note: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  createdAt: string;
  subscription?: {
    planName: string;
    startDate: string;
    endDate: string;
  };
  ptPurchase?: PaymentPtPurchaseSummary | null;
}

export interface PaymentReceipt {
  receiptNumber: string; // e.g. REC-20260923-XXXX
  confirmedAt: string;
  amount: number;
  currency: string;
  method: string;
  note: string | null;
  targetType?: 'SUBSCRIPTION' | 'PT_PACKAGE';
  member: {
    fullName: string;
    memberCode: string;
    phone: string | null;
  };
  subscription: {
    planName: string;
    durationDays: number;
    startDate: string;
    endDate: string;
  };
  ptPurchase?: PaymentPtPurchaseSummary | null;
  cashier: {
    fullName: string;
  };
}

export interface PaginatedPaymentsResponse {
  data: PaymentRecordDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaymentReconciliationResponse {
  date: string;
  totalRevenue: number;
  cashRevenue: number;
  transferRevenue: number;
  cardRevenue: number;
  transactionCount: number;
  items: PaymentRecordDetail[];
}
