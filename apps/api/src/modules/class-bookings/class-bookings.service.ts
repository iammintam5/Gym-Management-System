import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  AuthUser,
  BookingStatus,
  ClassBookingDetail,
  PaginatedClassBookingsResponse,
  QuotaTransactionType,
  ScheduleStatus,
  ServiceTypeCode,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';
import {
  lockScheduleWrites,
  assertBookingAccess,
  assertAttendanceTime,
} from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import { CreateClassBookingDto } from './dto/create-class-booking.dto';
import { MarkClassAttendanceDto } from './dto/mark-attendance.dto';
import { QueryClassBookingsDto } from './dto/query-class-bookings.dto';

interface RawBookingWithRelations {
  id: string;
  scheduleId: string;
  memberId: string;
  subscriptionId: string;
  quotaId: string;
  status: string;
  attendance: string;
  cancelledAt: Date | null;
  attendedAt: Date | null;
  createdAt: Date;
  schedule: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    gymClass: {
      name: string;
      description: string | null;
    };
    trainer: {
      fullName: string;
      phone: string | null;
    };
  };
  member: {
    id: string;
    fullName: string;
    idPhotoUrl?: string | null;
  };
}

@Injectable()
export class ClassBookingsService {
  private readonly logger = new Logger(ClassBookingsService.name);

  constructor(private readonly db: DatabaseService) {}

