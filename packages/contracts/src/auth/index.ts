export enum UserRole {
  MEMBER = 'MEMBER',
  PT = 'PT',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

export interface AuthUser {
  id: string;
  roles: UserRole[];
}
export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  type: 'access';
  exp: number;
  iat?: number;
}
export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
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
