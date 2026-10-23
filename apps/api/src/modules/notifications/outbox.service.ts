import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { OutboxWorker } from './delivery/outbox-worker.service.js';
import { EVENT_DEFINITIONS, type EventParams, type EventType } from './events.js';

@Injectable()
export class OutboxService {
  constructor(
    private readonly db: TenantDb,
    private readonly worker: OutboxWorker,
  ) {}

  /**
   * Records that something happened, inside the caller's transaction: if the change is rolled back, so is the
   * event. After the commit the worker is woken to deliver notifications. Parameters are validated here, so a
   * mistake fails the change loudly instead of producing a broken event later.
   */
  async publish<T extends EventType>(tx: TenantTx, type: T, params: EventParams<T>): Promise<void> {
    const parsed = EVENT_DEFINITIONS[type].params.parse(params) as Prisma.InputJsonValue;
    // createMany: the application role may insert events but not read them back (no RETURNING).
    await tx.outboxEvent.createMany({ data: [{ type, params: parsed }] });
    this.db.afterCommit(() => this.worker.wake());
  }
}
