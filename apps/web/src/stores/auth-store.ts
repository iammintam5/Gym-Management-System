import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  normalizePersistedUserRoles,
  type AuthUserProfile,
} from '@gym/contracts';

interface AuthState {
  user: AuthUserProfile | null;
  isAuthenticated: boolean;
  setUser: (user: AuthUserProfile | null) => void;
  logout: () => void;
}

export function sanitizeAuthUserProfile(
  user: AuthUserProfile | null | undefined,
): AuthUserProfile | null {
  if (!user || typeof user.id !== 'string' || !user.id) {
    return null;
  }
  const roles = normalizePersistedUserRoles(user.roles);
  if (roles.length === 0) {
    return null;
  }
  return {
    ...user,
    roles,
  };
}

export function needsRoleStorageRewrite(
  rawUser: unknown,
  sanitized: AuthUserProfile | null,
): boolean {
  if (rawUser == null) return false;
  if (!sanitized) return true;
  if (typeof rawUser !== 'object') return true;
  const rawRoles = (rawUser as { roles?: unknown }).roles;
  if (!Array.isArray(rawRoles) || rawRoles.length !== sanitized.roles.length) {
    return true;
  }
  return rawRoles.some((role, idx) => role !== sanitized.roles[idx]);
}

let pendingRoleStorageRewrite = false;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) => {
        const sanitized = sanitizeAuthUserProfile(user);
        set({ user: sanitized, isAuthenticated: !!sanitized });
      },
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? window.localStorage
          : (undefined as unknown as Storage),
      ),
      merge: (persistedState, currentState) => {
        const typed = persistedState as Partial<AuthState> | undefined;
        const rawUser = typed?.user ?? null;
        const sanitized = sanitizeAuthUserProfile(rawUser);
        if (needsRoleStorageRewrite(rawUser, sanitized)) {
          pendingRoleStorageRewrite = true;
        }
        return {
          ...currentState,
          ...typed,
          user: sanitized,
          isAuthenticated: !!sanitized,
        };
      },
      onRehydrateStorage: () => (state) => {
        const shouldRewrite = pendingRoleStorageRewrite;
        pendingRoleStorageRewrite = false;
        if (shouldRewrite && state) {
          state.setUser(state.user);
        }
      },
    },
  ),
);
