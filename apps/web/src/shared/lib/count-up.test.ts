import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNT_UP_MS, countUpText, easeOutCubic, useCountUp } from './count-up';

describe('countUpText', () => {
  it('starts every number at zero and ends on the exact text', () => {
    expect(countUpText('40 %', 0)).toBe('0 %');
    expect(countUpText('40 %', 0.5)).toBe('20 %');
    expect(countUpText('40 %', 1)).toBe('40 %');
  });

  it('counts 5 through the whole numbers on the way', () => {
    const seen = [0.2, 0.4, 0.6, 0.8, 1].map((p) => countUpText('5', p));
    expect(seen).toEqual(['1', '2', '3', '4', '5']);
  });

  it('keeps the shape of durations, decimals and grouped numbers', () => {
    expect(countUpText('1:30', 0)).toBe('0:00');
    expect(countUpText('1:05', 0.4)).toBe('0:02');
    expect(countUpText('4.5 days', 1)).toBe('4.5 days');
    expect(countUpText('1,234', 0)).toBe('0,000');
  });

  it('leaves text without digits alone', () => {
    expect(countUpText('None', 0)).toBe('None');
  });

  it('clamps progress below zero', () => {
    expect(countUpText('8', -1)).toBe('0');
  });
});

describe('easeOutCubic', () => {
  it('runs from 0 to 1, faster at the start', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('useCountUp', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the final value at once without motion', () => {
    const { result } = renderHook(() => useCountUp('12 h', false));
    expect(result.current).toBe('12 h');
  });

  it('counts up with motion and lands on the exact value', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { result, rerender } = renderHook(({ text }) => useCountUp(text, true), {
      initialProps: { text: '50' },
    });
    expect(result.current).toBe('0');
    await act(async () => {
      vi.advanceTimersByTime(COUNT_UP_MS / 3);
    });
    const middle = Number(result.current);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(50);
    await act(async () => {
      vi.advanceTimersByTime(COUNT_UP_MS);
    });
    expect(result.current).toBe('50');
    // a new value counts up again
    rerender({ text: '7' });
    expect(result.current).toBe('0');
    await act(async () => {
      vi.advanceTimersByTime(COUNT_UP_MS + 50);
    });
    expect(result.current).toBe('7');
  });
});
