'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, SquarePen } from 'lucide-react';
import {
  PaymentStatus,
  UserRole,
  SubscriptionStatus,
  type MemberDetail,
  type SubscriptionDetail,
  type PaginatedPaymentsResponse,
  type PaymentReceipt,
} from '@gym/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { SubscriptionQuotaHistory } from './subscription-quota-history';
import { apiClient } from '@/services/api-client';
import { formatVnd } from '@/lib/formatters';
import { formatReceiptNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { PaymentStatusBadge } from '@/components/shared/domain-status-badge';
import { ModalFrame } from '@/components/ui/modal-frame';
import { TablePagination } from '@/components/shared/table-pagination';

const buttonStyle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-[#FF5500] hover:text-white focus-visible:outline-2 focus-visible:outline-[#FF5500]';
const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function date(value: string | Date | null | undefined, includeTime = false) {
  if (!value) return 'Chưa có';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Chưa có';
  return (includeTime ? timeFormat : dateFormat).format(parsed);
}

function collected(sub: SubscriptionDetail) {
  return (sub.payments ?? [])
    .filter((payment) => payment.status === PaymentStatus.PAID)
    .reduce((total, payment) => total + payment.amount, 0);
}

function remaining(sub: SubscriptionDetail) {
  if (
    sub.effectiveStatus === SubscriptionStatus.CANCELLED ||
    sub.paymentStatus !== PaymentStatus.PENDING
  )
    return 0;
  return Math.max(0, sub.agreedPrice - collected(sub));
}

function SubscriptionRow({
  sub,
  memberId,
  compact = false,
  onAdjustQuota,
}: {
  sub: SubscriptionDetail;
  memberId: string;
  compact?: boolean;
  onAdjustQuota?: () => void;
}) {
  const statusLabels: Record<SubscriptionStatus, string> = {
    ACTIVE: 'Đang tập',
    UPCOMING: 'Sắp tới',
    SUSPENDED: 'Bảo lưu',
    EXPIRED: 'Hết hạn',
    CANCELLED: 'Đã hủy',
  };
  const isAdmin = useAuthStore((state) =>
    Boolean(state.user?.roles?.includes(UserRole.ADMIN)),
  );
  const due = remaining(sub);
  return (
    <article className="border-b border-white/[0.08] py-5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3
          className={cn(
            'font-medium tracking-tight text-white',
            compact ? 'text-base' : 'text-lg',
          )}
        >
          {sub.plan.name}
        </h3>
        <span
          className={cn(
            'text-xs',
            sub.effectiveStatus === SubscriptionStatus.ACTIVE
              ? 'text-emerald-400'
              : sub.effectiveStatus === SubscriptionStatus.SUSPENDED
                ? 'text-amber-300'
                : 'text-zinc-400',
          )}
        >
          {statusLabels[sub.effectiveStatus]}
        </span>
      </div>
      <p className="mt-1 text-sm tabular-nums text-zinc-400">
        {compact
          ? 'Bắt đầu ' + date(sub.startDate)
          : date(sub.startDate) + ' — ' + date(sub.endDate)}
      </p>
      {!compact && sub.quotas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-2 font-normal">Dịch vụ</th>
                <th className="px-2 py-2 text-right font-normal">
                  Còn dùng được
                </th>
                <th className="px-2 py-2 text-right font-normal">Đã dùng</th>
                <th className="py-2 text-right font-normal">Giữ chỗ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {sub.quotas.map((quota) => (
                <tr key={quota.id}>
                  <th className="py-3 font-normal text-zinc-300">
                    {quota.serviceName}
                  </th>
                  <td className="px-2 py-3 text-right font-medium text-white">
                    {quota.allocated === null
                      ? 'Không giới hạn'
                      : Math.max(
                          0,
                          quota.allocated - quota.used - quota.reserved,
                        )}
                  </td>
                  <td className="px-2 py-3 text-right text-zinc-400">
                    {quota.used}
                  </td>
                  <td className="py-3 text-right text-zinc-400">
                    {quota.reserved}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-zinc-500">
            {sub.quotas
              .filter((quota) => quota.allocated !== null)
              .map(
                (quota) =>
                  quota.serviceName + ' được cấp ' + quota.allocated + ' buổi',
              )
              .join(' · ')}
          </p>
        </div>
      )}
      {sub.quotas.length > 0 && (
        <SubscriptionQuotaHistory key={sub.id} sub={sub} />
      )}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <details className="min-w-0 flex-1 text-sm">
          <summary className="w-fit cursor-pointer text-xs text-zinc-500 hover:text-zinc-200">
            Chi tiết
          </summary>
          <div className="mt-4 space-y-4 border-l border-white/10 pl-4">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-zinc-500">Giá mua</dt>
                <dd className="mt-1 text-zinc-200">
                  {formatVnd(sub.agreedPrice)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Thanh toán</dt>
                <dd className="mt-1">
                  <PaymentStatusBadge status={sub.paymentStatus} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Đã thu sau hoàn tiền</dt>
                <dd className="mt-1 text-zinc-200">
                  {formatVnd(collected(sub))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Ngày đăng ký</dt>
                <dd className="mt-1 text-zinc-200">
                  {date(sub.createdAt, true)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Bắt đầu</dt>
                <dd className="mt-1 text-zinc-200">
                  {date(sub.startDate, true)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Kết thúc</dt>
                <dd className="mt-1 text-zinc-200">
                  {date(sub.endDate, true)}
                </dd>
              </div>
              {sub.activatedAt && (
                <div>
                  <dt className="text-xs text-zinc-500">Kích hoạt</dt>
                  <dd className="mt-1 text-zinc-200">
                    {date(sub.activatedAt, true)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-zinc-500">Bảo lưu</dt>
                <dd className="mt-1 text-zinc-200">
                  {sub.freezeCount ?? 0} lần
                </dd>
              </div>
              {sub.cancelledAt && (
                <div>
                  <dt className="text-xs text-zinc-500">Ngày hủy</dt>
                  <dd className="mt-1 text-zinc-200">
                    {date(sub.cancelledAt, true)}
                  </dd>
                </div>
              )}
              {sub.cancelReason && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-zinc-500">Lý do hủy</dt>
                  <dd className="mt-1 break-words text-zinc-200">
                    {sub.cancelReason}
                  </dd>
                </div>
              )}
            </dl>
            {sub.quotas.map((quota) => (
              <p
                key={quota.id}
                className="text-xs leading-relaxed text-zinc-400"
              >
                {quota.serviceName} ·{' '}
                {quota.allocated === null
                  ? 'Không giới hạn'
                  : quota.allocated + ' lượt'}{' '}
                · Đã dùng {quota.used} · Giữ chỗ {quota.reserved}
              </p>
            ))}
          </div>
        </details>
        {isAdmin &&
          onAdjustQuota &&
          sub.quotas.some((quota) => quota.allocated !== null) && (
            <button
              type="button"
              onClick={onAdjustQuota}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Điều chỉnh số buổi
            </button>
          )}
        {due > 0 && (
          <Link
            className="text-sm text-amber-300 hover:underline"
            href={'/dashboard/staff/pos?memberId=' + memberId}
          >
            Thu {formatVnd(due)}
          </Link>
        )}
        {sub.paymentStatus === PaymentStatus.REFUNDED && (
          <span className="text-xs text-zinc-400">Đã hoàn tiền</span>
        )}
      </div>
    </article>
  );
}

export function MemberProfile({
  memberId,
  embedded = false,
  onEdit,
  onRenew,
  onCancel,
  onAdjustQuota,
}: {
  memberId: string;
  embedded?: boolean;
  onEdit?: (member: MemberDetail) => void;
  onRenew?: (member: MemberDetail, source: SubscriptionDetail | null) => void;
  onCancel?: (member: MemberDetail, source: SubscriptionDetail) => void;
  onAdjustQuota?: (member: MemberDetail, source: SubscriptionDetail) => void;
}) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDetail[]>([]);
  const [tab, setTab] = useState<'overview' | 'payments'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);
  const [paymentPage, setPaymentPage] = useState(1);
  const [paymentData, setPaymentData] =
    useState<PaginatedPaymentsResponse | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentReload, setPaymentReload] = useState(0);
  const upcomingRef = useRef<HTMLElement>(null);
  const receiptSequence = useRef(0);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState('');

  useEffect(
    () => () => {
      receiptSequence.current += 1;
    },
    [],
  );

  async function openReceipt(id: string) {
    const sequence = ++receiptSequence.current;
    setReceiptLoading(id);
    setReceiptError('');
    try {
      const result = await apiClient.get<PaymentReceipt>(
        '/payments/' + id + '/receipt',
      );
      if (sequence === receiptSequence.current) setReceipt(result);
    } catch (cause) {
      if (sequence === receiptSequence.current)
        setReceiptError(
          cause instanceof Error ? cause.message : 'Không thể tải biên lai.',
        );
    } finally {
      if (sequence === receiptSequence.current) setReceiptLoading(null);
    }
  }

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const [profile, history] = await Promise.all([
        apiClient.get<MemberDetail>(`/members/${memberId}`),
        apiClient.get<SubscriptionDetail[]>(
          `/members/${memberId}/subscriptions`,
        ),
      ]);
      if (sequence !== loadSequence.current) return;
      setMember(profile);
      setSubscriptions(history);
    } catch (cause) {
      if (sequence === loadSequence.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Không thể tải hồ sơ hội viên.',
        );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadSequence.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (tab !== 'payments') return;
    let active = true;
    const timer = window.setTimeout(() => {
      setPaymentLoading(true);
      setPaymentError('');
      void apiClient
        .get<PaginatedPaymentsResponse>(
          `/payments?memberId=${encodeURIComponent(memberId)}&page=${paymentPage}&limit=10`,
        )
        .then((data) => {
          if (active) setPaymentData(data);
        })
        .catch((cause: unknown) => {
          if (active)
            setPaymentError(
              cause instanceof Error
                ? cause.message
                : 'Không thể tải thanh toán.',
            );
        })
        .finally(() => {
          if (active) setPaymentLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [memberId, tab, paymentPage, paymentReload]);

  const current = subscriptions.filter((sub) =>
    [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED].includes(
      sub.effectiveStatus,
    ),
  );
  const upcoming = subscriptions
    .filter((sub) => sub.effectiveStatus === SubscriptionStatus.UPCOMING)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate));
  const history = subscriptions
    .filter((sub) =>
      [SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED].includes(
        sub.effectiveStatus,
      ),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const outstanding = subscriptions.reduce(
    (total, sub) => total + remaining(sub),
    0,
  );
  const renewalSource =
    current[0] ??
    history.find(
      (sub) => sub.effectiveStatus !== SubscriptionStatus.CANCELLED,
    ) ??
    null;
  const canRenew =
    member?.isActive &&
    upcoming.length === 0 &&
    !current.some(
      (sub) => sub.effectiveStatus === SubscriptionStatus.SUSPENDED,
    );
  const memberAction = (action: string) =>
    `/dashboard/staff/members?search=${encodeURIComponent(member?.memberCode ?? '')}&memberId=${memberId}&action=${action}`;

  return (
    <div
      className={cn(
        'w-full',
        embedded
          ? 'flex h-full min-h-0 flex-col'
          : 'mx-auto max-w-5xl space-y-6',
      )}
    >
      {!embedded && (
        <div
          className={cn(
            'flex items-center gap-3',
            embedded ? 'justify-end' : 'justify-between',
          )}
        >
          {!embedded && (
            <Link
              href="/dashboard/staff/members"
              className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Hội viên
            </Link>
          )}
          <button
            type="button"
            aria-label="Làm mới hồ sơ"
            title="Làm mới"
            disabled={loading}
            onClick={() => {
              void load();
              setPaymentReload((value) => value + 1);
            }}
            className={buttonStyle}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="py-16 text-center text-zinc-400">
          Đang tải hồ sơ hội viên…
        </p>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/25 p-5 text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            className={cn(buttonStyle, 'mt-3')}
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </div>
      ) : (
        member && (
          <>
            <header
              className={cn(
                'flex flex-col justify-between gap-4',
                embedded
                  ? 'shrink-0 px-5 pb-4 pt-5 sm:px-6'
                  : 'sm:flex-row sm:items-center',
              )}
            >
              <div className="flex items-center gap-4">
                {member.idPhotoUrl ? (
                  <Image
                    width={80}
                    height={80}
                    unoptimized
                    src={member.idPhotoUrl}
                    alt={member.fullName}
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg font-medium text-zinc-300">
                    {member.fullName
                      .trim()
                      .split(/\s+/)
                      .slice(-2)
                      .map((part) => part[0])
                      .join('')}
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-semibold text-white">
                    {member.fullName}
                  </h1>
                  <p className="mt-1 font-mono text-sm text-zinc-400">
                    {member.memberCode}
                    {member.phone ? ' · ' + member.phone : ''}
                  </p>
                  {!member.isActive && (
                    <p className="mt-1 text-xs text-red-400">
                      Tài khoản đã khóa
                    </p>
                  )}
                </div>
              </div>
              {!embedded && (
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={memberAction('edit')}
                    className={buttonStyle}
                    onClick={(event) => {
                      if (onEdit) {
                        event.preventDefault();
                        onEdit(member);
                      }
                    }}
                  >
                    <SquarePen className="h-4 w-4" />
                    Sửa thông tin
                  </Link>
                  {canRenew && (
                    <Link
                      href={memberAction('renew')}
                      onClick={(event) => {
                        if (onRenew) {
                          event.preventDefault();
                          onRenew(member, renewalSource);
                        }
                      }}
                      className={cn(
                        buttonStyle,
                        'border-[#FF5500] bg-[#FF5500] text-white hover:bg-[#e64d00]',
                      )}
                    >
                      {renewalSource ? 'Gia hạn' : 'Đăng ký gói'}
                    </Link>
                  )}
                </div>
              )}
            </header>
            <details
              className={cn(
                'border-b border-white/10 pb-4 text-sm',
                embedded &&
                  'max-h-[35dvh] shrink-0 overflow-y-auto px-5 sm:px-6',
              )}
            >
              <summary className="w-fit cursor-pointer text-zinc-500 hover:text-zinc-200">
                Thông tin cá nhân
              </summary>
              <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-zinc-500">Email</dt>
                  <dd className="mt-1 break-all text-zinc-200">
                    {member.email}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Ngày sinh</dt>
                  <dd className="mt-1 text-zinc-200">
                    {date(member.dateOfBirth)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Giới tính</dt>
                  <dd className="mt-1 text-zinc-200">
                    {(
                      { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' } as Record<
                        string,
                        string
                      >
                    )[member.gender ?? ''] ?? 'Chưa cập nhật'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">Ngày tham gia</dt>
                  <dd className="mt-1 text-zinc-200">
                    {date(member.createdAt)}
                  </dd>
                </div>
              </dl>
            </details>
            <nav
              aria-label="Thông tin hội viên"
              className={cn(
                'flex gap-6 overflow-x-auto border-b border-white/10',
                embedded && 'shrink-0 px-5 pt-4 sm:px-6',
              )}
            >
              {(
                [
                  { key: 'overview', label: 'Gói tập' },
                  { key: 'payments', label: 'Thanh toán' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-current={tab === item.key ? 'page' : undefined}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium',
                    tab === item.key
                      ? 'border-[#FF5500] text-white'
                      : 'border-transparent text-zinc-400 hover:text-white',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div
              className={cn(
                embedded && 'min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6',
              )}
            >
              {outstanding > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-4">
                  <p className="text-sm text-amber-200">
                    Còn phải thu{' '}
                    <strong className="ml-2">{formatVnd(outstanding)}</strong>
                  </p>
                  <Link
                    href={`/dashboard/staff/pos?memberId=${memberId}`}
                    className={buttonStyle}
                  >
                    Đến thu ngân <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
              {tab === 'overview' && (
                <div>
                  <section aria-label="Gói hiện tại">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Hiện tại
                    </h2>
                    {current.length ? (
                      current.map((sub) => (
                        <SubscriptionRow
                          key={sub.id}
                          sub={sub}
                          memberId={memberId}
                          onAdjustQuota={
                            onAdjustQuota
                              ? () => onAdjustQuota(member, sub)
                              : undefined
                          }
                        />
                      ))
                    ) : (
                      <p className="py-6 text-sm text-zinc-400">
                        Chưa có gói đang sử dụng.
                      </p>
                    )}
                  </section>
                  {upcoming.length > 0 && (
                    <section
                      ref={upcomingRef}
                      tabIndex={-1}
                      aria-label="Gói sắp tới"
                      className="mt-6 focus:outline-none"
                    >
                      <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                        Sắp tới
                      </h2>
                      {upcoming.map((sub) => (
                        <SubscriptionRow
                          key={sub.id}
                          sub={sub}
                          memberId={memberId}
                          onAdjustQuota={
                            onAdjustQuota
                              ? () => onAdjustQuota(member, sub)
                              : undefined
                          }
                          compact
                        />
                      ))}
                    </section>
                  )}
                  {history.length > 0 && (
                    <details className="mt-6 border-t border-white/10 pt-5">
                      <summary className="w-fit cursor-pointer text-sm text-zinc-400 hover:text-white">
                        Lịch sử gói ({history.length})
                      </summary>
                      {history.map((sub) => (
                        <SubscriptionRow
                          key={sub.id}
                          sub={sub}
                          memberId={memberId}
                          onAdjustQuota={
                            onAdjustQuota
                              ? () => onAdjustQuota(member, sub)
                              : undefined
                          }
                        />
                      ))}
                    </details>
                  )}
                </div>
              )}
              {tab === 'payments' && (
                <section className="min-w-0">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-white">
                      Lịch sử thanh toán
                    </h2>
                    <Link
                      href={`/dashboard/staff/pos?memberId=${memberId}`}
                      className={buttonStyle}
                    >
                      Mở thu ngân <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  {paymentLoading ? (
                    <p
                      role="status"
                      className="py-10 text-center text-zinc-400"
                    >
                      Đang tải thanh toán…
                    </p>
                  ) : paymentError ? (
                    <div role="alert" className="py-5 text-red-300">
                      <p>{paymentError}</p>
                      <button
                        type="button"
                        className={cn(buttonStyle, 'mt-3')}
                        onClick={() => setPaymentReload((value) => value + 1)}
                      >
                        Thử lại
                      </button>
                    </div>
                  ) : (
                    paymentData && (
                      <>
                        {receiptError && (
                          <p role="alert" className="mb-4 text-sm text-red-300">
                            {receiptError}
                          </p>
                        )}
                        <ul
                          aria-label="Giao dịch thanh toán"
                          className="divide-y divide-white/10"
                        >
                          {paymentData.data.map((payment) => (
                            <li key={payment.id} className="py-4 first:pt-0">
                              <details>
                                <summary className="cursor-pointer list-none rounded-lg focus-visible:outline-2 focus-visible:outline-[#FF5500]">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <span className="min-w-0 break-words text-sm font-medium text-zinc-200">
                                      {payment.subscription?.planName ??
                                        'Gói tập'}
                                    </span>
                                    <span className="shrink-0 text-base font-medium tabular-nums text-white">
                                      {formatVnd(payment.amount)}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <span className="text-zinc-500">
                                      {date(
                                        payment.confirmedAt ??
                                          payment.createdAt,
                                      )}{' '}
                                      ·{' '}
                                      {(
                                        {
                                          CASH: 'Tiền mặt',
                                          TRANSFER: 'Chuyển khoản',
                                          CARD: 'Thẻ ngân hàng',
                                        } as Record<string, string>
                                      )[payment.method ?? ''] ??
                                        'Chưa xác định'}
                                    </span>
                                    <PaymentStatusBadge
                                      status={payment.status}
                                    />
                                  </div>
                                </summary>
                                <div className="mt-4 space-y-2 border-l border-white/10 pl-3 text-xs text-zinc-400">
                                  <p className="break-all font-mono">
                                    {formatReceiptNumber(
                                      payment.id,
                                      payment.confirmedAt ?? payment.createdAt,
                                    )}
                                  </p>
                                  <p>
                                    {date(
                                      payment.confirmedAt ?? payment.createdAt,
                                      true,
                                    )}{' '}
                                    ·{' '}
                                    {payment.confirmedByName ||
                                      'Chưa ghi nhận người thu'}
                                  </p>
                                  {payment.note && (
                                    <p className="break-words">
                                      {payment.note}
                                    </p>
                                  )}
                                  {payment.status === PaymentStatus.PAID && (
                                    <button
                                      type="button"
                                      disabled={receiptLoading !== null}
                                      onClick={() =>
                                        void openReceipt(payment.id)
                                      }
                                      className="min-h-9 text-sm text-zinc-200 underline underline-offset-4 disabled:opacity-50"
                                    >
                                      {receiptLoading === payment.id
                                        ? 'Đang tải…'
                                        : 'Xem biên lai'}
                                    </button>
                                  )}
                                </div>
                              </details>
                            </li>
                          ))}
                        </ul>
                        {paymentData.data.length === 0 && (
                          <p className="py-10 text-center text-sm text-zinc-400">
                            Chưa có giao dịch thanh toán.
                          </p>
                        )}
                        <TablePagination
                          currentPage={paymentPage}
                          pageSize={10}
                          totalItems={paymentData.meta.total}
                          onPageChange={setPaymentPage}
                        />
                      </>
                    )
                  )}
                </section>
              )}
            </div>
            {embedded && (
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#101012] px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={memberAction('edit')}
                    className={buttonStyle}
                    onClick={(event) => {
                      if (onEdit) {
                        event.preventDefault();
                        onEdit(member);
                      }
                    }}
                  >
                    <SquarePen className="h-4 w-4" />
                    Sửa thông tin
                  </Link>

                  {(current.length > 0 || upcoming.length > 0) && (
                    <details className="group relative">
                      <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
                        Thao tác khác
                      </summary>
                      <div className="absolute bottom-full left-0 z-20 mb-2 min-w-52 rounded-xl border border-white/10 bg-[#1a1a1e] p-1 shadow-xl">
                        {current[0]?.effectiveStatus ===
                          SubscriptionStatus.ACTIVE &&
                          current[0].paymentStatus === PaymentStatus.PAID && (
                            <Link
                              href={
                                '/dashboard/staff/freezes?action=create&subscriptionId=' +
                                current[0].id +
                                '&memberCode=' +
                                encodeURIComponent(member.memberCode)
                              }
                              className="block rounded-lg px-3 py-2 text-sm text-zinc-200 hover:bg-white/5"
                            >
                              Bảo lưu gói
                            </Link>
                          )}
                        {onCancel && (
                          <button
                            type="button"
                            onClick={() =>
                              onCancel(member, current[0] ?? upcoming[0]!)
                            }
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-white/5"
                          >
                            Hủy{' '}
                            {current[0]?.plan.name ?? upcoming[0]?.plan.name}
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
                {outstanding > 0 ? (
                  <Link
                    href={'/dashboard/staff/pos?memberId=' + memberId}
                    className={cn(
                      buttonStyle,
                      'border-[#FF5500] bg-[#FF5500] text-white',
                    )}
                  >
                    Thu {formatVnd(outstanding)}
                  </Link>
                ) : upcoming.length > 0 ? (
                  <button
                    type="button"
                    className={buttonStyle}
                    onClick={() => {
                      setTab('overview');
                      window.requestAnimationFrame(() => {
                        upcomingRef.current?.scrollIntoView({ block: 'start' });
                        upcomingRef.current?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    Xem gói chờ
                  </button>
                ) : (
                  canRenew && (
                    <Link
                      href={memberAction('renew')}
                      onClick={(event) => {
                        if (onRenew) {
                          event.preventDefault();
                          onRenew(member, renewalSource);
                        }
                      }}
                      className={cn(
                        buttonStyle,
                        'border-[#FF5500] bg-[#FF5500] text-white hover:bg-[#e64d00]',
                      )}
                    >
                      {renewalSource ? 'Gia hạn' : 'Đăng ký gói'}
                    </Link>
                  )
                )}
              </footer>
            )}
          </>
        )
      )}
      {receipt && (
        <ModalFrame
          onClose={() => setReceipt(null)}
          labelledBy="profile-receipt-title"
        >
          <div className="rounded-2xl border border-white/10 bg-[#141418] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="profile-receipt-title"
                  className="text-lg font-semibold text-white"
                >
                  Biên lai thanh toán
                </h2>
                <p className="mt-1 break-all font-mono text-xs text-zinc-500">
                  {receipt.receiptNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceipt(null)}
                className="min-h-9 px-2 text-sm text-zinc-400 hover:text-white"
              >
                Đóng
              </button>
            </div>
            <p className="my-6 text-3xl font-semibold tabular-nums text-white">
              {formatVnd(receipt.amount)}
            </p>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Hội viên</dt>
                <dd className="mt-1 text-zinc-200">
                  {receipt.member.fullName}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Gói tập</dt>
                <dd className="mt-1 text-zinc-200">
                  {receipt.subscription.planName}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Thời điểm thu</dt>
                <dd className="mt-1 text-zinc-200">
                  {date(receipt.confirmedAt, true)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Người thu</dt>
                <dd className="mt-1 text-zinc-200">
                  {receipt.cashier.fullName}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Phương thức</dt>
                <dd className="mt-1 text-zinc-200">
                  {(
                    {
                      CASH: 'Tiền mặt',
                      TRANSFER: 'Chuyển khoản',
                      CARD: 'Thẻ ngân hàng',
                    } as Record<string, string>
                  )[receipt.method] ?? receipt.method}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Thời hạn gói</dt>
                <dd className="mt-1 text-zinc-200">
                  {date(receipt.subscription.startDate)} —{' '}
                  {date(receipt.subscription.endDate)}
                </dd>
              </div>
              {receipt.note && (
                <div className="sm:col-span-2">
                  <dt className="text-zinc-500">Ghi chú</dt>
                  <dd className="mt-1 break-words text-zinc-200">
                    {receipt.note}
                  </dd>
                </div>
              )}{' '}
            </dl>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
