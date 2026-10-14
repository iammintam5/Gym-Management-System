import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUserProfile } from '@gym/contracts';

interface AuthState {
  user: AuthUserProfile | null;
  isAuthenticated: boolean;
  setUser: (user: AuthUserProfile | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
