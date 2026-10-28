import { Injectable } from '@nestjs/common';
import {
  DEFAULT_DASHBOARD,
  normalizeLayout,
  type DashboardLayout,
  type DashboardLayoutRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';

/** The workspace dashboard layout (docs/adr/0034-dashboard.md). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  layout(actor: RequestAuth): Promise<DashboardLayout> {
    return this.db.tx((tx) => this.read(tx, actor));
  }

  update(actor: RequestAuth, body: DashboardLayoutRequest): Promise<DashboardLayout> {
    return this.db.tx(async (tx) => {
      const widgets = normalizeLayout(body.widgets);
      const current = await tx.dashboardLayout.findFirst({ select: { id: true } });
      if (current)
        await tx.dashboardLayout.update({ where: { id: current.id }, data: { widgets } });
      else await tx.dashboardLayout.create({ data: { widgets } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'dashboard.updated',
        entity: 'dashboard_layout',
        after: { widgets },
      });
      return this.read(tx, actor);
    });
  }

  reset(actor: RequestAuth): Promise<DashboardLayout> {
    return this.db.tx(async (tx) => {
      const removed = await tx.dashboardLayout.deleteMany({});
      if (removed.count > 0) {
        await this.audit.record(tx, {
          actorUserId: actor.userId,
          action: 'dashboard.reset',
          entity: 'dashboard_layout',
        });
      }
      return this.read(tx, actor);
    });
  }

  private async read(tx: TenantTx, actor: RequestAuth): Promise<DashboardLayout> {
    const row = await tx.dashboardLayout.findFirst({ select: { widgets: true } });
    return {
      widgets: row ? normalizeLayout(row.widgets) : [...DEFAULT_DASHBOARD],
      isDefault: !row,
      canEdit: Boolean(actor.permissions['admin.tenant.settings']),
    };
  }
}
