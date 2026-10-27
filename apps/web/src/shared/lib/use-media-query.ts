import { useSyncExternalStore } from 'react';

/** Whether a media query matches now; follows changes (rotation, resizing). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.('change', onChange);
      return () => list?.removeEventListener?.('change', onChange);
    },
    () => Boolean(window.matchMedia?.(query).matches),
    () => false,
  );
}
