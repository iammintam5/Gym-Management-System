import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@gym/database';

/** Class and PT timetable mutations share the same transaction lock. */
export async function lockScheduleWrites(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('gym-scheduling', 0))::text`;
}

export async function assertBookingAccess(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    include: { member: { include: { user: true } } },
  });
  if (
    sub.status !== 'ACTIVE' ||
    sub.paymentStatus !== 'PAID' ||
    !sub.member.user.isActive ||
    sub.startDate > startsAt ||
    sub.endDate < endsAt
  ) {
    throw new BadRequestException(
      'Gói tập chưa thanh toán đủ hoặc không còn quyền tham gia buổi tập.',
    );
  }
  const freeze = await tx.subscriptionFreeze.findFirst({
    where: {
      subscriptionId,
      status: 'APPROVED',
      restoredAt: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });
  if (freeze)
    throw new ConflictException(
      'Buổi tập nằm trong thời gian bảo lưu đã duyệt.',
    );
}

export function assertAttendanceTime(
  startsAt: Date,
  endsAt: Date,
  absent: boolean,
): void {
  const now = new Date();
  if (startsAt > now || (absent && endsAt > now)) {
    throw new BadRequestException(
      absent
        ? 'Chỉ điểm danh vắng sau khi buổi tập kết thúc.'
        : 'Buổi tập chưa bắt đầu.',
    );
  }
}
