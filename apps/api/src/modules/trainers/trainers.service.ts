import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import { lockScheduleWrites } from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import { CreatePtAvailabilityDto } from './dto/create-pt-availability.dto';
import { QueryPtAvailabilitiesDto } from './dto/query-pt-availabilities.dto';
import type { QueryTrainersDto } from './dto/query-trainers.dto';
import {
  BookingStatus,
  ScheduleStatus,
  StaffPtSlot,
  QueryStaffPtSlotsRequest,
  PtAvailabilityDetail,
  TrainerServiceFilter,
  TrainerSummary,
  UserRole,
} from '@gym/contracts';

interface RawPtAvailabilityWithRelations {
  id: string;
  trainerId: string;
  startsAt: Date;
  endsAt: Date;
  isAvailable: boolean;
  note: string | null;
  createdAt?: Date;
  trainer?: {
    fullName: string;
  } | null;
}

@Injectable()
export class TrainersService {
  constructor(private readonly db: DatabaseService) {}

  async findAllActiveTrainers(
    query?: QueryTrainersDto,
  ): Promise<TrainerSummary[]> {
    const where: Prisma.EmployeeProfileWhereInput = {
      user: {
        isActive: true,
        roles: {
          some: {
            role: {
              code: UserRole.TRAINER,
            },
          },
        },
      },
    };

    if (query?.service === TrainerServiceFilter.CLASS) {
      where.canTeachClasses = true;
    } else if (query?.service === TrainerServiceFilter.PT) {
      where.canCoachPt = true;
    } else {
      where.canTeachClasses = true;
    }

    const trainers = await this.db.client.employeeProfile.findMany({
      where,
      orderBy: { fullName: 'asc' },
    });

    return trainers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      specialization: t.specialization ?? null,
      specialties: t.specialties ?? [],
      canTeachClasses: t.canTeachClasses,
      canCoachPt: t.canCoachPt,
    }));
  }

  async createAvailability(
    userId: string,
    dto: CreatePtAvailabilityDto,
  ): Promise<PtAvailabilityDetail> {
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException(
        'startsAt hoặc endsAt không đúng định dạng ngày giờ',
      );
    }

    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('startsAt phải nhỏ hơn endsAt');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes < 30) {
      throw new BadRequestException(
        'Khung giờ rảnh tối thiểu phải từ 30 phút trở lên',
      );
    }

    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);

      const employee = await tx.employeeProfile.findFirst({
        where: { userId },
        include: {
          user: {
            include: {
              roles: { include: { role: true } },
            },
          },
        },
      });

      if (!employee) {
        throw new NotFoundException('Không tìm thấy hồ sơ nhân viên của bạn');
      }

      if (!employee.user.isActive) {
        throw new BadRequestException(
          'Tài khoản nhân viên của bạn đang bị khoá',
        );
      }

      const hasPtRole = employee.user.roles.some(
        (r: { role: { code: string } }) => r.role.code === UserRole.TRAINER,
      );
      if (!hasPtRole) {
        throw new ForbiddenException(
          'Chỉ nhân viên có vai trò Huấn luyện viên (TRAINER) mới được đăng ký lịch rảnh',
        );
      }

      if (!employee.canCoachPt) {
        throw new ForbiddenException(
          'Tài khoản huấn luyện viên của bạn hiện không được phân quyền mở lịch dạy PT 1-1',
        );
      }

      // Check for overlapping active availability for this trainer
      const overlapping = await tx.ptAvailability.findFirst({
        where: {
          trainerId: employee.id,
          isAvailable: true,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
      });

      if (overlapping) {
        throw new ConflictException(
          'Khung giờ rảnh bị trùng lặp với một khung giờ đã đăng ký trước đó (Overlapping availability slot)',
        );
      }

      const created = await tx.ptAvailability.create({
        data: {
          trainerId: employee.id,
          startsAt: start,
          endsAt: end,
          isAvailable: true,
          note: dto.note ?? null,
        },
        include: {
          trainer: true,
        },
      });

      return this.mapAvailabilityDetail(created);
    });
  }

  async findTrainerAvailabilities(
    trainerId: string,
    query: QueryPtAvailabilitiesDto,
  ): Promise<PtAvailabilityDetail[]> {
    const where: Prisma.PtAvailabilityWhereInput = {
      trainerId,
      isAvailable: true,
      trainer: {
        canCoachPt: true,
        user: {
          isActive: true,
          roles: {
            some: {
              role: {
                code: UserRole.TRAINER,
              },
            },
          },
        },
      },
    };

    if (query.from) {
      where.endsAt = { gte: new Date(query.from) };
    }
    if (query.to) {
      where.startsAt = { lte: new Date(query.to) };
    }

    const slots = await this.db.client.ptAvailability.findMany({
      where,
      include: {
        trainer: true,
      },
      orderBy: { startsAt: 'asc' },
    });

    return slots.map((s: RawPtAvailabilityWithRelations) =>
      this.mapAvailabilityDetail(s),
    );
  }

  async findStaffPtSlots(
    trainerId: string,
    query: QueryStaffPtSlotsRequest,
  ): Promise<StaffPtSlot[]> {
    const dayStart = new Date(query.date + 'T00:00:00+07:00');
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    if (
      !Number.isFinite(dayStart.getTime()) ||
      new Date(dayStart.getTime() + 7 * 3600000).toISOString().slice(0, 10) !==
        query.date
    ) {
      throw new BadRequestException('Ngày đặt lịch không hợp lệ.');
    }
    const member = await this.db.client.memberProfile.findUnique({
      where: { id: query.memberId },
      select: { user: { select: { isActive: true } } },
    });
    if (!member) throw new NotFoundException('Không tìm thấy hội viên.');
    if (!member.user.isActive)
      throw new BadRequestException('Tài khoản hội viên đã bị khóa.');
    const overlap = { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } };
    const [windows, ptBookings, classes, memberClasses] = await Promise.all([
      this.findTrainerAvailabilities(trainerId, {
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
        service: TrainerServiceFilter.PT,
      }),
      this.db.client.ptBooking.findMany({
        where: {
          ...overlap,
          status: BookingStatus.BOOKED,
          OR: [{ trainerId }, { memberId: query.memberId }],
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.db.client.classSchedule.findMany({
        where: { ...overlap, trainerId, status: ScheduleStatus.SCHEDULED },
        select: { startsAt: true, endsAt: true },
      }),
      this.db.client.classBooking.findMany({
        where: {
          memberId: query.memberId,
          status: BookingStatus.BOOKED,
          schedule: { ...overlap, status: ScheduleStatus.SCHEDULED },
        },
        select: { schedule: { select: { startsAt: true, endsAt: true } } },
      }),
    ]);
    const occupied = [
      ...ptBookings,
      ...classes,
      ...memberClasses.map((item) => item.schedule),
    ];
    const now = Date.now();
    const slots = new Map<number, StaffPtSlot>();
    // Offer 60-minute sessions every 30 minutes inside the trainer's registered window.
    // This is a preview: createBooking rechecks conflicts and entitlement under its transaction lock.
    for (const window of windows) {
      const origin = new Date(window.startsAt).getTime();
      const lower = Math.max(dayStart.getTime(), now);
      const first =
        origin + Math.max(0, Math.ceil((lower - origin) / 1800000)) * 1800000;
      const upper = Math.min(
        dayEnd.getTime(),
        new Date(window.endsAt).getTime(),
      );
      for (let start = first; start + 3600000 <= upper; start += 1800000) {
        const end = start + 3600000;
        if (
          start <= now ||
          occupied.some(
            (item) =>
              item.startsAt.getTime() < end && item.endsAt.getTime() > start,
          )
        )
          continue;
        slots.set(start, {
          availabilityId: window.id,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
        });
      }
    }
    return [...slots.values()].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
  }

  async deleteAvailability(
    userId: string,
    userRoles: string[],
    availabilityId: string,
  ): Promise<{ message: string }> {
    return this.db.client.$transaction(async (tx) => {
      await lockScheduleWrites(tx);

      const slot = await tx.ptAvailability.findUnique({
        where: { id: availabilityId },
        include: { trainer: true },
      });

      if (!slot) {
        throw new NotFoundException('Không tìm thấy khung giờ rảnh');
      }

      const isAdmin = userRoles.includes(UserRole.ADMIN);
      const isOwner = slot.trainer.userId === userId;

      if (!isAdmin && !isOwner) {
        throw new ForbiddenException(
          'Bạn không có quyền xoá khung giờ rảnh của huấn luyện viên khác',
        );
      }

      // Check if there is an active booking on this availability
      const activeBooking = await tx.ptBooking.findFirst({
        where: {
          availabilityId,
          status: BookingStatus.BOOKED,
        },
      });

      if (activeBooking) {
        throw new ConflictException(
          'Không thể xoá khung giờ rảnh đã có học viên đặt lịch (Cannot delete availability slot with active booking)',
        );
      }

      // Check if there are overlapping active bookings for this trainer in this timeframe
      const overlappingBooking = await tx.ptBooking.findFirst({
        where: {
          trainerId: slot.trainerId,
          status: BookingStatus.BOOKED,
          startsAt: { lt: slot.endsAt },
          endsAt: { gt: slot.startsAt },
        },
      });

      if (overlappingBooking) {
        throw new ConflictException(
          'Không thể xoá khung giờ rảnh có lịch hẹn đang hoạt động',
        );
      }

      // Disconnect historical non-active bookings before deleting slot
      await tx.ptBooking.updateMany({
        where: { availabilityId },
        data: { availabilityId: null },
      });

      await tx.ptAvailability.delete({
        where: { id: availabilityId },
      });

      return { message: 'Xoá khung giờ rảnh thành công' };
    });
  }

  private mapAvailabilityDetail(
    item: RawPtAvailabilityWithRelations,
  ): PtAvailabilityDetail {
    return {
      id: item.id,
      trainerId: item.trainerId,
      trainerName: item.trainer?.fullName ?? undefined,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      isAvailable: item.isAvailable,
      note: item.note ?? null,
      createdAt: item.createdAt ? item.createdAt.toISOString() : undefined,
    };
  }
}
