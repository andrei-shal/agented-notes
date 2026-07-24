import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  id: number;
  username: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  initializing: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      initializing: true,
      login: (token, user) => set({ token, user, isAuthenticated: true, initializing: false }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
      initialize: async () => {
        try {
          const res = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (res.ok) {
            const data = await res.json() as { accessToken: string };
            const currentUser = useAuthStore.getState().user;
            set({ token: data.accessToken, isAuthenticated: true, initializing: false });
            if (!currentUser) {
              // If no user persisted, try to get it from telegram login
              set({ initializing: false });
            }
          } else {
            set({ token: null, isAuthenticated: false, initializing: false });
          }
        } catch {
          set({ token: null, isAuthenticated: false, initializing: false });
        }
      },
    }),
    {
      name: "agented-notes-auth",
      // Persist only user info — token is memory-only (XSS-safe)
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
