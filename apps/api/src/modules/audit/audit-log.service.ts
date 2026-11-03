import { Injectable } from '@nestjs/common';
import {
  AUDIT_AREAS,
  addDays,
  auditAreaOf,
  visibleAuditAreas,
  zonedToUtc,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
  type DateString,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';

/**
 * Reads the audit log (docs/adr/0041-audit-log-viewer.md). A reader sees only the areas they administer
 * (`visibleAuditAreas`); entries outside the catalog are never shown. Read-only: nothing here writes.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
  ) {}

  list(actor: RequestAuth, query: AuditQuery): Promise<AuditPage> {
    const areas = visibleAuditAreas(actor.permissions);
    if (areas.length === 0) throw new AppException('FORBIDDEN');
    // An area the reader may not see answers like an empty one would not: it is refused outright.
    if (query.area && !areas.includes(query.area)) throw new AppException('FORBIDDEN');
    const actions = (query.area ? [query.area] : areas).flatMap((a) => [...AUDIT_AREAS[a].actions]);

    return this.db.tx(async (tx) => {
      const zone = await this.zone(tx);
      const createdAt = {
        ...(query.from ? { gte: startOf(query.from, zone) } : {}),
        ...(query.to ? { lt: startOf(addDays(query.to, 1), zone) } : {}),
      };
      const where = {
        action: { in: actions },
        ...(query.from || query.to ? { createdAt } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.auditLog.count({ where }),
      ]);

      // Names are looked up now (never stored in the log), so an erased person shows as erased.
      const userIds = [...new Set(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
      const subjectIds = [
        ...new Set(
          rows.flatMap((r) => (r.entity === 'employee' && r.entityId ? [r.entityId] : [])),
        ),
      ];
      const people =
        userIds.length + subjectIds.length === 0
          ? []
          : await tx.employee.findMany({
              where: { OR: [{ userId: { in: userIds } }, { id: { in: subjectIds } }] },
              select: { id: true, userId: true, firstName: true, lastName: true, erasedAt: true },
            });
      const nameOf = (p: (typeof people)[number]) =>
        p.erasedAt ? null : `${p.firstName} ${p.lastName}`;
      const byUser = new Map(people.flatMap((p) => (p.userId ? [[p.userId, p] as const] : [])));
      const byId = new Map(people.map((p) => [p.id, p] as const));

      const items = rows.map((row): AuditEntry => {
        const person = row.actorUserId ? byUser.get(row.actorUserId) : undefined;
        const subject = row.entity === 'employee' && row.entityId ? byId.get(row.entityId) : null;
        return {
          id: row.id,
          at: row.createdAt.toISOString(),
          action: row.action,
          // `where` only matches catalog actions, so every row has an area.
          area: auditAreaOf(row.action)!,
          entity: row.entity,
          entityId: row.entityId,
          actor: {
            userId: row.actorUserId,
            name: person ? nameOf(person) : null,
            employeeId: person && !person.erasedAt ? person.id : null,
          },
          subject: row.entity === 'employee' ? { name: subject ? nameOf(subject) : null } : null,
          before: row.before ?? null,
          after: row.after ?? null,
        };
      });
      return { items, total, page: query.page, pageSize: query.pageSize, areas };
    });
  }

  private async zone(tx: TenantTx): Promise<string> {
    const tenant = await tx.tenant.findUnique({
      where: { id: this.context.requireTenantId() },
      select: { defaultTimezone: true },
    });
    return tenant?.defaultTimezone ?? 'UTC';
  }
}

/** The first instant of a workspace-local day (a midnight inside a DST gap starts at 01:00). */
function startOf(date: DateString, zone: string): Date {
  return (
    zonedToUtc(date, '00:00', zone) ??
    zonedToUtc(date, '01:00', zone) ??
    new Date(`${date}T00:00:00Z`)
  );
}
