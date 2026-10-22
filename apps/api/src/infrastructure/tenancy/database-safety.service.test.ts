import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  DatabaseSafetyService,
  UnsafeDatabaseRoleError,
  findRoleProblems,
  type RoleFacts,
} from './database-safety.service.js';

const safe: RoleFacts = {
  role: 'intime_app',
  isSuperuser: false,
  bypassesRls: false,
  ownedTables: 0,
};

describe('findRoleProblems', () => {
  it('accepts a restricted role', () => {
    expect(findRoleProblems(safe)).toEqual([]);
  });

  it.each([
    [{ isSuperuser: true }, /superuser/],
    [{ bypassesRls: true }, /BYPASSRLS/],
    [{ ownedTables: 3 }, /owns 3 table/],
  ])('flags %o', (override, pattern) => {
    const problems = findRoleProblems({ ...safe, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(pattern);
  });

  it('lists every problem at once', () => {
    expect(
      findRoleProblems({ role: 'postgres', isSuperuser: true, bypassesRls: true, ownedTables: 1 }),
    ).toHaveLength(3);
  });
});

function serviceReturning(result: () => Promise<unknown>) {
  return new DatabaseSafetyService({ $queryRaw: vi.fn(result) } as unknown as PrismaService);
}

const row = (overrides: Partial<Record<string, unknown>> = {}) => [
  { role: 'intime_app', is_superuser: false, bypasses_rls: false, owned_tables: 0, ...overrides },
];

describe('DatabaseSafetyService.onApplicationBootstrap', () => {
  it('starts when the role is safe', async () => {
    await expect(
      serviceReturning(async () => row()).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it('refuses to start when the role is a superuser', async () => {
    const service = serviceReturning(async () => row({ role: 'postgres', is_superuser: true }));
    await expect(service.onApplicationBootstrap()).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
  });

  it('refuses to start when the role owns tables (connected as the migration owner)', async () => {
    const service = serviceReturning(async () => row({ role: 'intime', owned_tables: 2 }));
    await expect(service.onApplicationBootstrap()).rejects.toThrow(/owns 2 table/);
  });

  it('does not block startup when the database is unreachable (free tier asleep)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = serviceReturning(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('treats a missing role row as unverifiable, not as safe', async () => {
    await expect(serviceReturning(async () => []).readRoleFacts()).rejects.toThrow(
      /current database role/,
    );
  });
});
