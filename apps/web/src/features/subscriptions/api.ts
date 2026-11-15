import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdjustQuotaRequest,
  CancelSubscriptionRequest,
  CreateSubscriptionFreezeRequest,
  CreateSubscriptionRequest,
  PaginatedFreezesResponse,
  PaginatedPaymentsResponse,
  PaginatedQuotaTransactionsResponse,
  PaginatedSubscriptionsResponse,
  PaymentReceipt,
  PaymentReconciliationResponse,
  PaymentRecordDetail,
  RenewSubscriptionRequest,
  SubscriptionDetail,
  SubscriptionFreezeDetail,
  SubscriptionQuotaDetail,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { generateIdempotencyKey } from '@/lib/utils';

export const subscriptionsKeys = {
  all: ['subscriptions'] as const,
  list: (query?: string) =>
    [...subscriptionsKeys.all, 'list', query ?? 'default'] as const,
  myCurrent: () => [...subscriptionsKeys.all, 'me-current'] as const,
  myQuotas: () => [...subscriptionsKeys.all, 'me-quotas'] as const,
  freezes: (query?: string) =>
    [...subscriptionsKeys.all, 'freezes', query ?? 'default'] as const,
  payments: (query?: string) =>
    [...subscriptionsKeys.all, 'payments', query ?? 'default'] as const,
  reconciliation: (date?: string) =>
    [...subscriptionsKeys.all, 'reconciliation', date ?? 'today'] as const,
};

export const subscriptionsApi = {
  getAll: (query = 'limit=100') =>
    apiClient<PaginatedSubscriptionsResponse>(`/subscriptions?${query}`),
  getMyCurrent: () =>
    apiClient<SubscriptionDetail | null>('/subscriptions/me/current'),
  getMyList: () => apiClient<SubscriptionDetail[]>('/subscriptions/me'),
  getMyCurrentQuotas: () =>
    apiClient<SubscriptionQuotaDetail[]>('/subscriptions/me/current/quotas'),
  getSubscriptionQuotas: (subscriptionId: string) =>
    apiClient<SubscriptionQuotaDetail[]>(
      `/subscriptions/${subscriptionId}/quotas`,
    ),
  getQuotaTransactions: (quotaId: string, query = 'limit=20') =>
    apiClient<PaginatedQuotaTransactionsResponse>(
      `/quotas/${quotaId}/transactions?${query}`,
    ),
  adjustQuota: (
    quotaId: string,
    input: AdjustQuotaRequest & { idempotencyKey?: string },
  ) =>
    apiClient<SubscriptionQuotaDetail>(`/quotas/${quotaId}/adjust`, {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        idempotencyKey: input.idempotencyKey ?? generateIdempotencyKey('q-adj'),
      }),
    }),
  create: (input: CreateSubscriptionRequest) =>
    apiClient<SubscriptionDetail>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  activateNow: (subscriptionId: string) =>
    apiClient<SubscriptionDetail>(
      `/subscriptions/${subscriptionId}/activate-now`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    ),
  renew: (subscriptionId: string, input: RenewSubscriptionRequest) =>
    apiClient<SubscriptionDetail>(`/subscriptions/${subscriptionId}/renew`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (subscriptionId: string, input: CancelSubscriptionRequest) =>
    apiClient<SubscriptionDetail>(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Freezes
  getFreezes: (query = 'limit=50') =>
    apiClient<PaginatedFreezesResponse>(`/freezes?${query}`),
  getSubscriptionFreezes: (subscriptionId: string) =>
    apiClient<SubscriptionFreezeDetail[]>(
      `/subscriptions/${subscriptionId}/freezes`,
    ),
  createFreeze: (
    subscriptionId: string,
    input: CreateSubscriptionFreezeRequest,
  ) =>
    apiClient<SubscriptionFreezeDetail>(
      `/subscriptions/${subscriptionId}/freezes`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  approveFreeze: (freezeId: string) =>
    apiClient<SubscriptionFreezeDetail>(`/freezes/${freezeId}/approve`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  rejectFreeze: (freezeId: string, reason?: string) =>
    apiClient<SubscriptionFreezeDetail>(`/freezes/${freezeId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  unfreeze: (freezeId: string) =>
    apiClient<SubscriptionFreezeDetail>(`/freezes/${freezeId}/unfreeze`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // Payments & Billing
  getPayments: (query = 'limit=50') =>
    apiClient<PaginatedPaymentsResponse>(`/payments?${query}`),
  getReconciliation: (date?: string) =>
    apiClient<PaymentReconciliationResponse>(
      `/payments/reconciliation${date ? `?date=${date}` : ''}`,
    ),
  getReceipt: (paymentId: string) =>
    apiClient<PaymentReceipt>(`/payments/${paymentId}/receipt`),
  confirmPayment: (paymentId: string, method?: string) =>
    apiClient<PaymentRecordDetail>(`/payments/${paymentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    }),
  refundPayment: (paymentId: string, reason: string) =>
    apiClient<PaymentRecordDetail>(`/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export function useSubscriptionsList(query = 'limit=100') {
  return useQuery({
    queryKey: subscriptionsKeys.list(query),
    queryFn: () => subscriptionsApi.getAll(query),
  });
}

export function useMyCurrentSubscription() {
  return useQuery({
    queryKey: subscriptionsKeys.myCurrent(),
    queryFn: () => subscriptionsApi.getMyCurrent(),
  });
}

export function useMyCurrentQuotas() {
  return useQuery({
    queryKey: subscriptionsKeys.myQuotas(),
    queryFn: () => subscriptionsApi.getMyCurrentQuotas(),
  });
}

export function useFreezesList(query = 'limit=50') {
  return useQuery({
    queryKey: subscriptionsKeys.freezes(query),
    queryFn: () => subscriptionsApi.getFreezes(query),
  });
}

export function usePaymentsList(query = 'limit=50') {
  return useQuery({
    queryKey: subscriptionsKeys.payments(query),
    queryFn: () => subscriptionsApi.getPayments(query),
  });
}

export function useActivateSubscriptionNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subscriptionsApi.activateNow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionsKeys.all });
    },
  });
}
