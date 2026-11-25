import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@gym/database';
import {
  lockScheduleWrites,
  assertAttendanceTime,
} from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import { PtCreditService } from '../pt-packages/pt-credit.service';
import { CreatePtBookingDto } from './dto/create-pt-booking.dto';
import { MarkPtAttendanceDto } from './dto/mark-pt-attendance.dto';
import { PtBookingActionDto } from './dto/pt-booking-action.dto';
import { QueryPtBookingsDto } from './dto/query-pt-bookings.dto';
import {
  AttendanceStatus,
  AuthUser,
  BookingStatus,
  PaginatedPtBookingsResponse,
  PtBookingDetail,
  ScheduleStatus,
  UserRole,
} from '@gym/contracts';

interface RawPtBookingWithRelations {
  id: string;
  memberId: string;
  trainerId: string;
  subscriptionId: string;
  sourceSubscriptionId?: string | null;
  quotaId: string | null;
  ptPurchaseId?: string | null;
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
    idPhotoUrl?: string | null;
  } | null;
  trainer?: {
    fullName: string;
    phone?: string | null;
  } | null;
}

@Injectable()
export class PtBookingsService {
  private readonly ptCredits: PtCreditService;

  constructor(
    private readonly db: DatabaseService,
    @Optional() ptCreditService?: PtCreditService,
  ) {
    this.ptCredits = ptCreditService ?? new PtCreditService(this.db);
  }

