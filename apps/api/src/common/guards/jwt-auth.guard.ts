import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { normalizeVerifiedUserRoles, type AuthUser } from '@gym/contracts';
import { IS_PUBLIC_KEY, JWT_AUDIENCE, JWT_ISSUER } from '../constants/auth';
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: AuthUser }>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match?.[1])
      throw new UnauthorizedException('Bearer access token required');
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        match[1],
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        payload.type !== 'access' ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid access claims');
      }
      // Normalize legacy 'PT' -> TRAINER only after jwt.verifyAsync succeeds above.
      const normalizedRoles = normalizeVerifiedUserRoles(payload.roles);
      if (!normalizedRoles) {
        throw new Error('Invalid access claims');
      }
      request.user = {
        id: payload.sub,
        roles: normalizedRoles,
        ...(typeof payload.sid === 'string' ? { sessionId: payload.sid } : {}),
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
