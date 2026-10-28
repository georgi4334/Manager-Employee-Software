import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { isValidDate, isValidTime } from './date-time-picker';
import { Input } from './input';

function Controlled({
  type,
  start = '',
  onValue,
}: {
  type: 'date' | 'time';
  start?: string;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <label htmlFor="f">Field</label>
      <Input
        id="f"
        type={type}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onValue?.(e.target.value);
        }}
      />
    </>
  );
}

describe('validators', () => {
  it.each(['2026-02-28', '2028-02-29', '2026-12-31'])('accepts the date %s', (d) =>
    expect(isValidDate(d)).toBe(true),
  );
  it.each(['2026-02-30', '2026-13-01', '2026-1-1', '', 'abc', '2026-00-10'])(
    'refuses the date %j',
    (d) => expect(isValidDate(d)).toBe(false),
  );
  it.each(['00:00', '09:30', '23:59'])('accepts the time %s', (t) =>
    expect(isValidTime(t)).toBe(true),
  );
  it.each(['24:00', '9:30', '12:60', '', '12-30'])('refuses the time %j', (t) =>
    expect(isValidTime(t)).toBe(false),
  );
});

describe('date picker', () => {
  it('picks a day from the calendar and closes', async () => {
    await initTestI18n('en');
    const onValue = vi.fn();
    render(<Controlled type="date" start="2026-10-15" onValue={onValue} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const dialog = screen.getByRole('dialog', { name: 'Open calendar' });
    await user.click(within(dialog).getByRole('button', { name: /20 October 2026/ }));
    expect(screen.getByLabelText('Field')).toHaveValue('2026-10-20');
    expect(onValue).toHaveBeenCalledWith('2026-10-20');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('changes month and year', async () => {
    await initTestI18n('en');
    render(<Controlled type="date" start="2026-10-15" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Next month' }));
    await user.click(within(dialog).getByRole('button', { name: / 3 November 2026/ }));
    expect(screen.getByLabelText('Field')).toHaveValue('2026-11-03');

    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'November 2026' }),
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next year' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Feb' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /10 February 2027/ }),
    );
    expect(screen.getByLabelText('Field')).toHaveValue('2027-02-10');
  });

  it('clears the value', async () => {
    await initTestI18n('en');
    render(<Controlled type="date" start="2026-10-15" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Field')).toHaveValue('');
  });

  it('closes with Escape and gives the focus back to the button', async () => {
    await initTestI18n('en');
    render(<Controlled type="date" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open calendar' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open calendar' })).toHaveFocus();
  });

  it('reports only complete typed values and restores the last good one on blur', async () => {
    await initTestI18n('en');
    const onValue = vi.fn();
    render(<Controlled type="date" start="2026-10-15" onValue={onValue} />);
    const user = userEvent.setup();
    const field = screen.getByLabelText('Field');
    await user.clear(field);
    await user.type(field, '2026-11-0');
    expect(onValue).toHaveBeenCalledTimes(1); // only the clear
    expect(onValue).toHaveBeenLastCalledWith('');
    await user.tab();
    expect(field).toHaveValue('');
    await user.type(field, '2026-11-05');
    expect(onValue).toHaveBeenLastCalledWith('2026-11-05');
  });

  it('never accepts an impossible date', async () => {
    await initTestI18n('en');
    const onValue = vi.fn();
    render(<Controlled type="date" start="2026-10-15" onValue={onValue} />);
    const user = userEvent.setup();
    const field = screen.getByLabelText('Field');
    await user.clear(field);
    await user.type(field, '2026-02-30');
    expect(onValue).not.toHaveBeenCalledWith('2026-02-30');
    await user.tab();
    expect(field).toHaveValue('');
  });

  it('can be disabled', async () => {
    await initTestI18n('en');
    render(<Input type="date" disabled aria-label="Day" />);
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeDisabled();
  });
});

describe('time picker', () => {
  it('sets hour and minute', async () => {
    await initTestI18n('en');
    const onValue = vi.fn();
    render(<Controlled type="time" start="09:00" onValue={onValue} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open clock' }));
    const dialog = screen.getByRole('dialog', { name: 'Open clock' });
    await user.click(
      within(within(dialog).getByRole('group', { name: 'Hour' })).getByRole('button', {
        name: '14',
      }),
    );
    await user.click(
      within(within(dialog).getByRole('group', { name: 'Minute' })).getByRole('button', {
        name: '45',
      }),
    );
    expect(screen.getByLabelText('Field')).toHaveValue('14:45');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts from 09 when only a minute is chosen on an empty field', async () => {
    await initTestI18n('en');
    render(<Controlled type="time" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open clock' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Minute' })).getByRole('button', { name: '30' }),
    );
    expect(screen.getByLabelText('Field')).toHaveValue('09:30');
  });

  it('keeps a hand-typed minute selectable', async () => {
    await initTestI18n('en');
    render(<Controlled type="time" start="09:07" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open clock' }));
    expect(
      within(screen.getByRole('group', { name: 'Minute' })).getByRole('button', { name: '07' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuses a time that does not exist', async () => {
    await initTestI18n('en');
    const onValue = vi.fn();
    render(<Controlled type="time" onValue={onValue} />);
    await userEvent.setup().type(screen.getByLabelText('Field'), '25:00');
    expect(onValue).not.toHaveBeenCalled();
  });
});
