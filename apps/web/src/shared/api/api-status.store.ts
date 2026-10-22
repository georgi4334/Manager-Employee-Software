import { create } from 'zustand';

interface ApiStatusState {
  /** Requests that are taking unusually long (a free-tier API may need up to a minute to wake up). */
  slowRequests: number;
  slowStarted: () => void;
  slowEnded: () => void;
}

export const useApiStatusStore = create<ApiStatusState>((set) => ({
  slowRequests: 0,
  slowStarted: () => set((s) => ({ slowRequests: s.slowRequests + 1 })),
  slowEnded: () => set((s) => ({ slowRequests: Math.max(0, s.slowRequests - 1) })),
}));
