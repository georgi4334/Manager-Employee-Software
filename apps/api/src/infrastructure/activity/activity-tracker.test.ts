import { describe, expect, it } from 'vitest';
import { ACTIVE_WINDOW_MS, ActivityTracker } from './activity-tracker.js';

describe('ActivityTracker', () => {
  it('is inactive until the first request', () => {
    expect(new ActivityTracker().isActive(1_000_000)).toBe(false);
  });

  it('is active for 10 minutes after a request and inactive afterwards', () => {
    const tracker = new ActivityTracker();
    tracker.touch(1_000);
    expect(tracker.isActive(1_000)).toBe(true);
    expect(tracker.isActive(1_000 + ACTIVE_WINDOW_MS)).toBe(true);
    expect(tracker.isActive(1_000 + ACTIVE_WINDOW_MS + 1)).toBe(false);
  });

  it('a new request extends the window', () => {
    const tracker = new ActivityTracker();
    tracker.touch(1_000);
    tracker.touch(1_000 + ACTIVE_WINDOW_MS);
    expect(tracker.isActive(1_000 + ACTIVE_WINDOW_MS * 1.5)).toBe(true);
  });
});
