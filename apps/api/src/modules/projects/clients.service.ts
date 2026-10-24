import { Injectable } from '@nestjs/common';
import type {
  Client,
  ClientList,
  CreateClientRequest,
  UpdateClientRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { conflict, guardUnique, notFound } from './projects.shared.js';

/** Clients of the company (docs/adr/0013-clients-and-projects.md). Never deleted, only archived. */
@Injectable()
export class ClientsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<ClientList> {
    return this.db.tx(async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.client.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }] }),
        tx.project.groupBy({ by: ['clientId'], _count: { _all: true } }),
      ]);
      const count = new Map(counts.map((c) => [c.clientId, c._count._all]));
      return { items: rows.map((row) => present(row, count.get(row.id) ?? 0)) };
    });
  }

  create(actor: RequestAuth, body: CreateClientRequest): Promise<Client> {
    return this.db.tx(async (tx) => {
      await this.assertNameFree(tx, body.name);
      const row = await guardUnique(
        () =>
          tx.client.create({
            data: {
              name: body.name,
              contactName: body.contactName ?? null,
              contactEmail: body.contactEmail ?? null,
              notes: body.notes ?? null,
            },
          }),
        'name',
      );
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'client.created',
        entity: 'client',
        entityId: row.id,
      });
      return present(row, 0);
    });
  }

  update(actor: RequestAuth, id: string, body: UpdateClientRequest): Promise<Client> {
    return this.db.tx(async (tx) => {
      const current = await tx.client.findUnique({ where: { id } });
      if (!current) throw notFound('Client');
      if (body.name !== undefined) await this.assertNameFree(tx, body.name, id);
      const row = await guardUnique(() => tx.client.update({ where: { id }, data: body }), 'name');
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'client.updated',
        entity: 'client',
        entityId: id,
        after: { fields: Object.keys(body).sort() },
      });
      const projects = await tx.project.count({ where: { clientId: id } });
      return present(row, projects);
    });
  }

  private async assertNameFree(tx: TenantTx, name: string, exceptId?: string): Promise<void> {
    const clash = await tx.client.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw conflict('name', 'A client with this name already exists');
  }
}

const present = (
  row: {
    id: string;
    name: string;
    contactName: string | null;
    contactEmail: string | null;
    notes: string | null;
    status: string;
  },
  projectCount: number,
): Client => ({
  id: row.id,
  name: row.name,
  contactName: row.contactName,
  contactEmail: row.contactEmail,
  notes: row.notes,
  status: row.status as Client['status'],
  projectCount,
});
