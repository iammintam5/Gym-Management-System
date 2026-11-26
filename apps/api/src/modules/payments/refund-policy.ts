import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@gym/database';
import type { PaymentRefundPreview } from '@gym/contracts';

/** Caller holds the scheduling/member lock; the preview never changes business data. */
export async function subscriptionRefundPreview(
  tx: Prisma.TransactionClient,
  paymentId: string,
  now: Date,
): Promise<PaymentRefundPreview> {
  const payment = await tx.paymentRecord.findUnique({
    where: { id: paymentId },
  });
  if (!payment) throw new NotFoundException('Không tìm thấy biên lai.');
  const result: PaymentRefundPreview = {
    subscriptionId: payment.subscriptionId,
    planName: '',
    amount: 0,
    receiptCount: 0,
    futureBookingCount: 0,
    deadline: null,
    eligible: false,
    reasons: [],
  };
  const reasons = result.reasons;
  if (!payment.subscriptionId || payment.ptPurchaseId) {
    reasons.push(
      'Chỉ hỗ trợ hoàn tiền gói Gym; giao dịch PT cũ cần được đối chiếu riêng.',
    );
    return result;
  }
  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: payment.subscriptionId },
    include: {
      plan: true,
      payments: true,
      quotas: true,
      freezes: true,
      nextSubscription: { select: { id: true } },
    },
  });
  result.planName = sub.plan.name;
  const paid = sub.payments.filter((p) => p.status === 'PAID');
  const total = paid.reduce(
    (sum, p) => sum.plus(p.amount),
    new Prisma.Decimal(0),
  );
  result.amount = Number(total);
  result.receiptCount = paid.length;
  if (payment.status !== 'PAID')
    reasons.push('Biên lai phải ở trạng thái đã thanh toán và chưa hoàn tiền.');
  if (
    !total.isPositive() ||
    !total.equals(sub.agreedPrice) ||
    sub.paymentStatus !== 'PAID'
  )
    reasons.push(
      'Gói phải được thanh toán đủ, số tiền thực thu phải khớp giá đã thỏa thuận.',
    );
  if (sub.payments.some((p) => p.status === 'REFUNDED'))
    reasons.push(
      'Gói đã có khoản hoàn tiền; cần đối chiếu lịch sử trước khi xử lý.',
    );
  if (
    sub.status === 'SUSPENDED' ||
    sub.freezes.some((f) => f.status === 'APPROVED' && !f.restoredAt)
  )
    reasons.push(
      'Gói đang có bảo lưu được duyệt; cần xử lý bảo lưu trước khi hoàn tiền.',
    );
  if (sub.previousSubscriptionId || sub.nextSubscription)
    reasons.push(
      'Gói thuộc chuỗi gia hạn; cần xử lý liên kết gia hạn trước khi hoàn tiền.',
    );
  if (!paid.length || paid.some((p) => !p.confirmedAt || p.currency !== 'VND'))
    reasons.push(
      'Thiếu ngày thu tiền hoặc giao dịch không dùng VND; cần đối chiếu trước khi hoàn.',
    );
  else {
    const settledAt = new Date(
      Math.max(...paid.map((p) => p.confirmedAt!.getTime())),
    );
    const deadline = new Date(settledAt.getTime() + 7 * 86400000);
    result.deadline = deadline.toISOString();
    if (now > deadline || settledAt > now)
      reasons.push('Chỉ được hoàn trong 7 ngày kể từ lúc thanh toán đủ.');
  }
  const [
    accepted,
    unknownCheckins,
    usedBookings,
    unresolvedBookings,
    bookings,
    consumed,
  ] = await Promise.all([
    tx.checkin.count({ where: { subscriptionId: sub.id, status: 'ACCEPTED' } }),
    tx.checkin.count({
      where: {
        memberId: sub.memberId,
        subscriptionId: null,
        status: 'ACCEPTED',
        checkedInAt: { gte: sub.startDate, lte: sub.endDate },
      },
    }),
    tx.classBooking.count({
      where: {
        subscriptionId: sub.id,
        OR: [
          { status: { in: ['COMPLETED', 'NO_SHOW'] } },
          { attendance: { in: ['PRESENT', 'ABSENT', 'NO_SHOW'] } },
        ],
      },
    }),
    tx.classBooking.count({
      where: {
        subscriptionId: sub.id,
        status: 'BOOKED',
        attendance: 'PENDING',
        schedule: { startsAt: { lt: now } },
      },
    }),
    tx.classBooking.findMany({
      where: {
        subscriptionId: sub.id,
        status: 'BOOKED',
        attendance: 'PENDING',
        schedule: { startsAt: { gte: now } },
      },
      select: { quotaId: true },
    }),
    tx.quotaTransaction.count({
      where: { subscriptionId: sub.id, usedDelta: { gt: 0 } },
    }),
  ]);
  result.futureBookingCount = bookings.length;
  if (
    accepted ||
    usedBookings ||
    consumed ||
    sub.quotas.some((q) => q.used > 0)
  )
    reasons.push(
      'Gói đã được sử dụng để vào tập, điểm danh hoặc tính mất lượt; không đủ điều kiện hoàn tiền.',
    );
  if (unknownCheckins || unresolvedBookings)
    reasons.push(
      'Có lịch sử sử dụng chưa thể đối chiếu đầy đủ; cần kiểm tra trước khi hoàn tiền.',
    );
  if (
    sub.quotas.some(
      (q) =>
        q.allocated !== null &&
        q.reserved !== bookings.filter((b) => b.quotaId === q.id).length,
    )
  )
    reasons.push(
      'Lượt giữ chỗ chưa khớp lịch lớp; cần đối chiếu trước khi hoàn tiền.',
    );
  result.eligible = reasons.length === 0;
  return result;
}
