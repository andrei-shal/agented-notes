import { create } from "zustand";

export interface FilterState {
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;
  clearFilter: () => void;
}

export const useFilterStore = create<FilterState>()((set) => ({
  activeTag: null,
  setActiveTag: (tag) => set({ activeTag: tag }),
  clearFilter: () => set({ activeTag: null }),
}));
