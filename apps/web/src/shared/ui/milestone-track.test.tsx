import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MilestoneTrack, type MilestonePoint } from './milestone-track';

const point = (n: number, state: MilestonePoint['state'], extra: Partial<MilestonePoint> = {}) => ({
  key: `m${n}`,
  label: `Milestone ${n}`,
  date: `2026-0${n}-01`,
  state,
  ...extra,
});

describe('MilestoneTrack', () => {
  it('lists every point with its date and its state in words', () => {
    render(
      <MilestoneTrack
        label="Timeline"
        today="2026-02-15"
        points={[
          point(1, 'done'),
          point(2, 'late', { note: '14 days late' }),
          point(3, 'next'),
          point(4, 'upcoming'),
        ]}
      />,
    );
    const items = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Milestone 1');
    expect(items[0]).toHaveTextContent('done');
    expect(items[1]).toHaveTextContent('late');
    expect(items[1]).toHaveTextContent('14 days late');
    expect(items[2]).toHaveTextContent('next');
    expect(items[3]).toHaveTextContent('upcoming');
  });

  it('puts the Today pin between its neighbours, hidden from screen readers', () => {
    const { container } = render(
      <MilestoneTrack
        label="Timeline"
        today="2026-02-15"
        points={[point(1, 'done'), point(2, 'done'), point(3, 'next')]}
      />,
    );
    const pin = screen.getByTestId('milestone-today');
    expect(pin).toHaveAttribute('aria-hidden', 'true');
    expect(pin).toHaveTextContent('Today');
    // The line runs from 1/6 to 5/6 of the width; 15 Feb is half way between the second and the third point,
    // so three quarters along the line: 1/6 + 3/4 × 2/3 = 2/3 of the width.
    const pos = (container.firstElementChild as HTMLElement).style.getPropertyValue('--pos');
    const [start, along] = [...pos.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(start).toBeCloseTo(16.667, 2);
    expect(along).toBeCloseTo(50, 2);
  });

  it('stacks long tracks in every width and short ones side by side from sm', () => {
    const many = Array.from({ length: 7 }, (_, i) => point(i + 1, 'upcoming'));
    const { unmount } = render(<MilestoneTrack label="Long" today="2026-01-01" points={many} />);
    expect(screen.getByRole('list', { name: 'Long' }).className).not.toContain('sm:grid-flow-col');
    unmount();
    render(<MilestoneTrack label="Short" today="2026-01-01" points={many.slice(0, 3)} />);
    expect(screen.getByRole('list', { name: 'Short' }).className).toContain('sm:grid-flow-col');
  });

  it('draws nothing without points', () => {
    const { container } = render(<MilestoneTrack label="Empty" today="2026-01-01" points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
