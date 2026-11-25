import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  defaultEmployeeCapabilitiesForRole,
  formatSpecialtiesSummary,
  normalizePersistedUserRoles,
  normalizeSpecialties,
  seedSpecialtiesFromSpecialization,
  TrainerServiceFilter,
  UserRole,
  type EmployeeDetail,
  type PaginatedEmployeesResponse,
} from '@gym/contracts';
import type { Prisma } from '@gym/database';
import { lockScheduleWrites } from '../common/booking-access';
import { DatabaseService } from '../database/database.module';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { UpdateEmployeeSelfDto } from './dto/update-employee-self.dto';
import type { QueryEmployeesDto } from './dto/query-employees.dto';

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(private readonly db: DatabaseService) {}

  private mapEmployeeDetail(profile: {
    id: string;
    userId: string;
    fullName: string;
    phone: string | null;
    specialization: string | null;
    specialties?: string[];
    canTeachClasses?: boolean;
    canCoachPt?: boolean;
    hiredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
      email: string;
      isActive: boolean;
      roles: Array<{ role: { code: string } }>;
    };
  }): EmployeeDetail {
    return {
      id: profile.id,
      userId: profile.userId,
      employeeCode: `EMP-${profile.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      fullName: profile.fullName,
      phone: profile.phone ?? null,
      specialization: profile.specialization ?? null,
      specialties: profile.specialties ?? [],
      canTeachClasses: Boolean(profile.canTeachClasses),
      canCoachPt: Boolean(profile.canCoachPt),
      hiredAt: profile.hiredAt
        ? profile.hiredAt.toISOString().split('T')[0]
        : null,
      email: profile.user.email,
      isActive: profile.user.isActive,
      roles: normalizePersistedUserRoles(
        profile.user.roles.map((r) => r.role.code),
      ),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private resolveTrainerSpecialtyUpdate(
    currentSpecialization: string | null,
    dto: { specialization?: string | null; specialties?: string[] },
  ): { specialization?: string | null; specialties?: string[] } {
    if (dto.specialties !== undefined) {
      const specialties = normalizeSpecialties(dto.specialties);
      const specialization =
        dto.specialization !== undefined
          ? dto.specialization
            ? dto.specialization.trim() || null
            : null
          : formatSpecialtiesSummary(specialties);
      return { specialties, specialization };
    }

    if (dto.specialization !== undefined) {
      const trimmed = dto.specialization
        ? dto.specialization.trim() || null
        : null;
      return trimmed !== currentSpecialization
        ? {
            specialization: trimmed,
            specialties: seedSpecialtiesFromSpecialization(trimmed),
          }
        : { specialization: trimmed };
    }

    return {};
  }

  private assertNonTrainerRestrictions(
    dto: {
      canTeachClasses?: boolean;
      canCoachPt?: boolean;
      specialties?: string[];
    },
    contextMessagePrefix: string,
  ): void {
    if (dto.canTeachClasses === true || dto.canCoachPt === true) {
      throw new BadRequestException(
        `${contextMessagePrefix} cannot be granted trainer service capabilities`,
      );
    }
    if (dto.specialties && normalizeSpecialties(dto.specialties).length > 0) {
      throw new BadRequestException(
        `${contextMessagePrefix} cannot be assigned trainer specialties`,
      );
    }
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
          throw new ConflictException(
            'Employee profile already exists for this user',
          );
        }
        throw new ConflictException('A unique constraint was violated');
      }
    }
    throw error;
  }

  async create(dto: CreateEmployeeDto): Promise<EmployeeDetail> {
    if (dto.role !== UserRole.STAFF && dto.role !== UserRole.TRAINER) {
      throw new BadRequestException('Role must be either STAFF or TRAINER');
    }

    const defaults = defaultEmployeeCapabilitiesForRole(dto.role);
    let canTeachClasses = defaults.canTeachClasses;
    let canCoachPt = defaults.canCoachPt;
    let specialization: string | null = dto.specialization?.trim() || null;
    let specialties: string[] = [];

    if (dto.role !== UserRole.TRAINER) {
      this.assertNonTrainerRestrictions(dto, 'Staff employees');
      canTeachClasses = false;
      canCoachPt = false;
      specialties = [];
    } else {
      canTeachClasses = dto.canTeachClasses ?? defaults.canTeachClasses;
      canCoachPt = dto.canCoachPt ?? defaults.canCoachPt;
      if (dto.specialties !== undefined) {
        specialties = normalizeSpecialties(dto.specialties);
        specialization =
          dto.specialization !== undefined
            ? specialization
            : formatSpecialtiesSummary(specialties);
      } else {
        specialties = seedSpecialtiesFromSpecialization(specialization);
      }
    }

    const email = dto.email.trim().toLowerCase();

    // Check existing user email
    const existingUser = await this.db.client.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Default password based on role if omitted
    const rawPassword =
      dto.password?.trim() ||
      (dto.role === UserRole.STAFF ? 'Staff@123456' : 'Pt@123456');
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    // Retrieve requested role from database
    const targetRole = await this.db.client.role.findUnique({
      where: { code: dto.role },
    });
    if (!targetRole) {
      throw new BadRequestException(
        `${dto.role} role is not initialized in database`,
      );
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

        // 2. Assign Employee Role (STAFF or TRAINER)
        await tx.userRoleAssignment.create({
          data: {
            userId: user.id,
            roleId: targetRole.id,
          },
        });

        // 3. Create EmployeeProfile
        const profile = await tx.employeeProfile.create({
          data: {
            userId: user.id,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            specialization,
            specialties,
            canTeachClasses,
            canCoachPt,
            hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : null,
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

      this.logger.log(
        `Created new employee: ${createdProfile.fullName} (${email}, Role: ${dto.role})`,
      );
      return this.mapEmployeeDetail(createdProfile);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findAll(query: QueryEmployeesDto): Promise<PaginatedEmployeesResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeProfileWhereInput = {};

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { specialization: { contains: search, mode: 'insensitive' } },
        { specialties: { has: search } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (query.service === TrainerServiceFilter.CLASS) {
      where.canTeachClasses = true;
    } else if (query.service === TrainerServiceFilter.PT) {
      where.canCoachPt = true;
    }

    const userFilters: Prisma.UserWhereInput = {};

    if (query.isActive !== undefined) {
      userFilters.isActive = query.isActive;
    }

    if (query.role) {
      userFilters.roles = {
        some: {
          role: {
            code: query.role,
          },
        },
      };
    }

    if (Object.keys(userFilters).length > 0) {
      where.user = userFilters;
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };

    const [employees, total] = await Promise.all([
      this.db.client.employeeProfile.findMany({
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
      this.db.client.employeeProfile.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: employees.map((e) => this.mapEmployeeDetail(e)),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findById(id: string): Promise<EmployeeDetail> {
    const profile = await this.db.client.employeeProfile.findFirst({
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
      throw new NotFoundException(`Employee not found with id: ${id}`);
    }

    return this.mapEmployeeDetail(profile);
  }

  async findByEmployeeCode(code: string): Promise<EmployeeDetail> {
    const cleanCode = code.trim().toUpperCase();
    const rawIdPart = cleanCode.startsWith('EMP-')
      ? cleanCode.substring(4).toLowerCase()
      : cleanCode.toLowerCase();

    const profiles = await this.db.client.employeeProfile.findMany({
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
      const formatted = `EMP-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      return (
        formatted === cleanCode || p.id.toLowerCase().startsWith(rawIdPart)
      );
    });

    if (!matched) {
      throw new NotFoundException(`Employee not found with code: ${code}`);
    }

    return this.mapEmployeeDetail(matched);
  }

  async findSelf(userId: string): Promise<EmployeeDetail> {
    const profile = await this.db.client.employeeProfile.findUnique({
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
      throw new NotFoundException(
        'Employee profile not found for current user',
      );
    }

    return this.mapEmployeeDetail(profile);
  }

  async updateSelf(
    userId: string,
    dto: UpdateEmployeeSelfDto,
  ): Promise<EmployeeDetail> {
    const rawDto = dto as Record<string, unknown>;
    if ('canTeachClasses' in rawDto || 'canCoachPt' in rawDto) {
      throw new ForbiddenException(
        'Trainers cannot modify their own service capabilities',
      );
    }

    const existing = await this.db.client.employeeProfile.findUnique({
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

    if (!existing) {
      throw new NotFoundException(
        'Employee profile not found for current user',
      );
    }

    const hasTrainerRole = normalizePersistedUserRoles(
      existing.user.roles.map((r) => r.role.code),
    ).includes(UserRole.TRAINER);

    let specialtyPatch: { specialization?: string | null; specialties?: string[] } =
      {};
    if (!hasTrainerRole) {
      if (dto.specialties && normalizeSpecialties(dto.specialties).length > 0) {
        throw new BadRequestException(
          'Staff employees cannot be assigned trainer specialties',
        );
      }
      if (dto.specialization !== undefined) {
        specialtyPatch = {
          specialization: dto.specialization
            ? dto.specialization.trim() || null
            : null,
        };
      }
    } else {
      specialtyPatch = this.resolveTrainerSpecialtyUpdate(
        existing.specialization ?? null,
        dto,
      );
    }

    try {
      const updated = await this.db.client.employeeProfile.update({
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
          ...specialtyPatch,
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
        `Employee self-updated profile: ${updated.fullName} (${userId})`,
      );
      return this.mapEmployeeDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeDetail> {
    try {
      const updated = await this.db.client.$transaction(async (tx) => {
        if (
          dto.canTeachClasses !== undefined ||
          dto.canCoachPt !== undefined
        ) {
          await lockScheduleWrites(tx);
        }

        const existing = await tx.employeeProfile.findFirst({
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

        if (!existing) {
          throw new NotFoundException(`Employee not found with id: ${id}`);
        }

        const hasTrainerRole = normalizePersistedUserRoles(
          existing.user.roles.map((r) => r.role.code),
        ).includes(UserRole.TRAINER);

        let roleData: Prisma.EmployeeProfileUpdateInput = {};
        if (!hasTrainerRole) {
          this.assertNonTrainerRestrictions(dto, 'Non-trainer employees');
          roleData = {
            specialization:
              dto.specialization !== undefined
                ? dto.specialization
                  ? dto.specialization.trim() || null
                  : null
                : undefined,
            specialties: [],
            canTeachClasses: false,
            canCoachPt: false,
          };
        } else {
          const specialtyPatch = this.resolveTrainerSpecialtyUpdate(
            existing.specialization ?? null,
            dto,
          );
          roleData = {
            ...specialtyPatch,
            canTeachClasses: dto.canTeachClasses,
            canCoachPt: dto.canCoachPt,
          };
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

        // Update EmployeeProfile
        const profile = await tx.employeeProfile.update({
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
            hiredAt:
              dto.hiredAt !== undefined
                ? dto.hiredAt
                  ? new Date(dto.hiredAt)
                  : null
                : undefined,
            ...roleData,
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

      this.logger.log(`Updated employee profile: ${updated.fullName} (${id})`);
      return this.mapEmployeeDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
