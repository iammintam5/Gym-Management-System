export interface DashboardSummaryReport {
  period: { from: string; to: string };
  financials: {
    totalRevenue: number;
    cashAmount: number;
    transferAmount: number;
    cardAmount: number;
  };
  members: {
    totalActiveMembers: number;
    newMembersCount: number;
    expiringWithin7DaysCount: number;
  };
  operations: {
    totalCheckinsToday: number;
    classesConductedCount: number;
    /** @deprecated PT 1–1 is retired. Kept as zero for older clients. */
    ptSessionsCompletedCount: number;
  };
}

export interface RevenueReportItem {
  timeBucket: string;
  revenue: number;
  paymentCount: number;
  byMethod: {
    CASH: number;
    TRANSFER: number;
    CARD: number;
  };
}

export interface RevenueReportResponse {
  from: string;
  to: string;
  groupBy: 'DAY' | 'MONTH';
  totalRevenue: number;
  totalPayments: number;
  items: RevenueReportItem[];
  byPlan: Array<{
    planId: string;
    planName: string;
    revenue: number;
    count: number;
  }>;
}

export interface AttendancePeakHoursReport {
  date?: string;
  totalCheckins: number;
  peakHour: number | null;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
    percentage: number;
  }>;
}

export interface ClassUtilizationReport {
  averageUtilizationRate: number;
  totalSchedules: number;
  items: Array<{
    scheduleId: string;
    className: string;
    instructorName: string;
    startTime: string;
    capacity: number;
    bookedCount: number;
    utilizationRate: number;
  }>;
}

export interface TrainerPerformanceReport {
  /** Current report counts ended, non-cancelled group-class schedules. */
  basis?: 'ENDED_GROUP_CLASSES';
  from: string;
  to: string;
  items: Array<{
    trainerId: string;
    trainerName: string;
    specialization: string | null;
    completedSessionsCount: number;
    totalTrainingHours: number;
  }>;
}
