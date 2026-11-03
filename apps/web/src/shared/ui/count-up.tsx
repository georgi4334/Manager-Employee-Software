import type { ReactNode } from 'react';
import { useCountUp } from '@/shared/lib/count-up';
import { motionEnabled } from '@/shared/lib/motion';

/**
 * A figure that counts up to its value (docs/adr/0032-motion.md). Screen readers get the final value only; the
 * moving digits are decoration. Anything that is not a plain string or number is shown as it is.
 */
export function CountUp({ value }: { value: ReactNode }) {
  if (typeof value !== 'string' && typeof value !== 'number') return <>{value}</>;
  return <Counting text={String(value)} />;
}

function Counting({ text }: { text: string }) {
  const enabled = motionEnabled();
  const shown = useCountUp(text, enabled);
  if (!enabled || !/\d/.test(text)) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {shown}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}
