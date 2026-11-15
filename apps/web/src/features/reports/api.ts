import { useQuery } from '@tanstack/react-query';
import type {
  AttendancePeakHoursReport,
  ClassUtilizationReport,
  DashboardSummaryReport,
  PaginatedAuditLogsResponse,
  RevenueReportResponse,
  TrainerPerformanceReport,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';

export const reportsKeys = {
  all: ['reports'] as const,
  summary: () => [...reportsKeys.all, 'dashboard-summary'] as const,
  revenue: (groupBy = 'MONTH') =>
    [...reportsKeys.all, 'revenue', groupBy] as const,
  peakHours: () => [...reportsKeys.all, 'peak-hours'] as const,
  classUtilization: () => [...reportsKeys.all, 'class-utilization'] as const,
  trainerPerformance: () =>
    [...reportsKeys.all, 'trainer-performance'] as const,
  auditLogs: (query?: string) =>
    [...reportsKeys.all, 'audit-logs', query ?? 'default'] as const,
};

export const reportsApi = {
  getDashboardSummary: () =>
    apiClient<DashboardSummaryReport>('/reports/dashboard-summary'),
  getRevenue: (groupBy: 'DAY' | 'MONTH' = 'MONTH') =>
    apiClient<RevenueReportResponse>(`/reports/revenue?groupBy=${groupBy}`),
  getPeakHours: () =>
    apiClient<AttendancePeakHoursReport>('/reports/attendance-peak-hours'),
  getClassUtilization: () =>
    apiClient<ClassUtilizationReport>('/reports/class-utilization'),
  getTrainerPerformance: () =>
    apiClient<TrainerPerformanceReport>('/reports/trainer-performance'),
  getAuditLogs: (query = 'limit=30') =>
    apiClient<PaginatedAuditLogsResponse>(`/audit-logs?${query}`),
};

export function useDashboardSummaryReport() {
  return useQuery({
    queryKey: reportsKeys.summary(),
    queryFn: () => reportsApi.getDashboardSummary(),
  });
}

export function useRevenueReport(groupBy: 'DAY' | 'MONTH' = 'MONTH') {
  return useQuery({
    queryKey: reportsKeys.revenue(groupBy),
    queryFn: () => reportsApi.getRevenue(groupBy),
  });
}

export function usePeakHoursReport() {
  return useQuery({
    queryKey: reportsKeys.peakHours(),
    queryFn: () => reportsApi.getPeakHours(),
  });
}

export function useClassUtilizationReport() {
  return useQuery({
    queryKey: reportsKeys.classUtilization(),
    queryFn: () => reportsApi.getClassUtilization(),
  });
}

export function useTrainerPerformanceReport() {
  return useQuery({
    queryKey: reportsKeys.trainerPerformance(),
    queryFn: () => reportsApi.getTrainerPerformance(),
  });
}

export function useAuditLogs(query = 'limit=30') {
  return useQuery({
    queryKey: reportsKeys.auditLogs(query),
    queryFn: () => reportsApi.getAuditLogs(query),
  });
}
