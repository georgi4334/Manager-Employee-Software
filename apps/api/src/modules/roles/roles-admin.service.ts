import { Injectable } from '@nestjs/common';
import {
  MAX_CUSTOM_ROLES,
  PERMISSIONS,
  diffGrants,
  escalations,
  isPermissionCode,
  isValidGrant,
  wouldCycle,
  type Grant,
  type PermissionScope,
  type RoleDetail,
  type RoleListItem,
  type RoleRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ADMIN_POWER, UserRolesService } from './user-roles.service.js';

/** `code:scope`: permission codes are not personal data and say what changed. */
const label = (g: Grant): string => `${g.code}:${g.scope}`;

const notFound = () => new AppException('NOT_FOUND', { message: 'Role not found' });

/** Modules in catalog order, so every list says them the same way. */
const MODULE_ORDER = [...new Set(PERMISSIONS.map((p) => p.module))];
const modulesOf = (codes: readonly string[]): string[] => {
  const covered = new Set(
    codes.filter(isPermissionCode).map((code) => PERMISSIONS.find((p) => p.code === code)!.module),
  );
  return MODULE_ORDER.filter((m) => covered.has(m));
};

const badParent = (code: 'role_cycle' | 'unknown_role', message: string) =>
  new AppException('VALIDATION_FAILED', { details: [{ path: 'parentId', code, message }] });

/**
 * Custom roles (docs/adr/0031-role-editor.md): create, change, delete. System roles are read-only; nobody grants
 * what they do not hold; a change can never remove the last administrator.
 */
@Injectable()
export class RolesAdminService {
  constructor(
    private readonly db: TenantDb,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly userRoles: UserRolesService,
  ) {}

