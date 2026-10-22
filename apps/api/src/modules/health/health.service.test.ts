import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { HealthService } from './health.service.js';

const serviceWith = ($queryRaw: () => Promise<unknown>) =>
  new HealthService({ $queryRaw } as unknown as PrismaService);

describe('HealthService.checkDatabase', () => {
  it('reports up when the query succeeds', async () => {
    expect(await serviceWith(async () => [{ '?column?': 1 }]).checkDatabase()).toBe('up');
  });

  it('reports down when the query fails', async () => {
    expect(await serviceWith(() => Promise.reject(new Error('ECONNREFUSED'))).checkDatabase()).toBe(
      'down',
    );
  });

  it('reports down when the query hangs past the timeout', async () => {
    const hang = vi.fn(() => new Promise<never>(() => {}));
    expect(await serviceWith(hang).checkDatabase(20)).toBe('down');
  });
});