  async createBooking(
    dto: CreateClassBookingDto,
    user: AuthUser,
  ): Promise<ClassBookingDetail> {
    // 1. Resolve target member
    let targetMember: {
      id: string;
      fullName: string;
      userId: string;
      user: { isActive: boolean };
    } | null = null;

    if (user.roles.includes(UserRole.MEMBER) && !dto.memberId) {
      targetMember = await this.db.client.memberProfile.findUnique({
        where: { userId: user.id },
        include: { user: true },
      });
      if (!targetMember) {
        throw new NotFoundException(
          'Member profile not found for current user',
        );
      }
    } else {
      if (!dto.memberId) {
        throw new BadRequestException(
          'memberId is required when booking on behalf of member',
        );
      }
      targetMember = await this.db.client.memberProfile.findUnique({
        where: { id: dto.memberId },
        include: { user: true },
      });
      if (!targetMember) {
        throw new NotFoundException(
          `Member with ID "${dto.memberId}" not found`,
        );
      }
    }

    if (
      user.roles.includes(UserRole.MEMBER) &&
      !user.roles.some(
        (role) => role === UserRole.ADMIN || role === UserRole.STAFF,
      ) &&
      targetMember.userId !== user.id
    ) {
      throw new ForbiddenException(
        'Hội viên chỉ được đặt lịch cho chính mình.',
      );
    }
    if (!targetMember.user.isActive) {
      throw new ConflictException(
        'Tài khoản hội viên đã bị khoá hoặc ngưng hoạt động',
      );
    }

    const booking = await this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${targetMember.id}::uuid FOR UPDATE`;
      // 2. Validate schedule
      const schedule = await tx.classSchedule.findUnique({
        where: { id: dto.scheduleId },
        include: {
          gymClass: true,
          trainer: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException(
          `Class schedule with ID "${dto.scheduleId}" not found`,
        );
      }

      if (schedule.status !== ScheduleStatus.SCHEDULED) {
        throw new ConflictException(
          `Không thể đặt chỗ cho ca dạy có trạng thái ${schedule.status}`,
        );
      }

      const now = new Date();
      if (schedule.startsAt.getTime() <= now.getTime()) {
        throw new BadRequestException(
          'Không thể đặt chỗ cho ca dạy đã diễn ra hoặc đã kết thúc',
        );
      }

      // Check capacity
      const bookedCount = await tx.classBooking.count({
        where: {
          scheduleId: dto.scheduleId,
          status: BookingStatus.BOOKED,
        },
      });

      if (bookedCount >= schedule.capacity) {
        throw new ConflictException(
          'Lớp học đã đủ sĩ số (Class schedule is fully booked)',
        );
      }

      // Check if member already booked
      const existing = await tx.classBooking.findUnique({
        where: {
          scheduleId_memberId: {
            scheduleId: dto.scheduleId,
            memberId: targetMember.id,
          },
        },
      });

      if (existing && existing.status === BookingStatus.BOOKED) {
        throw new ConflictException(
          'Hội viên đã đặt chỗ cho ca dạy này (Member already has an active booking for this schedule)',
        );
      }

      const overlappingClass = await tx.classBooking.findFirst({
        where: {
          memberId: targetMember.id,
          status: BookingStatus.BOOKED,
          schedule: {
            startsAt: { lt: schedule.endsAt },
            endsAt: { gt: schedule.startsAt },
          },
        },
      });
      const overlappingPt = await tx.ptBooking.findFirst({
        where: {
          memberId: targetMember.id,
          status: BookingStatus.BOOKED,
          startsAt: { lt: schedule.endsAt },
          endsAt: { gt: schedule.startsAt },
        },
      });
      if (overlappingClass || overlappingPt)
        throw new ConflictException('Hội viên đã có lịch tập trùng thời gian.');
      // Check active subscription covering class date
      const activeSub = await tx.subscription.findFirst({
        where: {
          memberId: targetMember.id,
          status: SubscriptionStatus.ACTIVE,
          startDate: { lte: schedule.startsAt },
          endDate: { gte: schedule.startsAt },
        },
        include: {
          quotas: {
            include: { serviceType: true },
          },
        },
        orderBy: { endDate: 'desc' },
      });

      if (!activeSub) {
        throw new BadRequestException(
          'Hội viên không có gói tập đang hoạt động bao trùm ngày diễn ra lớp học (No active subscription covering class date)',
        );
      }

      await assertBookingAccess(
        tx,
        activeSub.id,
        schedule.startsAt,
        schedule.endsAt,
      );
      // Check CLASS quota entitlement
      const classQuota = activeSub.quotas.find(
        (q) => q.serviceType.code === ServiceTypeCode.CLASS,
      );

      if (!classQuota) {
        throw new BadRequestException(
          'Gói tập của hội viên không bao gồm quyền tham gia lớp học (CLASS entitlement required)',
        );
      }

      // Check remaining quota
      if (classQuota.allocated !== null) {
        const remaining =
          classQuota.allocated - classQuota.reserved - classQuota.used;
        if (remaining <= 0) {
          throw new ConflictException(
            'Gói tập đã hết số lượt tham gia lớp học (CLASS quota exhausted)',
          );
        }

        const reserved =
          await tx.$executeRaw`UPDATE subscription_quotas SET reserved = reserved + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${classQuota.id}::uuid AND used + reserved < allocated`;
        if (reserved !== 1)
          throw new ConflictException('Gói tập đã hết lượt khả dụng.');

        await tx.quotaTransaction.create({
          data: {
            quotaId: classQuota.id,
            subscriptionId: activeSub.id,
            type: QuotaTransactionType.RESERVE,
            reservedDelta: 1,
            idempotencyKey: `book-schedule-${dto.scheduleId}-member-${targetMember.id}-${Date.now()}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: dto.scheduleId,
            reason: `Đặt chỗ lớp học ${schedule.gymClass.name}`,
            createdBy: user.id,
          },
        });
      } else {
        await tx.quotaTransaction.create({
          data: {
            quotaId: classQuota.id,
            subscriptionId: activeSub.id,
            type: QuotaTransactionType.RESERVE,
            reservedDelta: 0,
            idempotencyKey: `book-schedule-${dto.scheduleId}-member-${targetMember.id}-${Date.now()}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: dto.scheduleId,
            reason: `Đặt chỗ lớp học (Gói không giới hạn) ${schedule.gymClass.name}`,
            createdBy: user.id,
          },
        });
      }

      // Upsert booking
      const createdBooking = await tx.classBooking.upsert({
        where: {
          scheduleId_memberId: {
            scheduleId: dto.scheduleId,
            memberId: targetMember.id,
          },
        },
        create: {
          scheduleId: dto.scheduleId,
          memberId: targetMember.id,
          subscriptionId: activeSub.id,
          quotaId: classQuota.id,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
        },
        update: {
          subscriptionId: activeSub.id,
          quotaId: classQuota.id,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
          cancelledAt: null,
          attendedAt: null,
        },
        include: {
          schedule: {
            include: {
              gymClass: true,
              trainer: true,
            },
          },
          member: true,
        },
      });

      return createdBooking;
    });

    this.logger.log(
      `Class booking created: Booking ${booking.id} for member ${targetMember.fullName} (${targetMember.id}) in schedule ${booking.schedule.id} (${booking.schedule.gymClass.name})`,
    );

    return this.mapBookingDetail(booking as unknown as RawBookingWithRelations);
  }

  async cancelBooking(
    bookingId: string,
    user: AuthUser,
  ): Promise<ClassBookingDetail> {
    const booking = await this.db.client.classBooking.findUnique({
      where: { id: bookingId },
      include: {
        schedule: {
          include: {
            gymClass: true,
            trainer: true,
          },
        },
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID "${bookingId}" not found`);
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException(
        'Đặt chỗ này đã được huỷ trước đó (Booking already cancelled)',
      );
    }

    if (
      booking.status === BookingStatus.COMPLETED ||
      booking.attendance === AttendanceStatus.PRESENT
    ) {
      throw new ConflictException(
        'Không thể huỷ đặt chỗ cho buổi học đã tham gia (Cannot cancel an attended booking)',
      );
    }

    const now = new Date();

    // Check Member ownership and 2-hour cancellation policy
    if (user.roles.includes(UserRole.MEMBER)) {
      if (booking.member.userId !== user.id) {
        throw new ForbiddenException(
          'Hội viên không có quyền huỷ đặt chỗ của người khác',
        );
      }

      const cutoff = new Date(
        booking.schedule.startsAt.getTime() - 2 * 60 * 60 * 1000,
      );
      if (now.getTime() > cutoff.getTime()) {
        throw new BadRequestException(
          'Hội viên chỉ được huỷ đặt chỗ trước giờ học ít nhất 2 tiếng (Cancellation allowed up to 2 hours before class start)',
        );
      }
    }

    // Atomic transaction for cancellation and quota refund
    const cancelled = await this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${booking.memberId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${booking.subscriptionId}::uuid FOR UPDATE`;
      const current = await tx.classBooking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { schedule: true },
      });
      if (
        current.status !== BookingStatus.BOOKED ||
        current.attendance !== AttendanceStatus.PENDING
      )
        throw new ConflictException('Đặt chỗ đã được xử lý. Vui lòng tải lại.');

      const updatedBooking = await tx.classBooking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: now,
        },
        include: {
          schedule: {
            include: {
              gymClass: true,
              trainer: true,
            },
          },
          member: true,
        },
      });

      const quota = await tx.subscriptionQuota.findUnique({
        where: { id: booking.quotaId },
      });

      if (quota && quota.allocated !== null) {
        await tx.subscriptionQuota.update({
          where: { id: booking.quotaId },
          data: { reserved: { decrement: 1 } },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: booking.quotaId,
            subscriptionId: booking.subscriptionId,
            type: QuotaTransactionType.REFUND,
            reservedDelta: -1,
            idempotencyKey: `cancel-booking-${bookingId}-${Date.now()}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: bookingId,
            reason:
              'Hội viên huỷ đặt chỗ trước giờ học (Member cancelled class slot)',
            createdBy: user.id,
          },
        });
      }

      return updatedBooking;
    });

    this.logger.log(
      `Class booking ${bookingId} cancelled by actor ${user.id} (${booking.member.fullName})`,
    );

    return this.mapBookingDetail(
      cancelled as unknown as RawBookingWithRelations,
    );
  }

  async markAttendance(
    bookingId: string,
    dto: MarkClassAttendanceDto,
    user: AuthUser,
  ): Promise<ClassBookingDetail> {
    const booking = await this.db.client.classBooking.findUnique({
      where: { id: bookingId },
      include: {
        schedule: {
          include: {
            gymClass: true,
            trainer: { include: { user: true } },
          },
        },
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID "${bookingId}" not found`);
    }

    // Check authority: Admin, Staff, or the assigned Trainer
    const isTrainer = booking.schedule.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.STAFF);

    if (!isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách ca dạy hoặc Nhân viên/Quản trị viên mới có quyền điểm danh',
      );
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException(
        'Không thể điểm danh cho đặt chỗ đã bị huỷ (Cannot mark attendance for cancelled booking)',
      );
    }

    if (booking.attendance !== AttendanceStatus.PENDING) {
      throw new ConflictException(
        `Học viên này đã được điểm danh trước đó (${booking.attendance})`,
      );
    }

    const now = new Date();

    const updated = await this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      await tx.$queryRaw`SELECT id FROM member_profiles WHERE id = ${booking.memberId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${booking.subscriptionId}::uuid FOR UPDATE`;
      const current = await tx.classBooking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { schedule: true },
      });
      if (
        current.status !== BookingStatus.BOOKED ||
        current.attendance !== AttendanceStatus.PENDING
      )
        throw new ConflictException('Đặt chỗ đã được xử lý. Vui lòng tải lại.');
      assertAttendanceTime(
        current.schedule.startsAt,
        current.schedule.endsAt,
        dto.attendance === AttendanceStatus.ABSENT,
      );
      if (current.schedule.status !== ScheduleStatus.SCHEDULED)
        throw new ConflictException('Ca học không còn mở để điểm danh.');
      await assertBookingAccess(
        tx,
        current.subscriptionId,
        current.schedule.startsAt,
        current.schedule.endsAt,
      );

      const isPresent = dto.attendance === 'PRESENT';

      const updatedBooking = await tx.classBooking.update({
        where: { id: bookingId },
        data: {
          attendance: isPresent
            ? AttendanceStatus.PRESENT
            : AttendanceStatus.ABSENT,
          status: isPresent ? BookingStatus.COMPLETED : BookingStatus.NO_SHOW,
          attendedAt: isPresent ? now : null,
        },
        include: {
          schedule: {
            include: {
              gymClass: true,
              trainer: true,
            },
          },
          member: true,
        },
      });

      const quota = await tx.subscriptionQuota.findUnique({
        where: { id: booking.quotaId },
      });

      if (quota && quota.allocated !== null) {
        // Transfer 1 slot from reserved to used
        await tx.subscriptionQuota.update({
          where: { id: booking.quotaId },
          data: {
            reserved: { decrement: 1 },
            used: { increment: 1 },
          },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: booking.quotaId,
            subscriptionId: booking.subscriptionId,
            type: QuotaTransactionType.USE,
            reservedDelta: -1,
            usedDelta: 1,
            idempotencyKey: `attendance-${dto.attendance.toLowerCase()}-${bookingId}-${Date.now()}`,
            referenceType: 'CLASS_BOOKING',
            referenceId: bookingId,
            reason: isPresent
              ? `Điểm danh có mặt lớp ${booking.schedule.gymClass.name}`
              : `Vắng mặt không báo trước (No-show quota forfeiture) lớp ${booking.schedule.gymClass.name}`,
            createdBy: user.id,
          },
        });
      }

      return updatedBooking;
    });

    this.logger.log(
      `Attendance marked for booking ${bookingId}: ${dto.attendance} by ${user.id}`,
    );

    return this.mapBookingDetail(updated as unknown as RawBookingWithRelations);
  }

  async findMyBookings(
    user: AuthUser,
    query: QueryClassBookingsDto,
  ): Promise<PaginatedClassBookingsResponse> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Member profile not found for current user');
    }

    const skip = (query.page - 1) * query.limit;

    const where: {
      memberId: string;
      status?: BookingStatus;
      attendance?: AttendanceStatus;
    } = {
      memberId: profile.id,
    };

    if (query.status) where.status = query.status;
    if (query.attendance) where.attendance = query.attendance;

    const [total, items] = await Promise.all([
      this.db.client.classBooking.count({ where }),
      this.db.client.classBooking.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { schedule: { startsAt: 'desc' } },
        include: {
          schedule: {
            include: {
              gymClass: true,
              trainer: true,
            },
          },
          member: true,
        },
      }),
    ]);

    return {
      data: items.map((item) =>
        this.mapBookingDetail(item as unknown as RawBookingWithRelations),
      ),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async findBySchedule(
    scheduleId: string,
    user: AuthUser,
  ): Promise<ClassBookingDetail[]> {
    const schedule = await this.db.client.classSchedule.findUnique({
      where: { id: scheduleId },
      include: { trainer: true },
    });

    if (!schedule) {
      throw new NotFoundException(
        `Class schedule with ID "${scheduleId}" not found`,
      );
    }

    // Role check
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.STAFF);
    const isTrainer = schedule.trainer.userId === user.id;

    if (!isStaffOrAdmin && !isTrainer) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách ca dạy hoặc Nhân viên/Quản trị viên mới có thể xem danh sách học viên',
      );
    }

    const bookings = await this.db.client.classBooking.findMany({
      where: { scheduleId },
      orderBy: { createdAt: 'asc' },
      include: {
        schedule: {
          include: {
            gymClass: true,
            trainer: true,
          },
        },
        member: true,
      },
    });

    return bookings.map((item) =>
      this.mapBookingDetail(item as unknown as RawBookingWithRelations),
    );
  }

  private mapBookingDetail(item: RawBookingWithRelations): ClassBookingDetail {
    const memberCode = `MEM-${item.member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    return {
      id: item.id,
      scheduleId: item.scheduleId,
      className: item.schedule.gymClass.name,
      classDescription: item.schedule.gymClass.description,
      trainerName: item.schedule.trainer.fullName,
      trainerPhone: item.schedule.trainer.phone,
      startsAt: item.schedule.startsAt.toISOString(),
      endsAt: item.schedule.endsAt.toISOString(),
      memberId: item.memberId,
      memberCode,
      memberFullName: item.member.fullName,
      memberIdPhotoUrl: item.member.idPhotoUrl ?? null,
      subscriptionId: item.subscriptionId,
      quotaId: item.quotaId,
      status: item.status as BookingStatus,
      attendance: item.attendance as AttendanceStatus,
      cancelledAt: item.cancelledAt ? item.cancelledAt.toISOString() : null,
      attendedAt: item.attendedAt ? item.attendedAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
