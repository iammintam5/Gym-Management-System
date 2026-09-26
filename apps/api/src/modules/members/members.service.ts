import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
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

  constructor(private readonly db: DatabaseService) {}

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

  private handlePrismaError(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: string }).code;
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
          throw new ConflictException('Member profile already exists for this user');
        }
        throw new ConflictException('A unique constraint was violated');
      }
    }
    throw error;
  }

  async create(dto: CreateMemberDto): Promise<MemberDetail> {
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
      throw new BadRequestException('MEMBER role is not initialized in database');
    }

    try {
      const createdProfile = await this.db.client.$transaction(async (tx) => {
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
            idPhotoUrl: dto.idPhotoUrl?.trim() || null,
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

        return profile;
      });

      this.logger.log(`Created new member: ${createdProfile.fullName} (${email})`);
      return this.mapMemberDetail(createdProfile);
    } catch (error) {
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

    const [members, total] = await this.db.client.$transaction([
      this.db.client.memberProfile.findMany({
        where,
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

    const profiles = await this.db.client.memberProfile.findMany({
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

    const matched = profiles.find((p) => {
      const formatted = `MEM-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      return formatted === cleanCode || p.id.toLowerCase().startsWith(rawIdPart);
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
          fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          phone:
            dto.phone !== undefined ? (dto.phone ? dto.phone.trim() : null) : undefined,
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

      this.logger.log(`Member self-updated profile: ${updated.fullName} (${userId})`);
      return this.mapMemberDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, dto: UpdateMemberDto): Promise<MemberDetail> {
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
        // If email changed, check conflict and update User
        if (dto.email && dto.email.trim().toLowerCase() !== existing.user.email) {
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
            fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
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
            idPhotoUrl:
              dto.idPhotoUrl !== undefined
                ? dto.idPhotoUrl
                  ? dto.idPhotoUrl.trim()
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

        return profile;
      });

      this.logger.log(`Updated member profile: ${updated.fullName} (${id})`);
      return this.mapMemberDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
