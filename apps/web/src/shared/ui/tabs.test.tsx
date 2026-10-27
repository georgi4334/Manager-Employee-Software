import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabList, TabPanel } from './tabs';

const tabs = [
  { name: 'a', label: 'Alpha' },
  { name: 'b', label: 'Beta' },
];

describe('TabList', () => {
  it('marks the selected tab and wires the ids', () => {
    render(<TabList label="Sections" idPrefix="x" tabs={tabs} value="b" onChange={() => {}} />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('id', 'x-tab-a');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-controls', 'x-panel');
  });

  it('reports the tab that was clicked', async () => {
    const onChange = vi.fn();
    render(<TabList label="Sections" tabs={tabs} value="a" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('has no selection highlight when nothing matches', () => {
    render(<TabList label="Sections" tabs={tabs} value="" onChange={() => {}} />);
    expect(screen.queryByRole('tab', { selected: true })).not.toBeInTheDocument();
  });
});

describe('TabPanel', () => {
  it('is labelled by the selected tab and replaces its content when the tab changes', () => {
    const { rerender } = render(
      <TabPanel value="a" idPrefix="x">
        <p>First</p>
      </TabPanel>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'x-panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'x-tab-a');
    const first = screen.getByText('First').parentElement;
    rerender(
      <TabPanel value="b" idPrefix="x">
        <p>Second</p>
      </TabPanel>,
    );
    expect(screen.getByText('Second').parentElement).not.toBe(first);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'x-tab-b');
  });
});
