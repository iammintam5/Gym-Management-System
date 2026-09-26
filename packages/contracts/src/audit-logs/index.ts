export interface AuditLogDetail {
  id: string;
  actorId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface PaginatedAuditLogsResponse {
  data: AuditLogDetail[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
