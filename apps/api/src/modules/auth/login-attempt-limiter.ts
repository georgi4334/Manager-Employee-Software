import { Injectable } from '@nestjs/common';

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits failed sign-ins per email (on top of the per-IP rate limit), slowing down password guessing
 * spread across many IPs. In memory: the free tier runs a single API instance.
 */
@Injectable()
export class LoginAttemptLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(email: string): boolean {
    const entry = this.current(email);
    return entry !== undefined && entry.count >= MAX_FAILURES;
  }

  recordFailure(email: string): void {
    const entry = this.current(email);
    if (entry) entry.count += 1;
    else this.failures.set(email, { count: 1, resetAt: this.now() + WINDOW_MS });
    if (this.failures.size > 10_000) this.prune();
  }

  reset(email: string): void {
    this.failures.delete(email);
  }

  private current(email: string) {
    const entry = this.failures.get(email);
    if (entry && entry.resetAt <= this.now()) {
      this.failures.delete(email);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    const now = this.now();
    for (const [email, entry] of this.failures)
      if (entry.resetAt <= now) this.failures.delete(email);
  }
}
