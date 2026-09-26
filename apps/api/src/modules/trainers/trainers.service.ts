import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import { DatabaseService } from '../database/database.module';
import { CreatePtAvailabilityDto } from './dto/create-pt-availability.dto';
import { QueryPtAvailabilitiesDto } from './dto/query-pt-availabilities.dto';
import {
  BookingStatus,
  PtAvailabilityDetail,
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

  async createAvailability(
    userId: string,
    dto: CreatePtAvailabilityDto,
  ): Promise<PtAvailabilityDetail> {
    const employee = await this.db.client.employeeProfile.findFirst({
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
      throw new BadRequestException('Tài khoản nhân viên của bạn đang bị khoá');
    }

    const hasPtRole = employee.user.roles.some(
      (r: { role: { code: string } }) => r.role.code === UserRole.PT,
    );
    if (!hasPtRole) {
      throw new ForbiddenException(
        'Chỉ nhân viên có vai trò PT mới được đăng ký lịch rảnh',
      );
    }

    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('startsAt hoặc endsAt không đúng định dạng ngày giờ');
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

    // Check for overlapping active availability for this trainer
    const overlapping = await this.db.client.ptAvailability.findFirst({
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

    const created = await this.db.client.ptAvailability.create({
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
  }

  async findTrainerAvailabilities(
    trainerId: string,
    query: QueryPtAvailabilitiesDto,
  ): Promise<PtAvailabilityDetail[]> {
    const where: Prisma.PtAvailabilityWhereInput = {
      trainerId,
      isAvailable: true,
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

    return slots.map((s: RawPtAvailabilityWithRelations) => this.mapAvailabilityDetail(s));
  }

  async deleteAvailability(
    userId: string,
    userRoles: string[],
    availabilityId: string,
  ): Promise<{ message: string }> {
    const slot = await this.db.client.ptAvailability.findUnique({
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
    const activeBooking = await this.db.client.ptBooking.findFirst({
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
    const overlappingBooking = await this.db.client.ptBooking.findFirst({
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
    await this.db.client.ptBooking.updateMany({
      where: { availabilityId },
      data: { availabilityId: null },
    });

    await this.db.client.ptAvailability.delete({
      where: { id: availabilityId },
    });

    return { message: 'Xoá khung giờ rảnh thành công' };
  }

  private mapAvailabilityDetail(item: RawPtAvailabilityWithRelations): PtAvailabilityDetail {
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
