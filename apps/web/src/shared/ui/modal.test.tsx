import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { initTestI18n } from '@/tests/i18n';
import { Modal } from './modal';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Modal
        open={open}
        title="Details"
        subtitle="More"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button>First</button>
        <button>Last</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('opens as a named dialog, closes with Escape and gives the focus back', async () => {
    await initTestI18n('en');
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Open it' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(opener).toHaveFocus();
  });

  it('closes with the close button and with a click on the backdrop, not on the card', async () => {
    await initTestI18n('en');
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await user.click(await screen.findByText('More'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const backdrop = document.querySelector('.motion-fade')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the dialog', async () => {
    await initTestI18n('en');
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await screen.findByRole('dialog');
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });
});
