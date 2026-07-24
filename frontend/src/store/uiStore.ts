import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

export interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
}

const getInitialSidebarOpen = (): boolean => {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= 768;
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "light",
      sidebarOpen: getInitialSidebarOpen(),
      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === "light" ? "dark" : "light",
        })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: "agented-notes-ui",
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);
