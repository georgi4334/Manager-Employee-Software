import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, backoffMs } from './notification-processor.service.js';

describe('backoffMs', () => {
  it('doubles from 30 seconds', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });

  it('is capped at one hour', () => {
    expect(backoffMs(20)).toBe(60 * 60 * 1000);
    expect(backoffMs(1000)).toBe(60 * 60 * 1000);
  });

  it('treats nonsense attempts as the first', () => {
    expect(backoffMs(0)).toBe(30_000);
    expect(backoffMs(-3)).toBe(30_000);
  });

  it('gives up after a handful of attempts', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
