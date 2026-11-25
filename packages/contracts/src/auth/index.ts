export enum UserRole {
  MEMBER = 'MEMBER',
  TRAINER = 'TRAINER',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

/** Normalizes a persisted or JWT role code, mapping legacy `'PT'` to `UserRole.TRAINER`. */
export function normalizeUserRole(role: unknown): UserRole | null {
  if (role === 'PT') return UserRole.TRAINER;
  if (
    typeof role === 'string' &&
    (Object.values(UserRole) as string[]).includes(role)
  ) {
    return role as UserRole;
  }
  return null;
}

/** Normalizes a verified JWT roles claim; returns `null` if any entry is unknown or non-array. */
export function normalizeVerifiedUserRoles(roles: unknown): UserRole[] | null {
  if (!Array.isArray(roles)) return null;
  const seen = new Set<UserRole>();
  const normalized: UserRole[] = [];
  for (const role of roles) {
    const resolved = normalizeUserRole(role);
    if (!resolved) return null;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      normalized.push(resolved);
    }
  }
  return normalized;
}

/** Normalizes persisted or DB role arrays, preserving order and dropping unknown entries. */
export function normalizePersistedUserRoles(roles: unknown): UserRole[] {
  if (!Array.isArray(roles)) return [];
  const seen = new Set<UserRole>();
  const normalized: UserRole[] = [];
  for (const role of roles) {
    const resolved = normalizeUserRole(role);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      normalized.push(resolved);
    }
  }
  return normalized;
}

export interface AuthUser {
  id: string;
  roles: UserRole[];
  sessionId?: string;
}
export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  type: 'access';
  sid?: string;
  exp: number;
  iat?: number;
}
export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
  sid?: string;
  exp: number;
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface RefreshTokenRequest {
  refreshToken: string;
}
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
export interface AuthUserProfile {
  id: string;
  email: string;
  isActive: boolean;
  roles: UserRole[];
  fullName?: string | null;
  phone?: string | null;
  createdAt: string | Date;
}
export interface LoginResponse {
  tokens: TokenPair;
  user: AuthUserProfile;
}
