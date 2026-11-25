import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  ClassScheduleBookingSummary,
  ClassScheduleDetail,
  PaginatedClassSchedulesResponse,
  QuotaTransactionType,
  ScheduleStatus,
  UserRole,
} from '@gym/contracts';
import type { Prisma } from '@gym/database';
import { lockScheduleWrites } from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';
import { CancelClassScheduleDto } from './dto/cancel-class-schedule.dto';
import { QueryClassSchedulesDto } from './dto/query-class-schedules.dto';

interface RawScheduleWithRelations {
  id: string;
  classId: string;
  trainerId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: string;
  gymClass: {
    id: string;
    name: string;
    description: string | null;
  };
  trainer: {
    id: string;
    fullName: string;
    phone: string | null;
  };
  _count?: {
    bookings: number;
  };
  bookings?: Array<{
    id: string;
    memberId: string;
    status: string;
    attendance: string;
    createdAt: Date;
    member: {
      id: string;
      fullName: string;
    };
  }>;
}

@Injectable()
export class ClassSchedulesService {
  private readonly logger = new Logger(ClassSchedulesService.name);

  constructor(private readonly db: DatabaseService) {}

  async createSchedule(
    dto: CreateClassScheduleDto,
    actorId: string,
  ): Promise<ClassScheduleDetail> {
    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      const start = new Date(dto.startsAt);
      const end = new Date(dto.endsAt);

      this.validateTiming(start, end);

      // 1. Validate Gym Class existence and active status
      const gymClass = await tx.gymClass.findUnique({
        where: { id: dto.classId },
      });
      if (!gymClass) {
        throw new NotFoundException(
          `Gym class with ID "${dto.classId}" not found`,
        );
      }
      if (!gymClass.isActive) {
        throw new ConflictException(
          'Không thể lên lịch cho bộ môn đang tạm dừng hoạt động (Cannot schedule for inactive class)',
        );
      }

      // 2. Validate Trainer existence, TRAINER role, and class teaching capability
      await this.validateTrainer(dto.trainerId, tx);

      // 3. Trainer Conflict Prevention
      await this.assertNoTrainerConflicts(
        dto.trainerId,
        start,
        end,
        undefined,
        tx,
      );

      // 4. Create ClassSchedule
      const created = await tx.classSchedule.create({
        data: {
          classId: dto.classId,
          trainerId: dto.trainerId,
          startsAt: start,
          endsAt: end,
          capacity: dto.capacity,
          status: ScheduleStatus.SCHEDULED,
        },
        include: {
          gymClass: true,
          trainer: true,
          _count: {
            select: { bookings: { where: { status: BookingStatus.BOOKED } } },
          },
        },
      });

      this.logger.log(
        `Created class schedule: Class ${gymClass.name} with Trainer ${created.trainer.fullName} at ${start.toISOString()} by actor ${actorId}`,
      );

      return this.mapScheduleDetail(
        created as unknown as RawScheduleWithRelations,
      );
    });
  }

  async findAll(
    query: QueryClassSchedulesDto,
  ): Promise<PaginatedClassSchedulesResponse> {
    const skip = (query.page - 1) * query.limit;

    const where: {
      classId?: string;
      trainerId?: string;
      status?: ScheduleStatus;
      startsAt?: { gte?: Date; lte?: Date };
    } = {};

    if (query.classId) where.classId = query.classId;
    if (query.trainerId) where.trainerId = query.trainerId;
    if (query.status) where.status = query.status;

    if (query.from || query.to) {
      where.startsAt = {};
      if (query.from) where.startsAt.gte = new Date(query.from);
      if (query.to) where.startsAt.lte = new Date(query.to);
    }

    const [total, items] = await Promise.all([
      this.db.client.classSchedule.count({ where }),
      this.db.client.classSchedule.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { startsAt: query.sortOrder },
        include: {
          gymClass: true,
          trainer: true,
          _count: {
            select: { bookings: { where: { status: BookingStatus.BOOKED } } },
          },
        },
      }),
    ]);

    return {
      data: items.map((item) =>
        this.mapScheduleDetail(item as unknown as RawScheduleWithRelations),
      ),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async findById(
    id: string,
    actor?: { id: string; roles: UserRole[] },
  ): Promise<ClassScheduleDetail> {
    const schedule = await this.db.client.classSchedule.findUnique({
      where: { id },
      include: {
        gymClass: true,
        trainer: {
          include: { user: true },
        },
        _count: {
          select: { bookings: { where: { status: BookingStatus.BOOKED } } },
        },
        bookings: {
          include: {
            member: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Class schedule with ID "${id}" not found`);
    }

    const canViewBookings =
      actor &&
      (actor.roles.includes(UserRole.ADMIN) ||
        actor.roles.includes(UserRole.STAFF) ||
        schedule.trainer.userId === actor.id);

    return this.mapScheduleDetail(
      schedule as unknown as RawScheduleWithRelations,
      canViewBookings,
    );
  }

  async updateSchedule(
    id: string,
    dto: UpdateClassScheduleDto,
    actorId: string,
  ): Promise<ClassScheduleDetail> {
    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      const existing = await tx.classSchedule.findUnique({
        where: { id },
        include: {
          _count: {
            select: { bookings: { where: { status: BookingStatus.BOOKED } } },
          },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Class schedule with ID "${id}" not found`);
      }

      if (
        existing.status === ScheduleStatus.CANCELLED ||
        existing.status === ScheduleStatus.COMPLETED
      ) {
        throw new ConflictException(
          `Cannot update a ${existing.status.toLowerCase()} class schedule`,
        );
      }

      // Capacity validation
      if (dto.capacity !== undefined) {
        const currentBooked = existing._count.bookings;
        if (dto.capacity < currentBooked) {
          throw new ConflictException(
            `Không thể giảm sức chứa xuống ${dto.capacity} vì đã có ${currentBooked} học viên đặt chỗ`,
          );
        }
      }

      const newStart = dto.startsAt
        ? new Date(dto.startsAt)
        : existing.startsAt;
      const newEnd = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
      const newTrainerId = dto.trainerId ?? existing.trainerId;

      if (dto.startsAt || dto.endsAt) {
        this.validateTiming(newStart, newEnd);
      }

      if (dto.trainerId && dto.trainerId !== existing.trainerId) {
        await this.validateTrainer(dto.trainerId, tx);
      }

      if (dto.startsAt || dto.endsAt || dto.trainerId) {
        await this.assertNoTrainerConflicts(
          newTrainerId,
          newStart,
          newEnd,
          id,
          tx,
        );
      }

      if (dto.startsAt || dto.endsAt) {
        const bookings = await tx.classBooking.findMany({
          where: { scheduleId: id, status: BookingStatus.BOOKED },
          include: { subscription: true },
        });
        const memberIds = bookings.map((booking) => booking.memberId);
        const subscriptionIds = bookings.map(
          (booking) => booking.subscriptionId,
        );
        const [classConflict, freeze] = await Promise.all([
          tx.classBooking.findFirst({
            where: {
              memberId: { in: memberIds },
              scheduleId: { not: id },
              status: BookingStatus.BOOKED,
              schedule: { startsAt: { lt: newEnd }, endsAt: { gt: newStart } },
            },
          }),
          tx.subscriptionFreeze.findFirst({
            where: {
              subscriptionId: { in: subscriptionIds },
              status: 'APPROVED',
              restoredAt: null,
              startsAt: { lt: newEnd },
              endsAt: { gt: newStart },
            },
          }),
        ]);
        if (
          classConflict ||
          freeze ||
          bookings.some(
            (booking) =>
              booking.subscription.startDate > newStart ||
              booking.subscription.endDate < newEnd,
          )
        ) {
          throw new ConflictException(
            'Lịch mới xung đột hoặc nằm ngoài quyền tham gia của học viên đã đặt chỗ.',
          );
        }
      }
      const updated = await tx.classSchedule.update({
        where: { id },
        data: {
          trainerId: dto.trainerId,
          startsAt: dto.startsAt ? newStart : undefined,
          endsAt: dto.endsAt ? newEnd : undefined,
          capacity: dto.capacity,
        },
        include: {
          gymClass: true,
          trainer: true,
          _count: {
            select: { bookings: { where: { status: BookingStatus.BOOKED } } },
          },
        },
      });

      this.logger.log(
        `Updated class schedule ${id} by actor ${actorId}: Trainer=${newTrainerId}, Start=${newStart.toISOString()}, End=${newEnd.toISOString()}, Capacity=${updated.capacity}`,
      );

      return this.mapScheduleDetail(
        updated as unknown as RawScheduleWithRelations,
      );
    });
  }

  async cancelSchedule(
    id: string,
    dto: CancelClassScheduleDto,
    actorId: string,
  ): Promise<ClassScheduleDetail> {
    const existing = await this.db.client.classSchedule.findUnique({
      where: { id },
      include: {
        gymClass: true,
        trainer: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Class schedule with ID "${id}" not found`);
    }

    if (existing.status === ScheduleStatus.CANCELLED) {
      throw new ConflictException(
        'Ca dạy này đã được huỷ trước đó (Schedule already cancelled)',
      );
    }

    if (existing.status === ScheduleStatus.COMPLETED) {
      throw new ConflictException(
        'Không thể huỷ ca dạy đã hoàn thành (Cannot cancel completed schedule)',
      );
    }

    const now = new Date();

    const cancelled = await this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);
      const current = await tx.classSchedule.findUniqueOrThrow({
        where: { id },
      });
      if (current.status !== ScheduleStatus.SCHEDULED)
        throw new ConflictException('Ca học đã được xử lý.');
      // 1. Mark schedule as CANCELLED
      const schedule = await tx.classSchedule.update({
        where: { id },
        data: { status: ScheduleStatus.CANCELLED },
        include: {
          gymClass: true,
          trainer: true,
          _count: {
            select: { bookings: { where: { status: BookingStatus.BOOKED } } },
          },
        },
      });

      // 2. Cascade cancel all BOOKED bookings and refund quota reserved
      const activeBookings = await tx.classBooking.findMany({
        where: {
          scheduleId: id,
          status: BookingStatus.BOOKED,
        },
      });

      for (const booking of activeBookings) {
        await tx.classBooking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
          },
        });

        const quota = await tx.subscriptionQuota.findUniqueOrThrow({
          where: { id: booking.quotaId },
        });
        if (quota.allocated !== null)
          await tx.subscriptionQuota.update({
            where: { id: booking.quotaId },
            data: { reserved: { decrement: 1 } },
          });

        await tx.quotaTransaction.create({
          data: {
            quotaId: booking.quotaId,
            subscriptionId: booking.subscriptionId,
            type: QuotaTransactionType.REFUND,
            reservedDelta: quota.allocated === null ? 0 : -1,
            idempotencyKey: `cancel-schedule-${id}-booking-${booking.id}`,
            reason:
              dto.reason ||
              'Ca học bị huỷ bởi trung tâm (Class schedule cancelled by gym)',
            createdBy: actorId,
          },
        });
      }

      return schedule;
    });

    this.logger.warn(
      `Cancelled class schedule ${id} (${existing.gymClass.name}) by actor ${actorId}. Reason: ${dto.reason || 'None provided'}`,
    );

    return this.mapScheduleDetail(
      cancelled as unknown as RawScheduleWithRelations,
    );
  }

  // --- Helpers ---

  private validateTiming(start: Date, end: Date): void {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException(
        'Invalid date format for startsAt or endsAt',
      );
    }

    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException(
        'startsAt must be strictly earlier than endsAt',
      );
    }

    const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (diffMinutes < 30 || diffMinutes > 180) {
      throw new BadRequestException(
        `Class schedule duration must be between 30 and 180 minutes (got ${Math.round(diffMinutes)} minutes)`,
      );
    }
  }

  private async validateTrainer(
    trainerId: string,
    client: Prisma.TransactionClient = this.db.client,
  ): Promise<void> {
    const employee = await client.employeeProfile.findUnique({
      where: { id: trainerId },
      include: {
        user: {
          include: {
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Trainer with ID "${trainerId}" not found`);
    }

    if (!employee.user.isActive) {
      throw new BadRequestException(
        'Trainer user account is inactive or disabled',
      );
    }

    const hasPtRole = employee.user.roles.some(
      (r) => r.role.code === UserRole.TRAINER,
    );
    if (!hasPtRole) {
      throw new BadRequestException(
        `Nhân viên "${employee.fullName}" không có chuyên môn/vai trò Huấn luyện viên (TRAINER role required)`,
      );
    }

    if (!employee.canTeachClasses) {
      throw new BadRequestException(
        `Huấn luyện viên "${employee.fullName}" hiện không nhận lịch dạy lớp nhóm mới`,
      );
    }
  }

  private async assertNoTrainerConflicts(
    trainerId: string,
    start: Date,
    end: Date,
    excludeScheduleId?: string,
    client: Prisma.TransactionClient = this.db.client,
  ): Promise<void> {
    // 1. Check overlapping active ClassSchedule
    const classConflict = await client.classSchedule.findFirst({
      where: {
        trainerId,
        status: ScheduleStatus.SCHEDULED,
        id: excludeScheduleId ? { not: excludeScheduleId } : undefined,
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      include: { gymClass: true },
    });

    if (classConflict) {
      throw new ConflictException(
        `Huấn luyện viên đã có lịch dạy lớp "${classConflict.gymClass.name}" vào khung giờ này (Trainer conflict with existing class schedule)`,
      );
    }

    // Retired PT records remain historical and do not block group classes.
  }

  private mapScheduleDetail(
    item: RawScheduleWithRelations,
    includeBookings: boolean = false,
  ): ClassScheduleDetail {
    const bookedCount = item._count?.bookings ?? 0;
    const remainingSlots = Math.max(0, item.capacity - bookedCount);

    let bookings: ClassScheduleBookingSummary[] | undefined = undefined;
    if (includeBookings && item.bookings) {
      bookings = item.bookings.map((b) => ({
        id: b.id,
        memberId: b.memberId,
        memberCode: `MEM-${b.member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        memberFullName: b.member.fullName,
        status: b.status,
        attendance: b.attendance,
        createdAt: b.createdAt.toISOString(),
      }));
    }

    return {
      id: item.id,
      classId: item.classId,
      className: item.gymClass?.name ?? '',
      classDescription: item.gymClass?.description ?? null,
      trainerId: item.trainerId,
      trainerName: item.trainer?.fullName ?? '',
      trainerPhone: item.trainer?.phone ?? null,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      capacity: item.capacity,
      bookedCount,
      remainingSlots,
      status: item.status as ScheduleStatus,
      bookings,
    };
  }
}
