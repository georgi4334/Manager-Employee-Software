import { describe, expect, it } from 'vitest';
import { TenantContext, TenantContextError, isUuid, type TenantTx } from './tenant-context.js';

const A = '0192f5a0-0000-7000-8000-00000000000a';
const B = '0192f5a0-0000-7000-8000-00000000000b';

describe('isUuid', () => {
  it('accepts UUIDs in any case', () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid(A.toUpperCase())).toBe(true);
  });

  it.each(['', 'abc', `${A}x`, `'; DROP TABLE tenant; --`, null, undefined, 42])(
    'rejects %p',
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );
});

describe('TenantContext', () => {
  const context = new TenantContext();

  it('has no tenant outside any context', () => {
    expect(context.getTenantId()).toBeUndefined();
    expect(() => context.requireTenantId()).toThrow(TenantContextError);
  });

  it('exposes the tenant inside run()', () => {
    context.run(A, () => {
      expect(context.getTenantId()).toBe(A);
      expect(context.requireTenantId()).toBe(A);
    });
    expect(context.getTenantId()).toBeUndefined();
  });

  it('refuses a non-UUID tenant id (no SQL or garbage can reach set_config)', () => {
    expect(() => context.run("'; DROP TABLE tenant; --", () => undefined)).toThrow(
      TenantContextError,
    );
    context.runEmpty(() => {
      expect(() => context.setTenantId('not-a-uuid')).toThrow(TenantContextError);
      expect(context.getTenantId()).toBeUndefined();
    });
  });

  it('lets authentication set the tenant once inside a request context', () => {
    context.runEmpty(() => {
      expect(context.getTenantId()).toBeUndefined();
      context.setTenantId(A);
      expect(context.requireTenantId()).toBe(A);
      expect(() => context.setTenantId(A)).not.toThrow();
    });
  });

  it('refuses to switch to another tenant within the same context', () => {
    context.runEmpty(() => {
      context.setTenantId(A);
      expect(() => context.setTenantId(B)).toThrow(/already set/);
      expect(context.getTenantId()).toBe(A);
    });
  });

  it('refuses setTenantId outside any context', () => {
    expect(() => context.setTenantId(A)).toThrow(/No tenant context/);
  });

  it('keeps concurrent contexts apart across awaits', async () => {
    const seen = await Promise.all(
      [A, B, A, B].map((tenantId, index) =>
        context.run(tenantId, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10 - index * 2));
          return context.getTenantId();
        }),
      ),
    );
    expect(seen).toEqual([A, B, A, B]);
  });

  it('a nested run() for another tenant does not inherit the outer transaction', () => {
    const tx = {} as TenantTx;
    context.run(A, () =>
      context.runWithTx(tx, () => {
        expect(context.getTx()).toBe(tx);
        context.run(B, () => {
          expect(context.getTenantId()).toBe(B);
          expect(context.getTx()).toBeUndefined();
        });
        expect(context.getTenantId()).toBe(A);
      }),
    );
  });
});
