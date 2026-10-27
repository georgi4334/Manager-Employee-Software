import { useEffect, useState } from 'react';

/** Whether to animate: never in tests, never for people who prefer reduced motion. */
export function motionEnabled(): boolean {
  if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface Presence {
  /** Render the element while this is true (it stays for the exit animation). */
  mounted: boolean;
  /** Put on the element as `data-state`; the CSS in globals.css does the transition. */
  state: 'open' | 'closed';
}

/**
 * Keeps an element in the tree while it animates out. The element mounts as `closed` for one
 * frame and then becomes `open`, so the enter transition has something to start from.
 * Without motion it is simply `open` and gone at once.
 */
export function usePresence(
  open: boolean,
  exitMs = 280,
  enabled: boolean = motionEnabled(),
): Presence {
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [previous, setPrevious] = useState(open);

  // Decided while rendering so the element never disappears for a frame before it animates out.
  if (open !== previous) {
    setPrevious(open);
    setVisible(false);
    if (!open && enabled) setExiting(true);
    if (open) setExiting(false);
  }

  useEffect(() => {
    if (!enabled || !open) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, enabled]);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), exitMs);
    return () => clearTimeout(timer);
  }, [exiting, exitMs]);

  if (!enabled) return { mounted: open, state: open ? 'open' : 'closed' };
  return { mounted: open || exiting, state: open && visible ? 'open' : 'closed' };
}
