export interface QuotaOperationContext {
  amount?: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  actorId?: string;
  idempotencyKey?: string;
}

export interface CanUseResult {
  allowed: boolean;
  reason?: string;
  remaining: number | null;
  unlimited: boolean;
}
