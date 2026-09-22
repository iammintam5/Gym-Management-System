import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  UserRole,
  type EmployeeDetail,
  type PaginatedEmployeesResponse,
} from '@gym/contracts';
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
      hiredAt: profile.hiredAt
        ? profile.hiredAt.toISOString().split('T')[0]
        : null,
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
          throw new ConflictException('Employee profile already exists for this user');
        }
        throw new ConflictException('A unique constraint was violated');
      }
    }
    throw error;
  }

  async create(dto: CreateEmployeeDto): Promise<EmployeeDetail> {
    if (dto.role !== UserRole.STAFF && dto.role !== UserRole.PT) {
      throw new BadRequestException('Role must be either STAFF or PT');
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
      throw new BadRequestException(`${dto.role} role is not initialized in database`);
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

        // 2. Assign Employee Role (STAFF or PT)
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
            specialization: dto.specialization?.trim() || null,
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

      this.logger.log(`Created new employee: ${createdProfile.fullName} (${email}, Role: ${dto.role})`);
      return this.mapEmployeeDetail(createdProfile);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findAll(query: QueryEmployeesDto): Promise<PaginatedEmployeesResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { specialization: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const userFilters: Record<string, unknown> = {};

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

    const [employees, total] = await this.db.client.$transaction([
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
      return formatted === cleanCode || p.id.toLowerCase().startsWith(rawIdPart);
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
      throw new NotFoundException('Employee profile not found for current user');
    }

    return this.mapEmployeeDetail(profile);
  }

  async updateSelf(
    userId: string,
    dto: UpdateEmployeeSelfDto,
  ): Promise<EmployeeDetail> {
    const existing = await this.db.client.employeeProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException('Employee profile not found for current user');
    }

    try {
      const updated = await this.db.client.employeeProfile.update({
        where: { userId },
        data: {
          fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
          phone:
            dto.phone !== undefined ? (dto.phone ? dto.phone.trim() : null) : undefined,
          specialization:
            dto.specialization !== undefined
              ? dto.specialization
                ? dto.specialization.trim()
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

      this.logger.log(`Employee self-updated profile: ${updated.fullName} (${userId})`);
      return this.mapEmployeeDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeDetail> {
    const existing = await this.db.client.employeeProfile.findFirst({
      where: {
        OR: [{ id }, { userId: id }],
      },
      include: {
        user: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Employee not found with id: ${id}`);
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

        // Update EmployeeProfile
        const profile = await tx.employeeProfile.update({
          where: { id: existing.id },
          data: {
            fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
            phone:
              dto.phone !== undefined
                ? dto.phone
                  ? dto.phone.trim()
                  : null
                : undefined,
            specialization:
              dto.specialization !== undefined
                ? dto.specialization
                  ? dto.specialization.trim()
                  : null
                : undefined,
            hiredAt:
              dto.hiredAt !== undefined
                ? dto.hiredAt
                  ? new Date(dto.hiredAt)
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

      this.logger.log(`Updated employee profile: ${updated.fullName} (${id})`);
      return this.mapEmployeeDetail(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
