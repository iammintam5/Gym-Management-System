import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
export class Environment {
  @IsIn(['development', 'test', 'production']) NODE_ENV = 'development';
  @IsInt() @Min(1) @Max(65535) @Type(() => Number) API_PORT = 4000;
  @IsUrl({ require_tld: false }) WEB_ORIGIN = 'http://localhost:3000';
  @IsString() @Matches(/^postgres(ql)?:\/\//) DATABASE_URL!: string;
  @IsString() REDIS_HOST = 'localhost';
  @IsInt() @Min(1) @Max(65535) @Type(() => Number) REDIS_PORT = 6379;
  @IsString() @MinLength(32) JWT_ACCESS_SECRET!: string;
  @IsString() @MinLength(32) JWT_REFRESH_SECRET!: string;
  @Matches(/^\d+[smhd]$/) JWT_ACCESS_EXPIRES_IN = '15m';
  @Matches(/^\d+[smhd]$/) JWT_REFRESH_EXPIRES_IN = '7d';
}
export function validateEnvironment(raw: Record<string, unknown>): Environment {
  const value = plainToInstance(Environment, raw, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(value, { skipMissingProperties: false });
  if (errors.length)
    throw new Error(
      `Invalid environment: ${errors.map((error) => error.property).join(', ')}. Run pnpm env:setup and review root .env.`,
    );
  if (
    value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET ||
    [value.JWT_ACCESS_SECRET, value.JWT_REFRESH_SECRET].some(
      (secret) =>
        secret.startsWith('replace-with') || secret.startsWith('change-me'),
    )
  ) {
    throw new Error(
      'JWT secrets must be distinct random values. Run pnpm env:setup.',
    );
  }
  return value;
}
