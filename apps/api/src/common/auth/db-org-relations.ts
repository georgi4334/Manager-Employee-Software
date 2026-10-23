import { Injectable } from '@nestjs/common';
import type { Relation } from '@intime/contracts';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import type { OrgRelations } from './authorization.service.js';

interface Row {
  id: string;
  relation: Relation;
}

/**
 * Reads who reports to whom and who shares a department (docs/adr/0007-organization.md). Runs through
 * TenantDb, so Row Level Security limits every lookup to the actor's workspace; relations are computed per
 * call and never cached (people move, permissions must follow immediately).
 *
 * Fail closed: an actor without an employee record, or an unknown employee, is "other".
 */
@Injectable()
export class DbOrgRelations implements OrgRelations {
  constructor(private readonly db: TenantDb) {}

  async relationOf(actorUserId: string, ownerUserId: string): Promise<Relation> {
    if (actorUserId === ownerUserId) return 'self';
    const owner = await this.db.tx((tx) =>
      tx.employee.findFirst({ where: { userId: ownerUserId }, select: { id: true } }),
    );
    if (!owner) return 'other';
    return (await this.relationsToEmployees(actorUserId, [owner.id])).get(owner.id) ?? 'other';
  }

  async relationsToEmployees(
    actorUserId: string,
    employeeIds: readonly string[],
  ): Promise<Map<string, Relation>> {
    const ids = [...new Set(employeeIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db.tx(
      (tx) => tx.$queryRaw<Row[]>`
      WITH RECURSIVE actor AS (
        SELECT id, department_id FROM employee WHERE user_id = ${actorUserId}::uuid LIMIT 1
      ),
      up(target_id, ancestor_id) AS (
        SELECT e.id, e.manager_id FROM employee e
         WHERE e.id = ANY(${ids}::uuid[]) AND e.manager_id IS NOT NULL
        UNION
        SELECT up.target_id, e.manager_id FROM up JOIN employee e ON e.id = up.ancestor_id
         WHERE e.manager_id IS NOT NULL
      )
      SELECT t.id,
        CASE
          WHEN t.id = a.id THEN 'self'
          WHEN t.manager_id = a.id THEN 'direct_report'
          WHEN EXISTS (SELECT 1 FROM up WHERE up.target_id = t.id AND up.ancestor_id = a.id)
            THEN 'subordinate'
          WHEN a.department_id IS NOT NULL AND t.department_id = a.department_id
            THEN 'same_department'
          ELSE 'other'
        END AS relation
        FROM employee t CROSS JOIN actor a
       WHERE t.id = ANY(${ids}::uuid[])`,
    );
    return new Map(rows.map((row) => [row.id, row.relation]));
  }
}
