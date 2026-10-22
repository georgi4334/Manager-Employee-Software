import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RoleFacts {
  role: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  ownedTables: number;
}

/** Returns why this role would defeat tenant isolation; empty when safe. */
export function findRoleProblems(facts: RoleFacts): string[] {
  const problems: string[] = [];
  if (facts.isSuperuser) problems.push(`role "${facts.role}" is a superuser`);
  if (facts.bypassesRls) problems.push(`role "${facts.role}" has BYPASSRLS`);
  if (facts.ownedTables > 0) {
    problems.push(`role "${facts.role}" owns ${facts.ownedTables} table(s) in schema public`);
  }
  return problems;
}

export class UnsafeDatabaseRoleError extends Error {
  constructor(problems: string[]) {
    super(
      `DATABASE_URL must connect as the restricted application role (intime_app), but ${problems.join(', ')}. ` +
        'Row Level Security would not isolate tenants. See docs/adr/0001-multi-tenancy-rls.md.',
    );
    this.name = 'UnsafeDatabaseRoleError';
  }
}

/** Refuses to start the API when DATABASE_URL uses a role that bypasses Row Level Security. */
@Injectable()
export class DatabaseSafetyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSafetyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async readRoleFacts(): Promise<RoleFacts> {
    const rows = await this.prisma.$queryRaw<
      { role: string; is_superuser: boolean; bypasses_rls: boolean; owned_tables: number }[]
    >`
      SELECT r.rolname AS role,
             r.rolsuper AS is_superuser,
             r.rolbypassrls AS bypasses_rls,
             (SELECT count(*)::int FROM pg_tables t
               WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owned_tables
        FROM pg_roles r
       WHERE r.rolname = current_user`;
    const row = rows[0];
    if (!row) throw new Error('Could not read the current database role');
    return {
      role: row.role,
      isSuperuser: row.is_superuser,
      bypassesRls: row.bypasses_rls,
      ownedTables: row.owned_tables,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    let facts: RoleFacts;
    try {
      facts = await this.readRoleFacts();
    } catch (error) {
      // An unreachable database must not stop startup (free tiers sleep); readiness reports it instead.
      this.logger.warn({ err: error }, 'Could not verify the database role at startup');
      return;
    }
    const problems = findRoleProblems(facts);
    if (problems.length > 0) throw new UnsafeDatabaseRoleError(problems);
  }
}
