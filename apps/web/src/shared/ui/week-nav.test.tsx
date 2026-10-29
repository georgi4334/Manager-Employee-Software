import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WeekNav } from './week-nav';

const setup = (isCurrent: boolean) => {
  const handlers = { onPrevious: vi.fn(), onNext: vi.fn(), onCurrent: vi.fn() };
  const view = render(
    <WeekNav
      title="Week of 26 Oct 2026"
      previousLabel="Previous week"
      nextLabel="Next week"
      currentLabel="This week"
      isCurrent={isCurrent}
      {...handlers}
    />,
  );
  return { ...handlers, unmount: view.unmount };
};

describe('WeekNav', () => {
  it('always has previous and next, in the current week and in another one', () => {
    for (const isCurrent of [true, false]) {
      const { unmount } = setup(isCurrent);
      expect(screen.getAllByRole('button', { name: 'Previous week' })).not.toHaveLength(0);
      expect(screen.getAllByRole('button', { name: 'Next week' })).not.toHaveLength(0);
      expect(screen.getAllByRole('heading', { name: 'Week of 26 Oct 2026' })).not.toHaveLength(0);
      unmount();
    }
  });

  it('offers the way back only away from the current week', () => {
    setup(false);
    expect(screen.getByRole('button', { name: 'This week' })).toBeEnabled();
  });

  it('hides the way back in the current week, but keeps its place in the layout', () => {
    setup(true);
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
    const hidden = document.querySelector('button[aria-hidden="true"]') as HTMLButtonElement;
    expect(hidden).toHaveTextContent('This week'); // still rendered, so it keeps the space
    expect(hidden).toBeDisabled();
    expect(hidden.tabIndex).toBe(-1);
    expect(hidden.className).toContain('invisible');
  });

  it('calls the matching handler for each button', async () => {
    const user = userEvent.setup();
    const h = setup(false);
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect([h.onPrevious, h.onNext, h.onCurrent].map((f) => f.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });
});
