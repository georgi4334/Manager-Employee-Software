import { Injectable } from '@nestjs/common';

/** How long after the last request the background worker keeps sweeping (docs/adr/0004-notifications.md). */
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Remembers when the API last served a real request. The worker only polls the database while somebody is
 * using the system, so an idle free-tier database can suspend instead of being kept awake by polling.
 */
@Injectable()
export class ActivityTracker {
  private lastActivityAt = 0;

  touch(now = Date.now()): void {
    this.lastActivityAt = now;
  }

  isActive(now = Date.now()): boolean {
    return this.lastActivityAt > 0 && now - this.lastActivityAt <= ACTIVE_WINDOW_MS;
  }
}
