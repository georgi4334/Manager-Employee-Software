import { Injectable } from '@nestjs/common';
import {
  WORKSPACE_LANGUAGES,
  type UpdateWorkspaceSettingsRequest,
  type WorkspaceLanguage,
  type WorkspaceSettings,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';

const isLanguage = (value: string): value is WorkspaceLanguage =>
  (WORKSPACE_LANGUAGES as readonly string[]).includes(value);

/**
 * The caller's own workspace settings (docs/adr/0043-workspace-settings.md). The tenant row is only ever addressed by
 * the request's tenant id, and the `tenant_self_update` RLS policy refuses any other row.
 */
@Injectable()
export class WorkspaceSettingsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
  ) {}

  get(actor: RequestAuth): Promise<WorkspaceSettings> {
    return this.db.tx((tx) => this.read(tx, actor));
  }

  update(actor: RequestAuth, body: UpdateWorkspaceSettingsRequest): Promise<WorkspaceSettings> {
    // The route permission says "at some scope"; workspace settings are workspace-wide.
    if (!canEdit(actor)) throw new AppException('FORBIDDEN');
    return this.db.tx(async (tx) => {
      const id = this.context.requireTenantId();
      const before = await this.read(tx, actor);
      const changed: string[] = [];
      const tenant: { name?: string; defaultTimezone?: string; defaultLocale?: string } = {};
      if (body.name !== undefined && body.name !== before.name) {
        tenant.name = body.name;
        changed.push('name');
      }
      if (body.timeZone !== undefined && body.timeZone !== before.timeZone) {
        tenant.defaultTimezone = body.timeZone;
        changed.push('timeZone');
      }
      if (body.language !== undefined && body.language !== before.language) {
        tenant.defaultLocale = body.language;
        changed.push('language');
      }
      if (Object.keys(tenant).length > 0) {
        await tx.tenant.update({ where: { id }, data: tenant });
      }
      if (body.country !== undefined && body.country !== before.country) {
        await this.leaveSettings(tx);
        await tx.leaveSettings.update({
          where: { tenantId: id },
          data: { defaultCountry: body.country },
        });
        changed.push('country');
      }
      if (changed.length === 0) return before;
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'workspace.updated',
        entity: 'tenant',
        entityId: id,
        after: { fields: changed },
      });
      return this.read(tx, actor);
    });
  }

  private async read(tx: TenantTx, actor: RequestAuth): Promise<WorkspaceSettings> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: this.context.requireTenantId() },
      select: { name: true, slug: true, defaultTimezone: true, defaultLocale: true },
    });
    const settings = await this.leaveSettings(tx);
    return {
      name: tenant.name,
      slug: tenant.slug,
      timeZone: tenant.defaultTimezone,
      language: isLanguage(tenant.defaultLocale) ? tenant.defaultLocale : 'en',
      country: settings.defaultCountry,
      canEdit: canEdit(actor),
    };
  }

  /** The leave settings row is created on first use (like LeaveSettingsService). */
  private async leaveSettings(tx: TenantTx) {
    return (
      (await tx.leaveSettings.findFirst({ select: { defaultCountry: true } })) ??
      (await tx.leaveSettings.create({ data: {}, select: { defaultCountry: true } }))
    );
  }
}

function canEdit(actor: RequestAuth): boolean {
  return actor.permissions['admin.tenant.settings'] === 'all';
}
