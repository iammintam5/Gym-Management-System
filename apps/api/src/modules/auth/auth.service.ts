import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type {
  AccessTokenClaims,
  AuthUserProfile,
  LoginResponse,
  RefreshTokenClaims,
  TokenPair,
  UserRole,
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
    };

    const jti = randomUUID();
    const refreshPayload: Omit<RefreshTokenClaims, 'exp'> = {
      sub: userId,
      jti,
      type: 'refresh',
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

    const refreshTokenHash = await bcrypt.hash(hashToken(refreshToken), 10);
    await this.db.client.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

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
        memberProfile: true,
        employeeProfile: true,
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

    const roles = user.roles.map((r) => r.role.code as UserRole);
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
    const roles = user.roles.map((r) => r.role.code as UserRole);
    return this.generateTokens(user.id, roles);
  }

  async logout(userId: string): Promise<{ success: boolean; message: string }> {
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
        memberProfile: true,
        employeeProfile: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      roles: user.roles.map((r) => r.role.code as UserRole),
      fullName:
        user.employeeProfile?.fullName ?? user.memberProfile?.fullName ?? null,
      phone: user.employeeProfile?.phone ?? user.memberProfile?.phone ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
