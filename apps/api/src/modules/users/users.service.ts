import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  UserRole,
  type PaginatedUsersResponse,
  type UserResponse,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import type { QueryUsersDto } from './dto/query-users.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  private mapUserResponse(user: {
    id: string;
    email: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    roles: Array<{ role: { code: string } }>;
    memberProfile?: { fullName?: string | null; phone?: string | null } | null;
    employeeProfile?: { fullName?: string | null; phone?: string | null } | null;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      roles: user.roles.map((r) => r.role.code as UserRole),
      fullName:
        user.employeeProfile?.fullName ?? user.memberProfile?.fullName ?? null,
      phone: user.employeeProfile?.phone ?? user.memberProfile?.phone ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async findUserOrThrow(id: string) {
    const user = await this.db.client.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        memberProfile: true,
        employeeProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findAll(query: QueryUsersDto): Promise<PaginatedUsersResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.role) {
      where.roles = {
        some: {
          role: {
            code: query.role,
          },
        },
      };
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { memberProfile: { fullName: { contains: search, mode: 'insensitive' } } },
        { employeeProfile: { fullName: { contains: search, mode: 'insensitive' } } },
        { memberProfile: { phone: { contains: search, mode: 'insensitive' } } },
        { employeeProfile: { phone: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };

    const [users, total] = await this.db.client.$transaction([
      this.db.client.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          roles: {
            include: {
              role: true,
            },
          },
          memberProfile: true,
          employeeProfile: true,
        },
      }),
      this.db.client.user.count({ where }),
    ]);

    return {
      data: users.map((u) => this.mapUserResponse(u)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findById(id: string): Promise<UserResponse> {
    const user = await this.findUserOrThrow(id);
    return this.mapUserResponse(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const user = await this.findUserOrThrow(id);

    if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.db.client.user.findUnique({
        where: { email },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Email is already in use');
      }
    }

    await this.db.client.$transaction(async (tx) => {
      if (dto.email) {
        await tx.user.update({
          where: { id },
          data: { email: dto.email.trim().toLowerCase() },
        });
      }

      if (dto.fullName !== undefined || dto.phone !== undefined) {
        if (user.employeeProfile) {
          await tx.employeeProfile.update({
            where: { userId: id },
            data: {
              ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
              ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            },
          });
        } else if (user.memberProfile) {
          await tx.memberProfile.update({
            where: { userId: id },
            data: {
              ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
              ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            },
          });
        } else {
          const isEmployee = user.roles.some((r) =>
            [UserRole.ADMIN, UserRole.STAFF, UserRole.PT].includes(
              r.role.code as UserRole,
            ),
          );
          if (isEmployee) {
            await tx.employeeProfile.create({
              data: {
                userId: id,
                fullName: dto.fullName || 'Employee User',
                phone: dto.phone || null,
              },
            });
          } else {
            await tx.memberProfile.create({
              data: {
                userId: id,
                fullName: dto.fullName || 'Member User',
                phone: dto.phone || null,
              },
            });
          }
        }
      }
    });

    return this.findById(id);
  }

  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    currentUserId: string,
  ): Promise<UserResponse> {
    const user = await this.findUserOrThrow(id);

    if (!dto.isActive) {
      if (currentUserId === id) {
        throw new ConflictException('Admin cannot deactivate their own account');
      }

      const isAdmin = user.roles.some(
        (r) => r.role.code === UserRole.ADMIN,
      );

      if (isAdmin) {
        const activeAdminCount =
          await this.db.client.userRoleAssignment.count({
            where: {
              role: { code: UserRole.ADMIN },
              user: { isActive: true },
            },
          });

        if (activeAdminCount <= 1) {
          throw new ConflictException(
            'Cannot deactivate the last active Admin account',
          );
        }
      }
    }

    await this.db.client.user.update({
      where: { id },
      data: {
        isActive: dto.isActive,
        ...(!dto.isActive ? { refreshTokenHash: null } : {}),
      },
    });

    return this.findById(id);
  }

  async updateRoles(
    id: string,
    dto: UpdateUserRolesDto,
    currentUserId: string,
  ): Promise<UserResponse> {
    const user = await this.findUserOrThrow(id);
    const targetRoles = Array.from(new Set(dto.roles));

    if (targetRoles.length === 0) {
      throw new BadRequestException('At least one role must be assigned');
    }

    const currentlyAdmin = user.roles.some(
      (r) => r.role.code === UserRole.ADMIN,
    );

    if (currentlyAdmin && !targetRoles.includes(UserRole.ADMIN)) {
      if (currentUserId === id) {
        throw new ConflictException('Admin cannot remove their own ADMIN role');
      }

      const activeAdminCount =
        await this.db.client.userRoleAssignment.count({
          where: {
            role: { code: UserRole.ADMIN },
            user: { isActive: true },
          },
        });

      if (activeAdminCount <= 1) {
        throw new ConflictException(
          'Cannot remove ADMIN role from the last active Admin',
        );
      }
    }

    const dbRoles = await this.db.client.role.findMany({
      where: { code: { in: targetRoles } },
    });

    if (dbRoles.length !== targetRoles.length) {
      throw new BadRequestException(
        'One or more specified roles do not exist in the database',
      );
    }

    await this.db.client.$transaction([
      this.db.client.userRoleAssignment.deleteMany({ where: { userId: id } }),
      this.db.client.userRoleAssignment.createMany({
        data: dbRoles.map((role) => ({
          userId: id,
          roleId: role.id,
        })),
      }),
    ]);

    return this.findById(id);
  }

  async changePassword(
    id: string,
    dto: ChangePasswordDto,
    currentUserId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (currentUserId !== id) {
      throw new ForbiddenException('You can only change your own password');
    }

    const user = await this.db.client.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isMatch) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.db.client.user.update({
      where: { id },
      data: {
        passwordHash: newPasswordHash,
        refreshTokenHash: null,
      },
    });

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }
}
