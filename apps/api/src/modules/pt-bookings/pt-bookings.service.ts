import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import { DatabaseService } from '../database/database.module';
import { CreatePtBookingDto } from './dto/create-pt-booking.dto';
import { MarkPtAttendanceDto } from './dto/mark-pt-attendance.dto';
import { QueryPtBookingsDto } from './dto/query-pt-bookings.dto';
import {
  AttendanceStatus,
  AuthUser,
  BookingStatus,
  PaginatedPtBookingsResponse,
  PtBookingDetail,
  QuotaTransactionType,
  ScheduleStatus,
  ServiceTypeCode,
  SubscriptionStatus,
  UserRole,
} from '@gym/contracts';

interface RawPtBookingWithRelations {
  id: string;
  memberId: string;
  trainerId: string;
  subscriptionId: string;
  quotaId: string;
  availabilityId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  attendance: AttendanceStatus;
  cancelledAt: Date | null;
  attendedAt: Date | null;
  createdAt: Date;
  member?: {
    memberCode?: string | null;
    fullName: string;
    phone?: string | null;
  } | null;
  trainer?: {
    fullName: string;
    phone?: string | null;
  } | null;
}

@Injectable()
export class PtBookingsService {
  constructor(private readonly db: DatabaseService) {}

  async createBooking(
    dto: CreatePtBookingDto,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    // 1. Resolve Target Member ID
    let targetMemberId: string;

    if (
      user.roles.includes(UserRole.MEMBER) &&
      (!dto.memberId ||
        !user.roles.some((r) => r === UserRole.STAFF || r === UserRole.ADMIN))
    ) {
      const memberProfile = await this.db.client.memberProfile.findFirst({
        where: { userId: user.id },
      });
      if (!memberProfile) {
        throw new NotFoundException('Không tìm thấy thông tin hội viên của bạn');
      }
      targetMemberId = memberProfile.id;
    } else {
      // Staff or Admin booking on behalf of a member
      if (!dto.memberId) {
        throw new BadRequestException(
          'Vui lòng chỉ định memberId khi nhân viên đặt lịch',
        );
      }
      const memberProfile = await this.db.client.memberProfile.findUnique({
        where: { id: dto.memberId },
      });
      if (!memberProfile) {
        throw new NotFoundException(
          `Hội viên với ID "${dto.memberId}" không tồn tại`,
        );
      }
      targetMemberId = memberProfile.id;
    }

    // 2. Validate Trainer
    const trainer = await this.db.client.employeeProfile.findUnique({
      where: { id: dto.trainerId },
      include: {
        user: {
          include: {
            roles: { include: { role: true } },
          },
        },
      },
    });

    if (!trainer) {
      throw new NotFoundException(
        `Huấn luyện viên với ID "${dto.trainerId}" không tồn tại`,
      );
    }

    if (!trainer.user.isActive) {
      throw new BadRequestException('Tài khoản Huấn luyện viên này đã bị vô hiệu hoá');
    }

    const hasPtRole = trainer.user.roles.some(
      (r: { role: { code: string } }) => r.role.code === UserRole.PT,
    );
    if (!hasPtRole) {
      throw new BadRequestException(
        `Nhân viên "${trainer.fullName}" không có chuyên môn/vai trò Huấn luyện viên (PT role required)`,
      );
    }

    // 3. Validate Timing
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('startsAt hoặc endsAt không đúng định dạng');
    }

    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('startsAt phải nhỏ hơn endsAt');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes < 30 || durationMinutes > 180) {
      throw new BadRequestException(
        `Thời lượng buổi tập PT phải từ 30 đến 180 phút (hiện tại: ${Math.round(durationMinutes)} phút)`,
      );
    }

    // 4. Validate Trainer Schedule Conflicts
    // a. ClassSchedule conflict
    const classConflict = await this.db.client.classSchedule.findFirst({
      where: {
        trainerId: dto.trainerId,
        status: ScheduleStatus.SCHEDULED,
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: { gymClass: true },
    });
    if (classConflict) {
      throw new ConflictException(
        `Huấn luyện viên đã có lịch dạy lớp "${classConflict.gymClass.name}" vào khung giờ này`,
      );
    }

    // b. PT Booking conflict
    const ptConflict = await this.db.client.ptBooking.findFirst({
      where: {
        trainerId: dto.trainerId,
        status: BookingStatus.BOOKED,
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
    });
    if (ptConflict) {
      throw new ConflictException(
        'Huấn luyện viên đã có lịch tập 1-1 khác vào khung giờ này (Trainer conflict with existing PT booking)',
      );
    }

    // 5. Validate Member Conflicts
    // a. Member overlapping PT Booking
    const memberPtConflict = await this.db.client.ptBooking.findFirst({
      where: {
        memberId: targetMemberId,
        status: BookingStatus.BOOKED,
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
    });
    if (memberPtConflict) {
      throw new ConflictException(
        'Hội viên đã có lịch tập PT 1-1 khác vào khung giờ này (Member PT booking conflict)',
      );
    }

    // b. Member overlapping Class Booking
    const memberClassConflict = await this.db.client.classBooking.findFirst({
      where: {
        memberId: targetMemberId,
        status: BookingStatus.BOOKED,
        schedule: {
          status: ScheduleStatus.SCHEDULED,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
      },
      include: { schedule: { include: { gymClass: true } } },
    });
    if (memberClassConflict) {
      throw new ConflictException(
        `Hội viên đã có lịch tham gia lớp "${memberClassConflict.schedule.gymClass.name}" vào khung giờ này`,
      );
    }

    // 6. Validate Availability Slot (if specified)
    if (dto.availabilityId) {
      const avail = await this.db.client.ptAvailability.findFirst({
        where: {
          id: dto.availabilityId,
          trainerId: dto.trainerId,
          isAvailable: true,
          startsAt: { lte: start },
          endsAt: { gte: end },
        },
      });
      if (!avail) {
        throw new BadRequestException(
          'Khung giờ rảnh không tồn tại hoặc không bao trùm thời gian buổi tập',
        );
      }
    }

    // 7. Check Active Subscription & PT Quota
    const activeSub = await this.db.client.subscription.findFirst({
      where: {
        memberId: targetMemberId,
        status: SubscriptionStatus.ACTIVE,
        startDate: { lte: start },
        endDate: { gte: start },
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
        'Hội viên không có gói tập đang hoạt động bao trùm ngày diễn ra buổi tập (No active subscription covering date)',
      );
    }

    const ptQuota = activeSub.quotas.find(
      (q: { serviceType: { code: string } }) => q.serviceType.code === ServiceTypeCode.PT,
    );

    if (!ptQuota) {
      throw new BadRequestException(
        'Gói tập của hội viên không bao gồm quyền lợi tập cùng Huấn luyện viên (PT entitlement required)',
      );
    }

    if (ptQuota.allocated !== null) {
      const remaining = ptQuota.allocated - ptQuota.reserved - ptQuota.used;
      if (remaining <= 0) {
        throw new ConflictException(
          'Gói tập đã hết số lượt tập cùng Huấn luyện viên (PT quota exhausted)',
        );
      }
    }

    // 8. Atomic Transaction
    const booking = await this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      // Re-verify trainer conflict inside transaction for serialization
      const raceConflict = await tx.ptBooking.findFirst({
        where: {
          trainerId: dto.trainerId,
          status: BookingStatus.BOOKED,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
      });
      if (raceConflict) {
        throw new ConflictException(
          'Huấn luyện viên đã có lịch tập 1-1 khác vào khung giờ này (Trainer conflict)',
        );
      }

      // Reserve PT quota
      if (ptQuota.allocated !== null) {
        await tx.subscriptionQuota.update({
          where: { id: ptQuota.id },
          data: { reserved: { increment: 1 } },
        });

        await tx.quotaTransaction.create({
          data: {
            quotaId: ptQuota.id,
            subscriptionId: activeSub.id,
            type: QuotaTransactionType.RESERVE,
            reservedDelta: 1,
            idempotencyKey: `pt-book-${targetMemberId}-${dto.trainerId}-${start.getTime()}-${Date.now()}`,
            referenceType: 'PT_BOOKING',
            referenceId: dto.trainerId,
            reason: `Đặt lịch tập PT 1-1 với HLV ${trainer.fullName}`,
            createdBy: user.id,
          },
        });
      } else {
        await tx.quotaTransaction.create({
          data: {
            quotaId: ptQuota.id,
            subscriptionId: activeSub.id,
            type: QuotaTransactionType.RESERVE,
            reservedDelta: 0,
            idempotencyKey: `pt-book-${targetMemberId}-${dto.trainerId}-${start.getTime()}-${Date.now()}`,
            referenceType: 'PT_BOOKING',
            referenceId: dto.trainerId,
            reason: `Đặt lịch tập PT 1-1 (Gói không giới hạn) với HLV ${trainer.fullName}`,
            createdBy: user.id,
          },
        });
      }

      // Create PtBooking
      const created = await tx.ptBooking.create({
        data: {
          memberId: targetMemberId,
          trainerId: dto.trainerId,
          subscriptionId: activeSub.id,
          quotaId: ptQuota.id,
          availabilityId: dto.availabilityId ?? null,
          startsAt: start,
          endsAt: end,
          status: BookingStatus.BOOKED,
          attendance: AttendanceStatus.PENDING,
        },
        include: {
          member: true,
          trainer: true,
        },
      });

      return created;
    });

    return this.mapBookingDetail(booking as unknown as RawPtBookingWithRelations);
  }

  async cancelBooking(
    bookingId: string,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        member: true,
        trainer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Lịch tập PT với ID "${bookingId}" không tồn tại`);
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException('Lịch tập này đã được huỷ trước đó');
    }

    if (
      booking.status === BookingStatus.COMPLETED ||
      booking.attendance === AttendanceStatus.PRESENT
    ) {
      throw new ConflictException('Không thể huỷ buổi tập đã hoàn thành');
    }

    const now = new Date();
    const isStaffOrAdmin =
      user.roles.includes(UserRole.STAFF) || user.roles.includes(UserRole.ADMIN);
    const isTrainer = booking.trainer.userId === user.id;

    if (!isStaffOrAdmin && !isTrainer) {
      if (booking.member.userId !== user.id) {
        throw new ForbiddenException(
          'Hội viên không có quyền huỷ lịch tập của người khác',
        );
      }

      // 6-hour policy for member self-cancellation
      const cutoff = new Date(booking.startsAt.getTime() - 6 * 60 * 60 * 1000);
      if (now.getTime() > cutoff.getTime()) {
        throw new BadRequestException(
          'Quy định huỷ lịch: Hội viên chỉ được huỷ trước giờ tập ít nhất 6 tiếng (Cancellation allowed up to 6 hours before session start)',
        );
      }
    }

    const cancelled = await this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.ptBooking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: now,
        },
        include: {
          member: true,
          trainer: true,
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
            idempotencyKey: `cancel-pt-booking-${bookingId}-${Date.now()}`,
            referenceType: 'PT_BOOKING',
            referenceId: bookingId,
            reason: 'Huỷ lịch tập PT 1-1, hoàn lại quota giữ chỗ',
            createdBy: user.id,
          },
        });
      }

      return updated;
    });

    return this.mapBookingDetail(cancelled as unknown as RawPtBookingWithRelations);
  }

  async completeBooking(
    bookingId: string,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        trainer: true,
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Lịch tập PT với ID "${bookingId}" không tồn tại`);
    }

    const isTrainer = booking.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) || user.roles.includes(UserRole.STAFF);

    if (!isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách hoặc Nhân viên mới có quyền xác nhận hoàn thành buổi tập',
      );
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException('Không thể hoàn thành buổi tập đã bị huỷ');
    }

    if (
      booking.status === BookingStatus.COMPLETED ||
      booking.attendance === AttendanceStatus.PRESENT
    ) {
      throw new ConflictException('Buổi tập này đã được xác nhận hoàn thành trước đó');
    }

    const now = new Date();

    const completed = await this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.ptBooking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.COMPLETED,
          attendance: AttendanceStatus.PRESENT,
          attendedAt: now,
        },
        include: {
          member: true,
          trainer: true,
        },
      });

      const quota = await tx.subscriptionQuota.findUnique({
        where: { id: booking.quotaId },
      });

      if (quota && quota.allocated !== null) {
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
            idempotencyKey: `complete-pt-booking-${bookingId}-${Date.now()}`,
            referenceType: 'PT_BOOKING',
            referenceId: bookingId,
            reason: 'Hoàn thành buổi tập PT 1-1, chuyển quota reserved sang used',
            createdBy: user.id,
          },
        });
      }

      return updated;
    });

    return this.mapBookingDetail(completed as unknown as RawPtBookingWithRelations);
  }

  async markAttendance(
    bookingId: string,
    dto: MarkPtAttendanceDto,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    if (dto.attendance === AttendanceStatus.PRESENT) {
      return this.completeBooking(bookingId, user);
    }

    // Attendance is ABSENT
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        trainer: true,
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Lịch tập PT với ID "${bookingId}" không tồn tại`);
    }

    const isTrainer = booking.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) || user.roles.includes(UserRole.STAFF);

    if (!isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách hoặc Nhân viên mới có quyền điểm danh vắng mặt',
      );
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException('Không thể điểm danh buổi tập đã bị huỷ');
    }

    if (booking.attendance !== AttendanceStatus.PENDING) {
      throw new ConflictException(`Buổi tập này đã được điểm danh trước đó (${booking.attendance})`);
    }

    const marked = await this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.ptBooking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.NO_SHOW,
          attendance: AttendanceStatus.ABSENT,
          attendedAt: null,
        },
        include: {
          member: true,
          trainer: true,
        },
      });

      const quota = await tx.subscriptionQuota.findUnique({
        where: { id: booking.quotaId },
      });

      if (quota && quota.allocated !== null) {
        // Penalty: forfeit reserved slot as used
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
            idempotencyKey: `absent-pt-booking-${bookingId}-${Date.now()}`,
            referenceType: 'PT_BOOKING',
            referenceId: bookingId,
            reason: 'Hội viên vắng mặt buổi tập PT 1-1 (NO_SHOW), phạt trừ lượt tập',
            createdBy: user.id,
          },
        });
      }

      return updated;
    });

    return this.mapBookingDetail(marked as unknown as RawPtBookingWithRelations);
  }

  async findMyBookings(
    user: AuthUser,
    query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
    const memberProfile = await this.db.client.memberProfile.findFirst({
      where: { userId: user.id },
    });

    if (!memberProfile) {
      throw new NotFoundException('Không tìm thấy thông tin hội viên của bạn');
    }

    const where: Prisma.PtBookingWhereInput = {
      memberId: memberProfile.id,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.attendance) {
      where.attendance = query.attendance;
    }
    if (query.from) {
      where.endsAt = { gte: new Date(query.from) };
    }
    if (query.to) {
      where.startsAt = { lte: new Date(query.to) };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.db.client.ptBooking.count({ where }),
      this.db.client.ptBooking.findMany({
        where,
        include: {
          member: true,
          trainer: true,
        },
        orderBy: { startsAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((i: unknown) =>
        this.mapBookingDetail(i as RawPtBookingWithRelations),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findTrainerBookings(
    user: AuthUser,
    query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
    const employee = await this.db.client.employeeProfile.findFirst({
      where: { userId: user.id },
    });

    if (!employee) {
      throw new NotFoundException('Không tìm thấy thông tin nhân viên huấn luyện viên');
    }

    const where: Prisma.PtBookingWhereInput = {
      trainerId: employee.id,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.attendance) {
      where.attendance = query.attendance;
    }
    if (query.from) {
      where.endsAt = { gte: new Date(query.from) };
    }
    if (query.to) {
      where.startsAt = { lte: new Date(query.to) };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.db.client.ptBooking.count({ where }),
      this.db.client.ptBooking.findMany({
        where,
        include: {
          member: true,
          trainer: true,
        },
        orderBy: { startsAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((i: unknown) =>
        this.mapBookingDetail(i as RawPtBookingWithRelations),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findAll(query: QueryPtBookingsDto): Promise<PaginatedPtBookingsResponse> {
    const where: Prisma.PtBookingWhereInput = {};

    if (query.trainerId) {
      where.trainerId = query.trainerId;
    }
    if (query.memberId) {
      where.memberId = query.memberId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.attendance) {
      where.attendance = query.attendance;
    }
    if (query.from) {
      where.endsAt = { gte: new Date(query.from) };
    }
    if (query.to) {
      where.startsAt = { lte: new Date(query.to) };
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.db.client.ptBooking.count({ where }),
      this.db.client.ptBooking.findMany({
        where,
        include: {
          member: true,
          trainer: true,
        },
        orderBy: { startsAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items.map((i: unknown) =>
        this.mapBookingDetail(i as RawPtBookingWithRelations),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findById(id: string, user: AuthUser): Promise<PtBookingDetail> {
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id },
      include: {
        member: true,
        trainer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Lịch tập PT với ID "${id}" không tồn tại`);
    }

    const isMember = booking.member.userId === user.id;
    const isTrainer = booking.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) || user.roles.includes(UserRole.STAFF);

    if (!isMember && !isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException('Bạn không có quyền xem thông tin lịch tập này');
    }

    return this.mapBookingDetail(booking as unknown as RawPtBookingWithRelations);
  }

  private mapBookingDetail(item: RawPtBookingWithRelations): PtBookingDetail {
    return {
      id: item.id,
      memberId: item.memberId,
      memberCode: item.member?.memberCode ?? '',
      memberFullName: item.member?.fullName ?? '',
      memberPhone: item.member?.phone ?? null,
      trainerId: item.trainerId,
      trainerName: item.trainer?.fullName ?? '',
      trainerPhone: item.trainer?.phone ?? null,
      subscriptionId: item.subscriptionId,
      quotaId: item.quotaId,
      availabilityId: item.availabilityId ?? null,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      status: item.status,
      attendance: item.attendance,
      cancelledAt: item.cancelledAt ? item.cancelledAt.toISOString() : null,
      attendedAt: item.attendedAt ? item.attendedAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
