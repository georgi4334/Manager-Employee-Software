import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import {
  DatabaseSafetyService,
  findRoleProblems,
} from '../src/infrastructure/tenancy/database-safety.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { testDbUrls } from './db-urls.js';
import { testEnv } from './helpers.js';

const urls = testDbUrls();

/** Tables that legitimately have no tenant_id. Everything else must be tenant-scoped with RLS. */
const NOT_TENANT_SCOPED = ['_prisma_migrations', 'tenant'];

interface Probe {
  note: string;
  tenant_id: string;
}

describe.skipIf(!urls)('tenant isolation with Row Level Security', () => {
  const env = testEnv({ DATABASE_URL: urls?.app, SYSTEM_DATABASE_URL: urls?.system });
  let app: PrismaService;
  let system: SystemPrismaService;
  const context = new TenantContext();
  let db: TenantDb;
  let tenantA: string;
  let tenantB: string;

  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    context.run(tenantId, () => db.tx(fn));
  const probes = (client: TenantTx | PrismaClient) =>
    client.$queryRaw<Probe[]>`SELECT note, tenant_id::text FROM rls_probe ORDER BY note`;

  beforeAll(() => {
    app = new PrismaService(env);
    system = new SystemPrismaService(env);
    db = new TenantDb(app, context);
  });

  afterAll(async () => {
    await system.$executeRaw`DELETE FROM rls_probe`;
    await system.tenant.deleteMany();
    await Promise.all([app.$disconnect(), system.$disconnect()]);
  });

  beforeEach(async () => {
    await system.$executeRaw`DELETE FROM rls_probe`;
    await system.tenant.deleteMany();
    tenantA = (await system.tenant.create({ data: { name: 'Acme', slug: 'acme' } })).id;
    tenantB = (await system.tenant.create({ data: { name: 'Beta', slug: 'beta' } })).id;
    await system.$executeRaw`
      INSERT INTO rls_probe (tenant_id, note)
      VALUES (${tenantA}::uuid, 'a1'), (${tenantA}::uuid, 'a2'), (${tenantB}::uuid, 'b1')`;
  });

  describe('schema guard', () => {
    it('every table is tenant-scoped with RLS enabled, forced and both policies (or explicitly allowlisted)', async () => {
      const tables = await system.$queryRaw<
        {
          name: string;
          rls: boolean;
          forced: boolean;
          has_tenant_id: boolean;
          policies: string[];
        }[]
      >`
        SELECT c.relname AS name,
               c.relrowsecurity AS rls,
               c.relforcerowsecurity AS forced,
               EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
                 AS has_tenant_id,
               COALESCE(ARRAY(SELECT p.polname || ':' || array_to_string(p.polroles::regrole[], ',')
                                FROM pg_policy p WHERE p.polrelid = c.oid ORDER BY 1), '{}') AS policies
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;

      expect(tables.length).toBeGreaterThan(1);
      const problems: string[] = [];
      for (const table of tables) {
        if (table.name === '_prisma_migrations') continue;
        if (!table.rls || !table.forced) problems.push(`${table.name}: RLS not enabled and forced`);
        if (NOT_TENANT_SCOPED.includes(table.name)) continue;
        if (!table.has_tenant_id) problems.push(`${table.name}: no tenant_id column`);
        for (const required of ['tenant_isolation:intime_app', 'system_access:intime_system']) {
          if (!table.policies.includes(required))
            problems.push(`${table.name}: missing ${required}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it('the migration history is not readable by the runtime roles', async () => {
      await expect(app.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow(
        /permission denied/,
      );
      await expect(system.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('reading', () => {
    it('each tenant sees only its own rows', async () => {
      expect((await asTenant(tenantA, probes)).map((p) => p.note)).toEqual(['a1', 'a2']);
      expect((await asTenant(tenantB, probes)).map((p) => p.note)).toEqual(['b1']);
    });

    it('a WHERE clause asking for another tenant still returns nothing', async () => {
      const rows = await asTenant(
        tenantB,
        (tx) =>
          tx.$queryRaw<Probe[]>`SELECT note FROM rls_probe WHERE tenant_id = ${tenantA}::uuid`,
      );
      expect(rows).toEqual([]);
    });

    it('a tenant sees only its own tenant record', async () => {
      const tenants = await asTenant(tenantA, (tx) => tx.tenant.findMany());
      expect(tenants.map((t) => t.slug)).toEqual(['acme']);
      expect(
        await asTenant(tenantA, (tx) => tx.tenant.findUnique({ where: { id: tenantB } })),
      ).toBeNull();
    });

    it('fails closed: without a tenant the app role sees nothing', async () => {
      expect(await probes(app)).toEqual([]);
      expect(await app.tenant.findMany()).toEqual([]);
    });

    it('the system role sees every tenant', async () => {
      expect((await probes(system)).map((p) => p.note)).toEqual(['a1', 'a2', 'b1']);
      expect(await system.tenant.count()).toBe(2);
    });
  });

  describe('writing', () => {
    it('stamps the current tenant on insert automatically', async () => {
      await asTenant(tenantA, (tx) => tx.$executeRaw`INSERT INTO rls_probe (note) VALUES ('a3')`);
      const created = (await probes(system)).find((p) => p.note === 'a3');
      expect(created?.tenant_id).toBe(tenantA);
    });

    it('rejects inserting a row for another tenant', async () => {
      await expect(
        asTenant(
          tenantA,
          (tx) =>
            tx.$executeRaw`INSERT INTO rls_probe (tenant_id, note) VALUES (${tenantB}::uuid, 'evil')`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect((await probes(system)).some((p) => p.note === 'evil')).toBe(false);
    });

    it('rejects inserts without a tenant', async () => {
      await expect(
        app.$executeRaw`INSERT INTO rls_probe (note) VALUES ('orphan')`,
      ).rejects.toThrow();
      expect((await probes(system)).some((p) => p.note === 'orphan')).toBe(false);
    });

    it('cannot update or delete another tenant’s rows (0 rows affected)', async () => {
      const updated = await asTenant(
        tenantB,
        (tx) =>
          tx.$executeRaw`UPDATE rls_probe SET note = 'hacked' WHERE tenant_id = ${tenantA}::uuid`,
      );
      const deleted = await asTenant(
        tenantB,
        (tx) => tx.$executeRaw`DELETE FROM rls_probe WHERE tenant_id = ${tenantA}::uuid`,
      );
      expect([updated, deleted]).toEqual([0, 0]);
      expect((await probes(system)).map((p) => p.note)).toEqual(['a1', 'a2', 'b1']);
    });

    it('cannot move its own row to another tenant', async () => {
      await expect(
        asTenant(
          tenantA,
          (tx) =>
            tx.$executeRaw`UPDATE rls_probe SET tenant_id = ${tenantB}::uuid WHERE note = 'a1'`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect((await probes(system)).find((p) => p.note === 'a1')?.tenant_id).toBe(tenantA);
    });

    it('can update and delete its own rows', async () => {
      await asTenant(tenantA, async (tx) => {
        expect(
          await tx.$executeRaw`UPDATE rls_probe SET note = 'a1-edited' WHERE note = 'a1'`,
        ).toBe(1);
        expect(await tx.$executeRaw`DELETE FROM rls_probe WHERE note = 'a2'`).toBe(1);
      });
      expect((await probes(system)).map((p) => p.note)).toEqual(['a1-edited', 'b1']);
    });

    it('rolls back everything when the callback throws', async () => {
      await expect(
        asTenant(tenantA, async (tx) => {
          await tx.$executeRaw`INSERT INTO rls_probe (note) VALUES ('rolled-back')`;
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      expect((await probes(system)).some((p) => p.note === 'rolled-back')).toBe(false);
    });
  });

  describe('tenant table', () => {
    it('a tenant can rename itself', async () => {
      await asTenant(tenantA, (tx) =>
        tx.tenant.update({ where: { id: tenantA }, data: { name: 'Acme Ltd' } }),
      );
      expect((await system.tenant.findUnique({ where: { id: tenantA } }))?.name).toBe('Acme Ltd');
    });

    it('a tenant cannot update another tenant', async () => {
      await expect(
        asTenant(tenantA, (tx) =>
          tx.tenant.update({ where: { id: tenantB }, data: { name: 'pwned' } }),
        ),
      ).rejects.toThrow();
      expect((await system.tenant.findUnique({ where: { id: tenantB } }))?.name).toBe('Beta');
    });

    it('the app role cannot create or delete tenants', async () => {
      await expect(
        asTenant(tenantA, (tx) => tx.tenant.create({ data: { name: 'New', slug: 'new' } })),
      ).rejects.toThrow();
      await expect(
        asTenant(tenantA, (tx) => tx.tenant.delete({ where: { id: tenantA } })),
      ).rejects.toThrow();
      expect(await system.tenant.count()).toBe(2);
    });
  });

  describe('connection pooling', () => {
    it('the tenant setting never leaks to the next use of a pooled connection', async () => {
      const single = new PrismaClient({
        adapter: new PrismaPg({ connectionString: urls!.app, max: 1 }),
      });
      const singleDb = new TenantDb(single as unknown as PrismaService, context);
      try {
        await context.run(tenantA, () => singleDb.tx((tx) => probes(tx)));
        await expect(
          context.run(tenantA, () =>
            singleDb.tx(async () => {
              throw new Error('rollback');
            }),
          ),
        ).rejects.toThrow('rollback');

        const [setting] = await single.$queryRaw<{ value: string | null }[]>`
          SELECT current_setting('app.tenant_id', true) AS value`;
        expect(setting?.value ?? '').toBe('');
        expect(await probes(single)).toEqual([]);
      } finally {
        await single.$disconnect();
      }
    });

    it('concurrent requests for different tenants never see each other’s rows', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const tenantId = i % 2 === 0 ? tenantA : tenantB;
          return asTenant(tenantId, async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(0.01)`;
            return { tenantId, rows: await probes(tx) };
          });
        }),
      );
      for (const { tenantId, rows } of results) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.tenant_id === tenantId)).toBe(true);
      }
    });
  });

  describe('startup safety check', () => {
    it('accepts the intime_app role', async () => {
      const facts = await new DatabaseSafetyService(app).readRoleFacts();
      expect(facts.role).toBe('intime_app');
      expect(findRoleProblems(facts)).toEqual([]);
    });

    it('rejects the migration owner', async () => {
      const owner = new PrismaService(testEnv({ DATABASE_URL: urls?.owner }));
      try {
        const service = new DatabaseSafetyService(owner);
        expect(findRoleProblems(await service.readRoleFacts()).length).toBeGreaterThan(0);
        await expect(service.onApplicationBootstrap()).rejects.toThrow(/intime_app/);
      } finally {
        await owner.$disconnect();
      }
    });
  });
});
