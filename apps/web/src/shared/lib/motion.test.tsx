import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionEnabled, usePresence } from './motion';

describe('motionEnabled', () => {
  it('is off in tests', () => {
    expect(motionEnabled()).toBe(false);
  });
});

describe('usePresence without motion', () => {
  it('opens and closes at once', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 280, false), {
      initialProps: { open: false },
    });
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'open' });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
  });
});

describe('usePresence with motion', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('mounts closed, becomes open a frame later, and stays mounted while it leaves', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 280, true), {
      initialProps: { open: false },
    });
    expect(result.current.mounted).toBe(false);

    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'closed' }); // the frame to start from
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toEqual({ mounted: true, state: 'open' });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: 'closed' }); // leaving
    act(() => void vi.advanceTimersByTime(279));
    expect(result.current.mounted).toBe(true);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current.mounted).toBe(false);
  });

  it('reopening while it leaves keeps it and opens again', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 280, true), {
      initialProps: { open: true },
    });
    act(() => void vi.advanceTimersByTime(50));
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ open: true });
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toEqual({ mounted: true, state: 'open' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.mounted).toBe(true);
  });
});