  list(): Promise<RoleListItem[]> {
    return this.db.tx(async (tx) => {
      const roles = await tx.role.findMany({
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          isSystem: true,
          parentId: true,
          permissions: { select: { permissionCode: true } },
          _count: { select: { permissions: true, users: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return roles.map(({ _count, permissions, ...role }) => ({
        ...role,
        permissionCount: _count.permissions,
        userCount: _count.users,
        modules: modulesOf(permissions.map((p) => p.permissionCode)),
      }));
    });
  }

  get(id: string): Promise<RoleDetail> {
    return this.db.tx((tx) => this.detail(tx, id));
  }

  create(actor: RequestAuth, body: RoleRequest): Promise<RoleDetail> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'admin.role.manage');
      const custom = await tx.role.count({ where: { isSystem: false } });
      if (custom >= MAX_CUSTOM_ROLES) {
        throw new AppException('CONFLICT', {
          message: 'Too many custom roles',
          params: { field: 'limit' },
        });
      }
      await this.assertNameFree(tx, body.name);
      this.assertNoEscalation(actor, [], body.grants);
      const parentId = body.parentId ?? null;
      if (parentId !== null) {
        await this.lockTree(tx);
        await this.assertParentExists(tx, parentId);
      }
      const role = await tx.role.create({
        data: {
          parentId,
          name: body.name,
          description: body.description ?? null,
          isSystem: false,
          permissions: {
            create: body.grants.map((g) => ({ permissionCode: g.code, scope: g.scope })),
          },
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'role.created',
        entity: 'role',
        entityId: role.id,
        after: { grants: body.grants.map(label), parentId },
      });
      return this.detail(tx, role.id);
    });
  }

  update(actor: RequestAuth, id: string, body: RoleRequest): Promise<RoleDetail> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'admin.role.manage');
      // Queue behind every other change that can remove an administrator.
      await this.userRoles.lockAdministrators(tx);
      const current = await this.detail(tx, id);
      if (current.isSystem) {
        throw new AppException('FORBIDDEN', { message: 'System roles cannot be changed' });
      }
      await this.assertNameFree(tx, body.name, id);
      this.assertNoEscalation(actor, current.grants, body.grants);
      const diff = diffGrants(current.grants, body.grants);
      await tx.role.update({
        where: { id },
        data: { name: body.name, description: body.description ?? null },
      });
      if (body.parentId !== undefined && body.parentId !== current.parentId) {
        await this.placeInTree(tx, actor, id, current.parentId, body.parentId);
      }
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (body.grants.length > 0) {
        await tx.rolePermission.createMany({
          data: body.grants.map((g) => ({ roleId: id, permissionCode: g.code, scope: g.scope })),
        });
      }
      if (diff.removed.some((g) => g.code === ADMIN_POWER)) {
        if ((await this.userRoles.countAdministrators(tx)) === 0) {
          throw new AppException('LAST_ADMIN', {
            message: 'The workspace must keep at least one active administrator',
          });
        }
      }
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'role.updated',
        entity: 'role',
        entityId: id,
        after: {
          added: diff.added.map(label),
          changed: diff.changed.map(label),
          removed: diff.removed.map(label),
        },
      });
      return this.detail(tx, id);
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'admin.role.manage');
      const role = await this.detail(tx, id);
      if (role.isSystem) {
        throw new AppException('FORBIDDEN', { message: 'System roles cannot be deleted' });
      }
      if (role.userCount > 0) {
        throw new AppException('CONFLICT', {
          message: 'The role is still assigned to users',
          params: { field: 'in_use' },
        });
      }
      // Sub-roles move up to the deleted role's own parent (docs/adr/0036-role-hierarchy.md).
      await this.lockTree(tx);
      await tx.role.updateMany({ where: { parentId: id }, data: { parentId: role.parentId } });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'role.deleted',
        entity: 'role',
        entityId: id,
      });
    });
  }

  /** Where a role sits in the tree. Display only: any role, system roles included; grants never change. */
  move(actor: RequestAuth, id: string, parentId: string | null): Promise<RoleDetail> {
    return this.db.tx(async (tx) => {
      await this.authz.assert(actor, 'admin.role.manage');
      const current = await this.detail(tx, id);
      if (current.parentId !== parentId) {
        await this.placeInTree(tx, actor, id, current.parentId, parentId);
      }
      return this.detail(tx, id);
    });
  }

  // ----- helpers ------------------------------------------------------------------------------

  /** Serializes tree changes of one workspace, so two moves cannot build a cycle together. */
  private async lockTree(tx: TenantTx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('role-tree:' || app_current_tenant()::text))`;
  }

  private async assertParentExists(tx: TenantTx, parentId: string): Promise<void> {
    const found = await tx.role.count({ where: { id: parentId } });
    if (found === 0) throw badParent('unknown_role', 'Unknown parent role');
  }

  private async placeInTree(
    tx: TenantTx,
    actor: RequestAuth,
    id: string,
    from: string | null,
    to: string | null,
  ): Promise<void> {
    await this.lockTree(tx);
    if (to !== null) {
      await this.assertParentExists(tx, to);
      const all = await tx.role.findMany({ select: { id: true, parentId: true } });
      if (wouldCycle(all, id, to)) {
        throw badParent('role_cycle', 'A role cannot sit under itself or one of its sub-roles');
      }
    }
    await tx.role.update({ where: { id }, data: { parentId: to } });
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: 'role.moved',
      entity: 'role',
      entityId: id,
      before: { parentId: from },
      after: { parentId: to },
    });
  }

  /** Another workspace's role is simply not found (Row Level Security). Invalid stored grants are left out. */
  private async detail(tx: TenantTx, id: string): Promise<RoleDetail> {
    const role = await tx.role.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        parentId: true,
        permissions: { select: { permissionCode: true, scope: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw notFound();
    const grants: Grant[] = role.permissions
      .filter((g) => isValidGrant(g.permissionCode, g.scope))
      .map((g) => ({ code: g.permissionCode, scope: g.scope as PermissionScope }))
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      grants,
      userCount: role._count.users,
      parentId: role.parentId,
    };
  }

  private async assertNameFree(tx: TenantTx, name: string, exceptId?: string): Promise<void> {
    const same = await tx.role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (same) {
      throw new AppException('CONFLICT', {
        message: 'A role with this name exists',
        params: { field: 'name' },
      });
    }
  }

  private assertNoEscalation(
    actor: RequestAuth,
    current: readonly Grant[],
    requested: readonly Grant[],
  ): void {
    const bad = escalations(actor.permissions, current, requested);
    if (bad.length > 0) {
      throw new AppException('FORBIDDEN', {
        message: 'You cannot grant permissions you do not hold',
        details: bad.map((g) => ({
          path: `grants.${g.code}`,
          code: 'cannot_grant',
          message: 'You do not hold this permission at this scope',
        })),
      });
    }
  }
}
