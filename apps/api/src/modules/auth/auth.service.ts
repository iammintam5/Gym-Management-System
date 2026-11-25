import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  normalizePersistedUserRoles,
  type AccessTokenClaims,
  type AuthUserProfile,
  type LoginResponse,
  type RefreshTokenClaims,
  type TokenPair,
  type UserRole,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../common/constants/auth';
import type { LoginDto, RefreshTokenDto } from './dto/login.dto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async generateTokens(
    userId: string,
    roles: UserRole[],
    sessionId: string = randomUUID(),
    previousHash?: string,
  ): Promise<TokenPair> {
    const accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
    const accessExpiresIn = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    );
    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );

    const accessPayload: Omit<AccessTokenClaims, 'exp' | 'iat'> = {
      sub: userId,
      roles,
      type: 'access',
      sid: sessionId,
    };

    const jti = randomUUID();
    const refreshPayload: Omit<RefreshTokenClaims, 'exp'> = {
      sub: userId,
      jti,
      type: 'refresh',
      sid: sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn as unknown as number,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as unknown as number,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      }),
    ]);

    const decoded = this.jwt.decode<RefreshTokenClaims>(refreshToken);
    const tokenHash = hashToken(refreshToken);
    if (previousHash) {
      const changed = await this.db.client.authSession.updateMany({
        where: {
          id: sessionId,
          userId,
          tokenHash: previousHash,
          expiresAt: { gt: new Date() },
        },
        data: { tokenHash, expiresAt: new Date(decoded.exp * 1000) },
      });
      if (changed.count !== 1)
        throw new UnauthorizedException(
          'Refresh token has already been rotated or revoked',
        );
    } else {
      await this.db.client.$transaction(async (tx) => {
        await tx.authSession.deleteMany({
          where: { userId, expiresAt: { lte: new Date() } },
        });
        // Bound simultaneous sessions while preserving separate phone and desk logins.
        const sessions = await tx.authSession.findMany({
          where: { userId },
          orderBy: { expiresAt: 'desc' },
          skip: 9,
        });
        if (sessions.length)
          await tx.authSession.deleteMany({
            where: { id: { in: sessions.map((session) => session.id) } },
          });
        await tx.authSession.create({
          data: {
            id: sessionId,
            userId,
            tokenHash,
            expiresAt: new Date(decoded.exp * 1000),
          },
        });
      });
    }

    return { accessToken, refreshToken };
  }

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const user = await this.db.client.user.findUnique({
      where: { email: loginDto.email.trim().toLowerCase() },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        memberProfile: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        employeeProfile: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled or inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = normalizePersistedUserRoles(
      user.roles.map((r) => r.role.code),
    );
    const tokens = await this.generateTokens(user.id, roles);

    const userProfile: AuthUserProfile = {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      roles,
      fullName:
        user.employeeProfile?.fullName ?? user.memberProfile?.fullName ?? null,
      phone: user.employeeProfile?.phone ?? user.memberProfile?.phone ?? null,
      createdAt: user.createdAt.toISOString(),
    };

    return {
      tokens,
      user: userProfile,
    };
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<TokenPair> {
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        refreshTokenDto.refreshToken,
        {
          secret: refreshSecret,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          algorithms: ['HS256'],
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.type !== 'refresh'
    ) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    const user = await this.db.client.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const roles = normalizePersistedUserRoles(
      user.roles.map((r) => r.role.code),
    );
    if (typeof payload.sid === 'string') {
      const session = await this.db.client.authSession.findUnique({
        where: { id: payload.sid },
      });
      if (
        !session ||
        session.userId !== user.id ||
        session.expiresAt <= new Date() ||
        session.tokenHash !== hashToken(refreshTokenDto.refreshToken)
      )
        throw new UnauthorizedException('Refresh token has been revoked');
      return this.generateTokens(user.id, roles, session.id, session.tokenHash);
    }
    // Existing sessions can migrate once; consume the legacy hash atomically.
    if (!user.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const isRefreshTokenValid = await bcrypt.compare(
      hashToken(refreshTokenDto.refreshToken),
      user.refreshTokenHash,
    );

    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Token rotation: Issue new token pair and replace stored hash
    const consumed = await this.db.client.user.updateMany({
      where: { id: user.id, refreshTokenHash: user.refreshTokenHash },
      data: { refreshTokenHash: null },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException('Refresh token has already been used');
    return this.generateTokens(user.id, roles);
  }

  async logout(
    userId: string,
    sessionId?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (sessionId)
      await this.db.client.authSession.deleteMany({
        where: { userId, id: sessionId },
      });
    if (!sessionId)
      await this.db.client.user.update({
        where: { id: userId },
        data: { refreshTokenHash: null },
      });

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  async getCurrentUserProfile(userId: string): Promise<AuthUserProfile> {
    const user = await this.db.client.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        memberProfile: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        employeeProfile: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      roles: normalizePersistedUserRoles(user.roles.map((r) => r.role.code)),
      fullName:
        user.employeeProfile?.fullName ?? user.memberProfile?.fullName ?? null,
      phone: user.employeeProfile?.phone ?? user.memberProfile?.phone ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
