import { useEffect, useState } from 'react';
import { motionEnabled } from './motion';

/** How long a figure counts up (matches `--dur-count` in tokens.css). */
export const COUNT_UP_MS = 1100;

/** Ease-out cubic: quick at first, settling gently on the exact value. */
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * The text of a figure part-way through counting up (docs/adr/0032-motion.md): every run of digits goes from 0 to
 * its value, so "12 h", "40 %", "1:30" or "1,234" keep their shape. Digits after ":", "." or "," keep their width ("1:30" → "0:00").
 * At progress 1 the text is returned unchanged.
 */
export function countUpText(text: string, progress: number): string {
  if (progress >= 1) return text;
  const p = Math.max(0, progress);
  return text.replace(/\d+/g, (run, offset: number) => {
    const value = Math.round(Number(run) * p);
    // Digits after a separator (minutes in "1:30", decimals, thousands) keep their width: "0:00", not "0:0".
    const fixed = offset > 0 && /[:.,]/.test(text[offset - 1]!);
    return fixed || run.startsWith('0') ? String(value).padStart(run.length, '0') : String(value);
  });
}

/**
 * Counts a figure up from zero when it first appears and again whenever it changes (a new period, fresh data).
 * Without motion (tests, reduced motion) the final text is returned at once.
 */
export function useCountUp(text: string, enabled: boolean = motionEnabled()): string {
  const [state, setState] = useState({ text, progress: enabled ? 0 : 1 });
  if (state.text !== text) setState({ text, progress: enabled ? 0 : 1 });

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const progress = easeOutCubic(t);
      setState((s) => (s.text === text ? { text, progress } : s));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, enabled]);

  return countUpText(text, state.text === text ? state.progress : enabled ? 0 : 1);
}
