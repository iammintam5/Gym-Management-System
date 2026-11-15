import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@gym/database';
import type { MemberDirectoryResponse } from '@gym/contracts';
import { memberCodeRange } from '../common/member-code';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FaceEnrollmentService } from '../face-recognition/face-enrollment.service';
import {
  Gender,
  UserRole,
  type MemberDetail,
  type PaginatedMembersResponse,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import type { CreateMemberDto } from './dto/create-member.dto';
import type { UpdateMemberDto } from './dto/update-member.dto';
import type { UpdateMemberSelfDto } from './dto/update-member-self.dto';
import type { QueryMembersDto } from './dto/query-members.dto';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly faces: FaceEnrollmentService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private mapMemberDetail(profile: {
    id: string;
    userId: string;
    fullName: string;
    phone: string | null;
    gender?: string | null;
    dateOfBirth: Date | null;
    idPhotoUrl?: string | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
      email: string;
      isActive: boolean;
      roles: Array<{ role: { code: string } }>;
    };
  }): MemberDetail {
    return {
      id: profile.id,
      userId: profile.userId,
      memberCode: `MEM-${profile.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      fullName: profile.fullName,
      phone: profile.phone ?? null,
      gender: profile.gender ? (profile.gender as Gender) : null,
      dateOfBirth: profile.dateOfBirth
        ? profile.dateOfBirth.toISOString().split('T')[0]
        : null,
      idPhotoUrl: profile.idPhotoUrl ?? null,
      email: profile.user.email,
      isActive: profile.user.isActive,
      roles: profile.user.roles.map((r) => r.role.code as UserRole),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private async auditFaceRejection(
    error: unknown,
    actorId?: string,
    memberId?: string,
  ): Promise<void> {
    if (!(error instanceof ConflictException)) return;
    const response = error.getResponse();
    if (
      typeof response !== 'object' ||
      !('code' in response) ||
      response.code !== 'DUPLICATE_MEMBER_FACE'
    )
      return;
    const conflicts =
      'conflicts' in response && Array.isArray(response.conflicts)
        ? (response.conflicts as Array<{ memberId: string }>)
        : [];
    try {
      await this.db.client.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: 'MEMBER_PHOTO_REJECTED',
          entityType: 'MEMBER_PHOTO',
          entityId: memberId ?? null,
          metadata: {
            reason: 'DUPLICATE_MEMBER_FACE',
            modelVersion: this.faces.recognizer.modelVersion,
            conflictingMemberIds: conflicts.map((item) => item.memberId),
          },
        },
      });
    } catch {
      this.logger.error('Could not record rejected member photo attempt');
    }
  }

  private handlePrismaError(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: string }).code;
      if (
        code === 'P2021' ||
        (code === 'P2010' &&
          'meta' in error &&
          (error as { meta?: { code?: string } }).meta?.code === '42P01')
      ) {
        throw new ServiceUnavailableException(
          'Dữ liệu nhận diện chưa sẵn sàng. Nhờ quản trị viên kiểm tra cập nhật hệ thống.',
        );
      }
      if (code === 'P2002') {
        const meta = (error as { meta?: { target?: string[] } }).meta;
        const target = meta?.target?.join(', ') ?? '';
        if (target.includes('email')) {
          throw new ConflictException('Email already in use');
        }
        if (target.includes('phone')) {
          throw new ConflictException('Phone number already in use');
        }
        if (target.includes('user_id')) {
          throw new ConflictException(
            'Member profile already exists for this user',
          );
        }
        throw new ConflictException('A unique constraint was violated');
      }
    }
    throw error;
  }

  async create(dto: CreateMemberDto, actorId?: string): Promise<MemberDetail> {
    const face = dto.idPhotoUrl
      ? await this.faces.recognizer.prepare(dto.idPhotoUrl)
      : null;
    const normalizedPhoto = face?.photo ?? null;
    const email = dto.email.trim().toLowerCase();

    // Check existing user email
    const existingUser = await this.db.client.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Hash password
    const rawPassword = dto.password?.trim() || 'Member@123456';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // Retrieve MEMBER role
    const memberRole = await this.db.client.role.findUnique({
      where: { code: UserRole.MEMBER },
    });
    if (!memberRole) {
      throw new BadRequestException(
        'MEMBER role is not initialized in database',
      );
    }

    try {
      const createdProfile = await this.db.client.$transaction(async (tx) => {
        if (face) {
          await this.faces.lock(tx);
          await this.faces.assertUnique(tx, face);
        }
        // 1. Create User
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            isActive: true,
          },
        });

        // 2. Assign MEMBER role
        await tx.userRoleAssignment.create({
          data: {
            userId: user.id,
            roleId: memberRole.id,
          },
        });

        // 3. Create MemberProfile
        const profile = await tx.memberProfile.create({
          data: {
            userId: user.id,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            gender: dto.gender ? (dto.gender as Gender) : null,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
            idPhotoUrl: normalizedPhoto,
            facePhotoVersion: face?.photoVersion ?? null,
          },
          include: {
            user: {
              include: {
                roles: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        });

        if (face) {
          await this.faces.save(tx, profile.id, face);
          await this.faces.audit(
            tx,
            'MEMBER_PHOTO_ENROLLED',
            profile.id,
            actorId,
            face.photoVersion,
          );
        }
        return profile;
      });

      this.logger.log(
        `Created new member: ${createdProfile.fullName} (${email})`,
      );
      return this.mapMemberDetail(createdProfile);
    } catch (error) {
      await this.auditFaceRejection(error, actorId);
      this.handlePrismaError(error);
    }
  }

  async findAll(query: QueryMembersDto): Promise<PaginatedMembersResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        ...(memberCodeRange(search) ? [{ id: memberCodeRange(search) }] : []),
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (query.isActive !== undefined) {
      where.user = {
        ...((where.user as Record<string, unknown>) || {}),
        isActive: query.isActive,
      };
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };

    const [members, total] = await Promise.all([
      this.db.client.memberProfile.findMany({
        where,
        omit: { idPhotoUrl: query.includePhoto === false },
        skip,
        take: limit,
        orderBy,
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          },
        },
      }),
      this.db.client.memberProfile.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: members.map((m) => this.mapMemberDetail(m)),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async directory(query: QueryMembersDto): Promise<MemberDirectoryResponse> {
    const now = new Date();
    const search = query.search?.trim() ?? '';
    const where: Prisma.MemberProfileWhereInput = {};
    if (search)
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search.replace(/\s/g, ''), mode: 'insensitive' } },
        ...(memberCodeRange(search) ? [{ id: memberCodeRange(search) }] : []),
      ];
    const live: Prisma.SubscriptionWhereInput = {
      OR: [
        { status: 'ACTIVE', endDate: { gte: now } },
        { status: 'UPCOMING', endDate: { gte: now } },
        { status: 'SUSPENDED' },
      ],
    };
    if (query.isActive !== undefined) where.user = { isActive: query.isActive };
    const status = query.directoryStatus;
    if (status === 'Active')
      where.subscriptions = {
        some: { status: 'ACTIVE', endDate: { gte: now } },
      };
    if (status === 'Frozen')
      where.subscriptions = { some: { status: 'SUSPENDED' } };
    if (status === 'Upcoming')
      where.subscriptions = {
        some: { status: 'UPCOMING', endDate: { gte: now } },
        none: {
          status: { in: ['ACTIVE', 'SUSPENDED'] },
          endDate: { gte: now },
        },
      };
    if (status === 'None') where.subscriptions = { none: {} };
    if (status === 'Expired') where.subscriptions = { some: {}, none: live };
    const page = query.page || 1;
    const limit = Math.min(100, query.limit || 10);
    const [total, profiles] = await Promise.all([
      this.db.client.memberProfile.count({ where }),
      this.db.client.memberProfile.findMany({
        where,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
        omit: { idPhotoUrl: query.includePhoto === false },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { include: { roles: { include: { role: true } } } },
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            include: {
              member: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  dateOfBirth: true,
                  user: { select: { email: true, isActive: true } },
                },
              },
              plan: true,
              payments: true,
              quotas: { include: { serviceType: true } },
            },
          },
        },
      }),
    ]);
    return {
      data: profiles.map((profile) => this.mapMemberDetail(profile)),
      subscriptions: profiles.flatMap((profile) =>
        profile.subscriptions.map((sub) =>
          this.subscriptions.mapSubscriptionDetail(sub, now),
        ),
      ),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string): Promise<MemberDetail> {
    const profile = await this.db.client.memberProfile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Member not found with id: ${id}`);
    }

    return this.mapMemberDetail(profile);
  }

  async findByMemberCode(code: string): Promise<MemberDetail> {
    const cleanCode = code.trim().toUpperCase();
    const rawIdPart = cleanCode.startsWith('MEM-')
      ? cleanCode.substring(4).toLowerCase()
      : cleanCode.toLowerCase();

    const candidates = await this.db.client.memberProfile.findMany({
      select: { id: true },
    });

    const matchedCandidate = candidates.find((p) => {
      const formatted = `MEM-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      return (
        formatted === cleanCode || p.id.toLowerCase().startsWith(rawIdPart)
      );
    });

    if (!matchedCandidate) {
      throw new NotFoundException(`Member not found with code: ${code}`);
    }

    const matched = await this.db.client.memberProfile.findUnique({
      where: { id: matchedCandidate.id },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!matched) {
      throw new NotFoundException(`Member not found with code: ${code}`);
    }

    return this.mapMemberDetail(matched);
  }

  async findSelf(userId: string): Promise<MemberDetail> {
    const profile = await this.db.client.memberProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Member profile not found for current user');
    }

    return this.mapMemberDetail(profile);
  }

  async updateSelf(
    userId: string,
    dto: UpdateMemberSelfDto,
  ): Promise<MemberDetail> {
    const existing = await this.db.client.memberProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException('Member profile not found for current user');
    }

    try {
      const updated = await this.db.client.memberProfile.update({
        where: { userId },
        data: {
          fullName:
            dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          phone:
            dto.phone !== undefined
              ? dto.phone
                ? dto.phone.trim()
                : null
              : undefined,
          gender:
            dto.gender !== undefined
              ? dto.gender
                ? (dto.gender as Gender)
                : null
              : undefined,
          dateOfBirth:
            dto.dateOfBirth !== undefined
              ? dto.dateOfBirth
                ? new Date(dto.dateOfBirth)
                : null
              : undefined,
        },
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(
        `Member self-updated profile: ${updated.fullName} (${userId})`,
      );
      return this.mapMemberDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(
    id: string,
    dto: UpdateMemberDto,
    actorId?: string,
  ): Promise<MemberDetail> {
    const face = dto.idPhotoUrl
      ? await this.faces.recognizer.prepare(dto.idPhotoUrl)
      : null;
    const normalizedPhoto =
      dto.idPhotoUrl === undefined ? undefined : (face?.photo ?? null);
    const existing = await this.db.client.memberProfile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
      include: {
        user: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Member not found with id: ${id}`);
    }

    try {
      const updated = await this.db.client.$transaction(async (tx) => {
        if (normalizedPhoto !== undefined) {
          await this.faces.lock(tx);
          if (face) await this.faces.assertUnique(tx, face, existing.id);
        }
        // If email changed, check conflict and update User
        if (
          dto.email &&
          dto.email.trim().toLowerCase() !== existing.user.email
        ) {
          const newEmail = dto.email.trim().toLowerCase();
          const emailUser = await tx.user.findUnique({
            where: { email: newEmail },
          });
          if (emailUser && emailUser.id !== existing.userId) {
            throw new ConflictException('Email already in use');
          }
          await tx.user.update({
            where: { id: existing.userId },
            data: { email: newEmail },
          });
        }

        // Update MemberProfile
        const profile = await tx.memberProfile.update({
          where: { id: existing.id },
          data: {
            fullName:
              dto.fullName !== undefined ? dto.fullName.trim() : undefined,
            phone:
              dto.phone !== undefined
                ? dto.phone
                  ? dto.phone.trim()
                  : null
                : undefined,
            gender:
              dto.gender !== undefined
                ? dto.gender
                  ? (dto.gender as Gender)
                  : null
                : undefined,
            dateOfBirth:
              dto.dateOfBirth !== undefined
                ? dto.dateOfBirth
                  ? new Date(dto.dateOfBirth)
                  : null
                : undefined,
            idPhotoUrl: normalizedPhoto,
            facePhotoVersion:
              normalizedPhoto === undefined
                ? undefined
                : (face?.photoVersion ?? null),
          },
          include: {
            user: {
              include: {
                roles: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        });

        if (normalizedPhoto !== undefined) {
          if (face) await this.faces.save(tx, profile.id, face);
          else await this.faces.remove(tx, profile.id);
          await this.faces.audit(
            tx,
            face ? 'MEMBER_PHOTO_REPLACED' : 'MEMBER_PHOTO_DELETED',
            profile.id,
            actorId,
            face?.photoVersion,
          );
        }
        return profile;
      });

      this.logger.log(`Updated member profile: ${updated.fullName} (${id})`);
      return this.mapMemberDetail(updated);
    } catch (error) {
      await this.auditFaceRejection(error, actorId, existing.id);
      this.handlePrismaError(error);
    }
  }
}
