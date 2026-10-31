import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DayRibbon } from './DayRibbon';

const closed = { startTime: '08:12', endTime: '12:12', open: false, minutes: 240 };
const running = { startTime: '12:48', endTime: null, open: true, minutes: null };

describe('DayRibbon', () => {
  it('shows the open record up to now, the break and when the target will be reached', () => {
    render(
      <DayRibbon records={[closed, running]} minutes={340} target={480} level="in_progress" />,
    );
    const ribbon = screen.getByTestId('day-ribbon');
    expect(ribbon).toHaveAttribute('aria-hidden', 'true');
    expect(ribbon).toHaveTextContent('Now 14:28');
    expect(screen.getByText('Breaks 0 h 36 min')).toBeInTheDocument();
    expect(screen.getByText('8 h 0 min at 16:48 if you keep going')).toBeInTheDocument();
    expect(screen.getByText('5 h 40 min of 8 h 0 min')).toBeInTheDocument();
  });

  it('says when a finished day reached the target, and what was over', () => {
    render(
      <DayRibbon
        records={[closed, { startTime: '12:48', endTime: '18:00', open: false, minutes: 312 }]}
        minutes={552}
        target={480}
        level="over"
      />,
    );
    expect(screen.queryByText(/^Now /)).not.toBeInTheDocument();
    expect(screen.getByText('8 h 0 min reached at 16:48')).toBeInTheDocument();
    expect(screen.getByText('1 h 12 min over')).toBeInTheDocument();
  });

  it('names no target time for a short day and none at all on a day off', () => {
    const { unmount } = render(
      <DayRibbon records={[closed]} minutes={240} target={480} level="short" />,
    );
    expect(screen.queryByText(/reached at|keep going/)).not.toBeInTheDocument();
    expect(screen.getByText('4 h 0 min to go')).toBeInTheDocument();
    unmount();
    render(<DayRibbon records={[closed]} minutes={240} target={0} level="complete" />);
    expect(screen.getByText('Day off · 4 h 0 min recorded')).toBeInTheDocument();
    expect(screen.queryByText(/reached at|keep going/)).not.toBeInTheDocument();
  });
});