  async createBooking(
    dto: CreatePtBookingDto,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    // 1. Resolve Target Member ID & enforce strict ownership for MEMBER role
    let targetMemberId: string;
    const isStaffOrAdmin = user.roles.some(
      (r) => r === UserRole.STAFF || r === UserRole.ADMIN,
    );

    if (user.roles.includes(UserRole.MEMBER) && !isStaffOrAdmin) {
      const memberProfile = await this.db.client.memberProfile.findFirst({
        where: { userId: user.id },
      });
      if (!memberProfile) {
        throw new NotFoundException(
          'Không tìm thấy thông tin hội viên của bạn',
        );
      }
      if (dto.memberId && dto.memberId !== memberProfile.id) {
        throw new ForbiddenException(
          'Hội viên không được phép đặt lịch tập PT thay cho hội viên khác',
        );
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

    // 2. Validate Timing
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException(
        'startsAt hoặc endsAt không đúng định dạng',
      );
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

    const callerIdempotencyKey = dto.idempotencyKey?.trim() || undefined;
    const requestPayload = {
      memberId: targetMemberId,
      trainerId: dto.trainerId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      availabilityId: dto.availabilityId ?? null,
      actorId: user.id,
    };

    // 3. Atomic Transaction (locks schedule writes + member PT domain before validating capability, conflicts & credits)
    return this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockScheduleWrites(tx);

      if (callerIdempotencyKey) {
        const replay =
          await this.ptCredits.findIdempotentReplay<PtBookingDetail>(
            tx,
            callerIdempotencyKey,
            'CREATE_PT_BOOKING',
            requestPayload,
          );
        if (replay) {
          return replay.snapshot;
        }
      }

      await this.ptCredits.lockMemberPtDomain(tx, targetMemberId);

      // 7. Evaluate Gym Coverage & Select Canonical PT Credit Source
      const now = new Date();
      const { coveringSubscriptionId, selectedSource } =
        await this.ptCredits.evaluateAndSelectBookingSourceInTx(tx, {
          memberId: targetMemberId,
          startsAt: start,
          endsAt: end,
          now,
        });

      const covering = await tx.subscription.findUniqueOrThrow({
        where: { id: coveringSubscriptionId },
      });
      const trainerId = covering.assignedTrainerId;
      if (!trainerId)
        throw new ConflictException(
          'Gói Gym chưa được phân PT phụ trách. Vui lòng liên hệ lễ tân.',
        );
      if (dto.trainerId && dto.trainerId !== trainerId)
        throw new ForbiddenException(
          'Chỉ được đặt lịch với PT đã phân cho kỳ gói Gym này.',
        );

      const trainer = await tx.employeeProfile.findUnique({
        where: { id: trainerId },
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
          `Huấn luyện viên với ID "${trainerId}" không tồn tại`,
        );
      }

      if (!trainer.user.isActive) {
        throw new BadRequestException(
          'Tài khoản Huấn luyện viên này đã bị vô hiệu hoá',
        );
      }

      const hasPtRole = trainer.user.roles.some(
        (r: { role: { code: string } }) => r.role.code === UserRole.TRAINER,
      );
      if (!hasPtRole) {
        throw new BadRequestException(
          `Nhân viên "${trainer.fullName}" không có chuyên môn/vai trò Huấn luyện viên (TRAINER role required)`,
        );
      }

      if (!trainer.canCoachPt) {
        throw new BadRequestException(
          `Huấn luyện viên "${trainer.fullName}" hiện không nhận lịch tập PT 1-1 mới`,
        );
      }

      // 4. Validate Trainer Conflicts
      const classConflict = await tx.classSchedule.findFirst({
        where: {
          trainerId: trainerId,
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

      const ptConflict = await tx.ptBooking.findFirst({
        where: {
          trainerId: trainerId,
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
      const memberPtConflict = await tx.ptBooking.findFirst({
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

      const memberClassConflict = await tx.classBooking.findFirst({
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
        const avail = await tx.ptAvailability.findFirst({
          where: {
            id: dto.availabilityId,
            trainerId: trainerId,
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

      const bookingId = randomUUID();
      const ledgerIdempotencyKey =
        callerIdempotencyKey ?? `pt-booking:reserve:${bookingId}`;

      // 8. Persist PtBooking with immutable source links distinct from covering Gym subscription
      const created = await tx.ptBooking.create({
        data: {
          id: bookingId,
          memberId: targetMemberId,
          trainerId: trainerId,
          subscriptionId: coveringSubscriptionId,
          sourceSubscriptionId: selectedSource.sourceSubscriptionId,
          quotaId: selectedSource.quotaId,
          ptPurchaseId: selectedSource.ptPurchaseId,
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

      // 9. Reserve PT credit in shared service referencing actual bookingId
      const reason = selectedSource.unlimited
        ? `Đặt lịch tập PT 1-1 (Gói không giới hạn) với HLV ${trainer.fullName}`
        : `Đặt lịch tập PT 1-1 với HLV ${trainer.fullName}`;

      const { quotaTransactionId } =
        await this.ptCredits.reserveBookingCreditInTx(tx, {
          bookingId,
          selectedSource,
          idempotencyKey: ledgerIdempotencyKey,
          actorId: user.id,
          reason,
        });

      const detail = this.mapBookingDetail(
        created as unknown as RawPtBookingWithRelations,
      );

      await this.ptCredits.saveIdempotentMutationAudit(tx, {
        quotaTransactionId,
        idempotencyKey: ledgerIdempotencyKey,
        operation: 'CREATE_PT_BOOKING',
        actorId: user.id,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
  }

  async cancelBooking(
    bookingId: string,
    user: AuthUser,
    dto?: PtBookingActionDto,
  ): Promise<PtBookingDetail> {
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        member: true,
        trainer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(
        `Lịch tập PT với ID "${bookingId}" không tồn tại`,
      );
    }

    const isStaffOrAdmin =
      user.roles.includes(UserRole.STAFF) ||
      user.roles.includes(UserRole.ADMIN);
    const isTrainer = booking.trainer.userId === user.id;

    if (!isStaffOrAdmin && !isTrainer && booking.member.userId !== user.id) {
      throw new ForbiddenException(
        'Hội viên không có quyền huỷ lịch tập của người khác',
      );
    }

    const callerIdempotencyKey = dto?.idempotencyKey?.trim() || undefined;
    const requestPayload = {
      bookingId,
      actorId: user.id,
    };

    return this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockScheduleWrites(tx);

      if (callerIdempotencyKey) {
        const replay =
          await this.ptCredits.findIdempotentReplay<PtBookingDetail>(
            tx,
            callerIdempotencyKey,
            'CANCEL_PT_BOOKING',
            requestPayload,
          );
        if (replay) {
          return replay.snapshot;
        }
      }

      await this.ptCredits.lockMemberPtDomain(tx, booking.memberId);

      const current = await tx.ptBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });

      if (current.status === BookingStatus.CANCELLED) {
        throw new ConflictException('Lịch tập này đã được huỷ trước đó');
      }

      if (
        current.status === BookingStatus.COMPLETED ||
        current.attendance === AttendanceStatus.PRESENT
      ) {
        throw new ConflictException('Không thể huỷ buổi tập đã hoàn thành');
      }

      if (
        current.status !== BookingStatus.BOOKED ||
        current.attendance !== AttendanceStatus.PENDING
      ) {
        throw new ConflictException(
          'Đặt lịch đã được xử lý. Vui lòng tải lại.',
        );
      }

      const now = new Date();
      if (!isStaffOrAdmin && !isTrainer) {
        // 6-hour policy for member self-cancellation
        const cutoff = new Date(
          current.startsAt.getTime() - 6 * 60 * 60 * 1000,
        );
        if (now.getTime() > cutoff.getTime()) {
          throw new BadRequestException(
            'Quy định huỷ lịch: Hội viên chỉ được huỷ trước giờ tập ít nhất 6 tiếng (Cancellation allowed up to 6 hours before session start)',
          );
        }
      }

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

      const ledgerIdempotencyKey =
        callerIdempotencyKey ?? `pt-booking:cancel:${bookingId}`;

      const { quotaTransactionId } =
        await this.ptCredits.settleBookingCreditInTx(tx, {
          booking: current,
          settlement: 'REFUND',
          idempotencyKey: ledgerIdempotencyKey,
          actorId: user.id,
          reason: 'Huỷ lịch tập PT 1-1, hoàn lại quota giữ chỗ',
        });

      const detail = this.mapBookingDetail(
        updated as unknown as RawPtBookingWithRelations,
      );

      await this.ptCredits.saveIdempotentMutationAudit(tx, {
        quotaTransactionId,
        idempotencyKey: ledgerIdempotencyKey,
        operation: 'CANCEL_PT_BOOKING',
        actorId: user.id,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
  }

  async completeBooking(
    bookingId: string,
    user: AuthUser,
    dto?: PtBookingActionDto,
    internalOperation:
      'COMPLETE_PT_BOOKING' | 'MARK_PT_ATTENDANCE' = 'COMPLETE_PT_BOOKING',
    extraPayload?: Record<string, unknown>,
  ): Promise<PtBookingDetail> {
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        trainer: true,
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(
        `Lịch tập PT với ID "${bookingId}" không tồn tại`,
      );
    }

    const isTrainer = booking.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.STAFF);

    if (!isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách hoặc Nhân viên mới có quyền xác nhận hoàn thành buổi tập',
      );
    }

    const callerIdempotencyKey = dto?.idempotencyKey?.trim() || undefined;
    const requestPayload = {
      bookingId,
      actorId: user.id,
      ...(extraPayload ?? {}),
    };

    return this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockScheduleWrites(tx);

      if (callerIdempotencyKey) {
        const replay =
          await this.ptCredits.findIdempotentReplay<PtBookingDetail>(
            tx,
            callerIdempotencyKey,
            internalOperation,
            requestPayload,
          );
        if (replay) {
          return replay.snapshot;
        }
      }

      await this.ptCredits.lockMemberPtDomain(tx, booking.memberId);

      const current = await tx.ptBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });

      if (current.status === BookingStatus.CANCELLED) {
        throw new ConflictException('Không thể hoàn thành buổi tập đã bị huỷ');
      }

      if (
        current.status === BookingStatus.COMPLETED ||
        current.attendance === AttendanceStatus.PRESENT
      ) {
        throw new ConflictException(
          'Buổi tập này đã được xác nhận hoàn thành trước đó',
        );
      }

      if (
        current.status !== BookingStatus.BOOKED ||
        current.attendance !== AttendanceStatus.PENDING
      ) {
        throw new ConflictException(
          'Đặt lịch đã được xử lý. Vui lòng tải lại.',
        );
      }

      const now = new Date();
      assertAttendanceTime(current.startsAt, current.endsAt, false);
      await this.ptCredits.assertPtBookingAttendanceAccessInTx(
        tx,
        current,
        now,
      );

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

      const ledgerIdempotencyKey =
        callerIdempotencyKey ?? `pt-booking:complete:${bookingId}`;

      const { quotaTransactionId } =
        await this.ptCredits.settleBookingCreditInTx(tx, {
          booking: current,
          settlement: 'USE',
          idempotencyKey: ledgerIdempotencyKey,
          actorId: user.id,
          reason: 'Hoàn thành buổi tập PT 1-1, chuyển quota reserved sang used',
        });

      const detail = this.mapBookingDetail(
        updated as unknown as RawPtBookingWithRelations,
      );

      await this.ptCredits.saveIdempotentMutationAudit(tx, {
        quotaTransactionId,
        idempotencyKey: ledgerIdempotencyKey,
        operation: internalOperation,
        actorId: user.id,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
  }

  async markAttendance(
    bookingId: string,
    dto: MarkPtAttendanceDto,
    user: AuthUser,
  ): Promise<PtBookingDetail> {
    if (dto.attendance === AttendanceStatus.PRESENT) {
      return this.completeBooking(
        bookingId,
        user,
        { idempotencyKey: dto.idempotencyKey },
        'MARK_PT_ATTENDANCE',
        { attendance: AttendanceStatus.PRESENT },
      );
    }

    // Attendance is ABSENT / NO_SHOW
    const booking = await this.db.client.ptBooking.findUnique({
      where: { id: bookingId },
      include: {
        trainer: true,
        member: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(
        `Lịch tập PT với ID "${bookingId}" không tồn tại`,
      );
    }

    const isTrainer = booking.trainer.userId === user.id;
    const isStaffOrAdmin =
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.STAFF);

    if (!isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Huấn luyện viên phụ trách hoặc Nhân viên mới có quyền điểm danh vắng mặt',
      );
    }

    const normalizedOutcome =
      dto.attendance === AttendanceStatus.NO_SHOW
        ? AttendanceStatus.NO_SHOW
        : AttendanceStatus.ABSENT;
    const callerIdempotencyKey = dto.idempotencyKey?.trim() || undefined;
    const requestPayload = {
      bookingId,
      actorId: user.id,
      attendance: normalizedOutcome,
    };

    return this.db.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockScheduleWrites(tx);

      if (callerIdempotencyKey) {
        const replay =
          await this.ptCredits.findIdempotentReplay<PtBookingDetail>(
            tx,
            callerIdempotencyKey,
            'MARK_PT_ATTENDANCE',
            requestPayload,
          );
        if (replay) {
          return replay.snapshot;
        }
      }

      await this.ptCredits.lockMemberPtDomain(tx, booking.memberId);

      const current = await tx.ptBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });

      if (current.status === BookingStatus.CANCELLED) {
        throw new ConflictException('Không thể điểm danh buổi tập đã bị huỷ');
      }

      if (current.attendance !== AttendanceStatus.PENDING) {
        throw new ConflictException(
          `Buổi tập này đã được điểm danh trước đó (${current.attendance})`,
        );
      }

      if (current.status !== BookingStatus.BOOKED) {
        throw new ConflictException(
          'Đặt lịch đã được xử lý. Vui lòng tải lại.',
        );
      }

      const now = new Date();
      assertAttendanceTime(current.startsAt, current.endsAt, true);
      await this.ptCredits.assertPtBookingAttendanceAccessInTx(
        tx,
        current,
        now,
      );

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

      const ledgerIdempotencyKey =
        callerIdempotencyKey ?? `pt-booking:absent:${bookingId}`;

      const { quotaTransactionId } =
        await this.ptCredits.settleBookingCreditInTx(tx, {
          booking: current,
          settlement: 'USE',
          idempotencyKey: ledgerIdempotencyKey,
          actorId: user.id,
          reason:
            'Hội viên vắng mặt buổi tập PT 1-1 (NO_SHOW), phạt trừ lượt tập',
        });

      const detail = this.mapBookingDetail(
        updated as unknown as RawPtBookingWithRelations,
      );

      await this.ptCredits.saveIdempotentMutationAudit(tx, {
        quotaTransactionId,
        idempotencyKey: ledgerIdempotencyKey,
        operation: 'MARK_PT_ATTENDANCE',
        actorId: user.id,
        payload: requestPayload,
        resultSnapshot: detail,
      });

      return detail;
    });
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
      throw new NotFoundException(
        'Không tìm thấy thông tin nhân viên huấn luyện viên',
      );
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

  async findAll(
    query: QueryPtBookingsDto,
  ): Promise<PaginatedPtBookingsResponse> {
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
      user.roles.includes(UserRole.ADMIN) ||
      user.roles.includes(UserRole.STAFF);

    if (!isMember && !isTrainer && !isStaffOrAdmin) {
      throw new ForbiddenException(
        'Bạn không có quyền xem thông tin lịch tập này',
      );
    }

    return this.mapBookingDetail(
      booking as unknown as RawPtBookingWithRelations,
    );
  }

  private mapBookingDetail(item: RawPtBookingWithRelations): PtBookingDetail {
    const derivedCode = `MEM-${item.memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    return {
      id: item.id,
      memberId: item.memberId,
      memberCode: item.member?.memberCode || derivedCode,
      memberFullName: item.member?.fullName ?? '',
      memberPhone: item.member?.phone ?? null,
      memberIdPhotoUrl: item.member?.idPhotoUrl ?? null,
      trainerId: item.trainerId,
      trainerName: item.trainer?.fullName ?? '',
      trainerPhone: item.trainer?.phone ?? null,
      subscriptionId: item.subscriptionId,
      sourceSubscriptionId: item.sourceSubscriptionId ?? null,
      quotaId: item.quotaId ?? null,
      ptPurchaseId: item.ptPurchaseId ?? null,
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
