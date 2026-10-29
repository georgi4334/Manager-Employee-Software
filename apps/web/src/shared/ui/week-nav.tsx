import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

interface WeekNavProps {
  /** The week shown, already formatted ("Week of 26 Oct 2026"). */
  title: string;
  previousLabel: string;
  nextLabel: string;
  currentLabel: string;
  /** The week shown is the current one: the way back is hidden but keeps its place. */
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
}

/**
 * Previous and next sit at the two ends and never move; the way back to the current week
 * only appears under the title when it is needed, in space that is reserved, so nothing shifts.
 */
export function WeekNav({
  title,
  previousLabel,
  nextLabel,
  currentLabel,
  isCurrent,
  onPrevious,
  onNext,
  onCurrent,
}: WeekNavProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl glass p-2">
      <Button variant="secondary" size="icon" aria-label={previousLabel} onClick={onPrevious}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <h2 className="text-center text-base font-semibold" aria-live="polite">
          {title}
        </h2>
        <Button
          variant="secondary"
          className={cn(isCurrent && 'invisible')}
          // Hidden but in its place: out of the tab order and the accessibility tree too.
          aria-hidden={isCurrent || undefined}
          tabIndex={isCurrent ? -1 : undefined}
          disabled={isCurrent}
          onClick={onCurrent}
        >
          {currentLabel}
        </Button>
      </div>
      <Button variant="secondary" size="icon" aria-label={nextLabel} onClick={onNext}>
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
