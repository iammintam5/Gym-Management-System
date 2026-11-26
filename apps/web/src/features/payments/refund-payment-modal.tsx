'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  PaymentMethod,
  PaymentRefundPreview,
  RefundPaymentRequest,
} from '@gym/contracts';
import { apiClient } from '@/services/api-client';
import { ModalFrame } from '@/components/ui/modal-frame';
import { formatVnd } from '@/lib/formatters';

interface Props {
  paymentId: string;
  memberName: string;
  memberCode: string;
  onClose: () => void;
  onRefunded: () => void;
}

export function RefundPaymentModal({
  paymentId,
  memberName,
  memberCode,
  onClose,
  onRefunded,
}: Props) {
  const [preview, setPreview] = useState<PaymentRefundPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    apiClient<PaymentRefundPreview>(
      '/payments/' + paymentId + '/refund-preview',
      { skipCache: true },
    )
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : 'Không thể kiểm tra điều kiện hoàn tiền.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [paymentId, retry]);

  const canSubmit = Boolean(
    !loading &&
    preview?.eligible &&
    reason.trim() &&
    confirmed &&
    (method !== 'TRANSFER' || reference.trim()),
  );
  const close = () => {
    if (!busy.current) onClose();
  };
  const submit = async () => {
    if (busy.current || !canSubmit || !preview) return;
    busy.current = true;
    setSubmitting(true);
    setError('');
    const body: RefundPaymentRequest = {
      reason: reason.trim(),
      method,
      ...(method === 'TRANSFER' ? { reference: reference.trim() } : {}),
      expectedAmount: preview.amount,
      confirmedExternal: true,
    };
    try {
      await apiClient('/payments/' + paymentId + '/refund', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không thể ghi nhận hoàn tiền.',
      );
      busy.current = false;
      setSubmitting(false);
      setConfirmed(false);
      setPreview(null);
      return;
    }
    busy.current = false;
    onRefunded();
  };
  const retryPreview = () => {
    setLoading(true);
    setError('');
    setPreview(null);
    setConfirmed(false);
    setRetry((value) => value + 1);
  };

  return (
    <ModalFrame
      onClose={close}
      labelledBy="refund-payment-heading"
      maxWidthClassName="max-w-lg"
    >
      <div
        className="rounded-2xl border border-white/[0.08] bg-[#141418] p-6 shadow-2xl"
        aria-busy={submitting}
      >
        <h2
          id="refund-payment-heading"
          className="text-lg font-semibold text-white"
        >
          Ghi nhận hoàn tiền gói tập
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {memberName} · {memberCode}
        </p>
        {loading && (
          <p role="status" className="mt-5 text-sm text-zinc-400">
            Đang kiểm tra điều kiện hoàn tiền…
          </p>
        )}
        {error && (
          <div role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </div>
        )}
        {!loading && !preview && (
          <button
            type="button"
            onClick={retryPreview}
            className="mt-3 text-sm text-white underline"
          >
            Kiểm tra lại
          </button>
        )}
        {preview && (
          <>
            <dl className="mt-5 space-y-2 border-y border-white/[0.08] py-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-400">Gói tập</dt>
                <dd className="text-right text-white">
                  {preview.planName || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-400">Số tiền hoàn</dt>
                <dd className="font-semibold tabular-nums text-white">
                  {formatVnd(preview.amount)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-400">Biên lai được hoàn</dt>
                <dd className="text-white">{preview.receiptCount}</dd>
              </div>
              {preview.deadline && (
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-400">Hạn hoàn tiền</dt>
                  <dd className="text-right text-white">
                    {new Date(preview.deadline).toLocaleString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                    })}
                  </dd>
                </div>
              )}
              {preview.futureBookingCount > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-400">Lịch lớp sẽ hủy</dt>
                  <dd className="text-white">{preview.futureBookingCount}</dd>
                </div>
              )}
            </dl>
            {!preview.eligible ? (
              <ul
                role="alert"
                className="mt-4 list-disc space-y-2 pl-4 text-sm text-amber-300"
              >
                {preview.reasons.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <fieldset disabled={submitting} className="mt-4 space-y-4">
                <p className="text-sm text-zinc-400">
                  Hoàn toàn bộ tiền đã thu và hủy gói. Chỉ xác nhận sau khi đã
                  trả tiền cho khách.
                </p>
                <label className="block text-sm text-zinc-300">
                  Lý do hoàn tiền
                  <textarea
                    aria-label="Lý do hoàn tiền"
                    maxLength={255}
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#18181C] p-3 text-white"
                  />
                </label>
                <label className="block text-sm text-zinc-300">
                  Phương thức trả tiền
                  <select
                    aria-label="Phương thức trả tiền"
                    value={method}
                    onChange={(event) => {
                      setMethod(event.target.value as PaymentMethod);
                      setConfirmed(false);
                    }}
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#18181C] px-3 text-white"
                  >
                    <option value="CASH">Tiền mặt</option>
                    <option value="TRANSFER">Chuyển khoản</option>
                  </select>
                </label>
                {method === 'TRANSFER' && (
                  <label className="block text-sm text-zinc-300">
                    Mã giao dịch chuyển khoản
                    <input
                      aria-label="Mã giao dịch chuyển khoản"
                      maxLength={100}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#18181C] px-3 text-white"
                    />
                  </label>
                )}
                <label className="flex items-start gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-1 accent-[#FF5500]"
                  />
                  <span>
                    Tôi xác nhận đã trả đủ {formatVnd(preview.amount)} cho
                    khách.
                  </span>
                </label>
              </fieldset>
            )}
          </>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={close}
            className="h-10 rounded-lg border border-white/10 px-4 text-sm text-zinc-300 disabled:opacity-50"
          >
            Đóng
          </button>
          {preview?.eligible && (
            <button
              type="button"
              disabled={submitting || !canSubmit}
              onClick={() => void submit()}
              className="h-10 rounded-lg bg-[#FF5500] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? 'Đang ghi nhận…' : 'Xác nhận đã hoàn tiền'}
            </button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
