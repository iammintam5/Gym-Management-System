import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@gym/database';
import {
  UserRole,
  SubscriptionStatus,
  PaymentStatus,
  evaluateGymCoverageForSlot,
  type AuthUser,
  type PtAssignmentDetail,
  type AssignedPtSlot,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { TrainersService } from '../trainers/trainers.service';
import { lockScheduleWrites } from '../common/booking-access';
import {
  AssignPtTrainerDto,
  AssignedPtSlotsQueryDto,
  AssignedMembersQueryDto,
} from './assignment.dto';

const include = {
  previousSubscription: {
    include: {
      assignedTrainer: {
        include: { user: { include: { roles: { include: { role: true } } } } },
      },
    },
  },
  assignedTrainer: {
    include: { user: { include: { roles: { include: { role: true } } } } },
  },
  member: { include: { user: true } },
  plan: true,
  freezes: true,
} satisfies Prisma.SubscriptionInclude;
type Row = Prisma.SubscriptionGetPayload<{ include: typeof include }>;
function available(trainer: Row['assignedTrainer']) {
  return (
    !!trainer?.canCoachPt &&
    trainer.user.isActive &&
    trainer.user.roles.some((item) => item.role.code === UserRole.TRAINER)
  );
}
function map(row: Row): PtAssignmentDetail {
  const previous = row.previousSubscription?.assignedTrainer;
  const suggested =
    !row.assignedTrainer && previous && available(previous) ? previous : null;
  return {
    suggestedTrainer: suggested
      ? { id: suggested.id, fullName: suggested.fullName }
      : null,
    subscriptionId: row.id,
    memberId: row.memberId,
    memberName: row.member.fullName,
    memberCode:
      'MEM-' + row.memberId.replace(/-/g, '').slice(0, 8).toUpperCase(),
    planName: row.plan.name,
    startsAt: row.startDate.toISOString(),
    endsAt: row.endDate.toISOString(),
    status: row.status as SubscriptionStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    trainer: row.assignedTrainer
      ? { id: row.assignedTrainer.id, fullName: row.assignedTrainer.fullName }
      : null,
    trainerAvailable: available(row.assignedTrainer),
    version: row.ptAssignmentVersion,
  };
}

@Injectable()
export class PtAssignmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly trainers: TrainersService,
  ) {}

  async memberId(user: AuthUser, requested?: string): Promise<string> {
    if (
      user.roles.some(
        (role) => role === UserRole.STAFF || role === UserRole.ADMIN,
      )
    ) {
      if (!requested) throw new BadRequestException('Vui lòng chọn hội viên.');
      return requested;
    }
    const member = await this.db.client.memberProfile.findUnique({
      where: { userId: user.id },
    });
    if (!member || (requested && requested !== member.id))
      throw new ForbiddenException(
        'Không có quyền xem lịch của hội viên khác.',
      );
    return member.id;
  }

  async list(memberId: string): Promise<PtAssignmentDetail[]> {
    const rows = await this.db.client.subscription.findMany({
      where: {
        memberId,
        status: { not: 'CANCELLED' },
        endDate: { gt: new Date() },
      },
      include,
      orderBy: { startDate: 'asc' },
    });
    return rows.map(map);
  }

  async trainerMembers(user: AuthUser, query: AssignedMembersQueryDto) {
    const trainer = await this.db.client.employeeProfile.findUnique({
      where: { userId: user.id },
    });
    if (!trainer) throw new NotFoundException('Không tìm thấy hồ sơ HLV.');
    const where: Prisma.SubscriptionWhereInput = {
      assignedTrainerId: trainer.id,
      status: { not: 'CANCELLED' },
      endDate: { gt: new Date() },
    };
    const [rows, total] = await Promise.all([
      this.db.client.subscription.findMany({
        where,
        include,
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.client.subscription.count({ where }),
    ]);
    return {
      data: rows.map(map),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async assign(
    id: string,
    dto: AssignPtTrainerDto,
    user: AuthUser,
  ): Promise<PtAssignmentDetail> {
    return this.db.client.$transaction(async (tx) => {
      // Same lock order as booking/renewal. Assignment and a competing booking cannot cross.
      await lockScheduleWrites(tx);
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.subscription.findUnique({
        where: { id },
        include,
      });
      if (!current) throw new NotFoundException('Không tìm thấy gói Gym.');
      if (current.status === 'CANCELLED' || current.endDate <= new Date())
        throw new ConflictException('Gói Gym đã kết thúc hoặc bị hủy.');
      if (!current.member.user.isActive)
        throw new ConflictException('Tài khoản hội viên đã bị khóa.');
      if (current.assignedTrainerId === dto.trainerId) return map(current);
      if (current.ptAssignmentVersion !== dto.expectedVersion)
        throw new ConflictException(
          'Phân công đã thay đổi. Vui lòng tải lại hồ sơ.',
        );
      if (current.assignedTrainerId && !user.roles.includes(UserRole.ADMIN))
        throw new ForbiddenException('Chỉ Admin được đổi PT đã phân.');
      if (current.assignedTrainerId && !dto.reason?.trim())
        throw new BadRequestException('Vui lòng nhập lý do đổi PT.');
      const trainer = await tx.employeeProfile.findUnique({
        where: { id: dto.trainerId },
        include: { user: { include: { roles: { include: { role: true } } } } },
      });
      if (!available(trainer))
        throw new ConflictException('HLV không còn đủ điều kiện nhận PT.');
      const pending = await tx.ptBooking.count({
        where: {
          subscriptionId: id,
          status: 'BOOKED',
          trainerId: { not: dto.trainerId },
        },
      });
      if (pending)
        throw new ConflictException(
          `Còn ${pending} lịch PT chưa xử lý với HLV khác. Vui lòng xử lý các lịch đó trước khi đổi phân công.`,
        );
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          assignedTrainerId: dto.trainerId,
          ptAssignmentVersion: { increment: 1 },
        },
        include,
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'SUBSCRIPTION_PT_ASSIGNED',
          entityType: 'SUBSCRIPTION',
          entityId: id,
          metadata: {
            previousTrainerId: current.assignedTrainerId,
            trainerId: dto.trainerId,
            version: updated.ptAssignmentVersion,
            reason: dto.reason?.trim() ?? 'Phân PT phụ trách gói Gym',
          },
        },
      });
      return map(updated);
    });
  }

  async slots(
    user: AuthUser,
    query: AssignedPtSlotsQueryDto,
  ): Promise<AssignedPtSlot[]> {
    const memberId = await this.memberId(user, query.memberId);
    const lower = new Date(query.date + 'T00:00:00+07:00');
    if (
      !Number.isFinite(lower.getTime()) ||
      new Date(lower.getTime() + 7 * 3600000).toISOString().slice(0, 10) !==
        query.date
    )
      throw new BadRequestException('Ngày tập không hợp lệ.');
    const upper = new Date(lower.getTime() + 86400000);
    const rows = await this.db.client.subscription.findMany({
      where: {
        memberId,
        startDate: { lt: upper },
        endDate: { gt: lower },
        status: { in: ['ACTIVE', 'UPCOMING', 'SUSPENDED'] },
        paymentStatus: 'PAID',
      },
      include,
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    const all: AssignedPtSlot[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (
        !available(row.assignedTrainer) ||
        !row.assignedTrainer ||
        !row.member.user.isActive
      )
        continue;
      const slots = await this.trainers.findStaffPtSlots(
        row.assignedTrainer.id,
        { memberId, date: query.date },
      );
      for (const slot of slots) {
        // Match the same canonical Gym coverage choice as the booking transaction.
        const coverage = evaluateGymCoverageForSlot(
          rows.map((item) => ({
            id: item.id,
            memberId,
            status: item.status as SubscriptionStatus,
            paymentStatus: item.paymentStatus as PaymentStatus,
            startDate: item.startDate,
            endDate: item.endDate,
            freezes: item.freezes,
          })),
          slot.startsAt,
          slot.endsAt,
          { memberIsActive: true, referenceNow: new Date() },
        );
        if (
          coverage.coveringSubscriptionId !== row.id ||
          !coverage.covered ||
          seen.has(slot.startsAt)
        )
          continue;
        seen.add(slot.startsAt);
        all.push({
          ...slot,
          subscriptionId: row.id,
          trainerId: row.assignedTrainer.id,
          trainerName: row.assignedTrainer.fullName,
        });
      }
    }
    return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
}
