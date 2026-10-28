import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import type { CalendarItem } from './items';
import { TimeGrid } from './TimeGrid';
import { minutesIn } from './use-now';

const week = [
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
];
const meeting: CalendarItem = {
  key: 'event:1',
  kind: 'team',
  title: 'Standup',
  startDate: '2026-10-27',
  endDate: '2026-10-27',
  allDay: false,
  startTime: '09:00',
  endTime: '10:00',
};
const holiday: CalendarItem = {
  key: 'holiday:x',
  kind: 'holiday',
  title: 'Founders day',
  startDate: '2026-10-28',
  endDate: '2026-10-28',
  allDay: true,
  startTime: null,
  endTime: null,
};

async function renderGrid(over: Partial<Parameters<typeof TimeGrid>[0]> = {}) {
  await initTestI18n('en');
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  const utils = render(
    <TimeGrid
      days={week}
      items={[meeting, holiday]}
      today="2026-10-27"
      now={8 * 60 + 24}
      selected="2026-10-27"
      onSelect={onSelect}
      onOpen={onOpen}
      {...over}
    />,
  );
  return { ...utils, onSelect, onOpen };
}

describe('TimeGrid', () => {
  it('starts on Monday and tints Saturday and Sunday', async () => {
    await renderGrid();
    const days = screen.getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName(/^Monday/);
    expect(days[5]).toHaveClass('bg-surface-muted');
    expect(days[6]).toHaveClass('bg-surface-muted');
    expect(days[2]).not.toHaveClass('bg-surface-muted');
  });

  it('marks today and lets a day be chosen', async () => {
    const { onSelect } = await renderGrid();
    expect(screen.getByRole('button', { name: /Tuesday.*· Today$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /^Friday/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-30');
  });

  it('draws timed events in place, all-day items on top and the current time in red', async () => {
    const { container } = await renderGrid();
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Founders day')).toBeInTheDocument();
    const block = screen.getByText('Standup').parentElement!;
    expect(block.style.top).toBe(`${9 * 48 + 1}px`);
    expect(container.querySelector('.bg-danger')).not.toBeNull();
    expect(screen.getByText('08:24')).toHaveClass('text-danger');
  });

  it('shows no time line when today is not in view', async () => {
    const { container } = await renderGrid({ today: '2026-11-05' });
    expect(container.querySelector('.bg-danger')).toBeNull();
    expect(screen.queryByText('08:24')).not.toBeInTheDocument();
  });
});

describe('minutesIn', () => {
  it('reads the time of day in a zone', () => {
    const instant = new Date('2026-10-27T07:24:00Z');
    expect(minutesIn('UTC', instant)).toBe(7 * 60 + 24);
    expect(minutesIn('Europe/Sofia', instant)).toBe(9 * 60 + 24);
  });

  it('opens an item on click without selecting its day', async () => {
    const { onSelect, onOpen } = await renderGrid();
    const block = screen.getByText('Standup', { selector: 'p' });
    block.click();
    expect(onOpen).toHaveBeenCalledWith(meeting, '2026-10-27');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
