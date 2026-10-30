import { Injectable } from '@nestjs/common';
import type { UserSummary } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InvitationService } from '../auth/invitation.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { SessionService } from '../auth/session.service.js';
import { PermissionsService } from '../roles/permissions.service.js';
import { ADMIN_POWER, UserRolesService } from '../roles/user-roles.service.js';

const USER_SELECT = {
  id: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: { role: { select: { id: true, key: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type UserRow = {
  id: string;
  email: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: { role: { id: string; key: string | null; name: string } }[];
};

const toSummary = (user: UserRow): UserSummary => ({
  id: user.id,
  email: user.email,
  status: user.status as UserSummary['status'],
  roles: user.roles.map(({ role }) => role),
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

const notFound = () => new AppException('NOT_FOUND', { message: 'User not found' });

/** Account administration: who exists, what roles they hold, who is disabled (docs/adr/0003). */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly invitations: InvitationService,
    private readonly userRoles: UserRolesService,
    private readonly permissions: PermissionsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  listUsers(): Promise<UserSummary[]> {
    return this.db.tx(async (tx) => {
      const users = await tx.user.findMany({
        select: USER_SELECT,
        orderBy: { email: 'asc' },
        take: 1000,
      });
      return users.map(toSummary);
    });
  }

  /** HR may invite Employees; any other role needs the right to assign roles (Admin). */
  invite(actor: RequestAuth, email: string, requestedRoleIds?: string[]): Promise<UserSummary> {
    return this.db.tx(async (tx) => {
      await this.begin(tx, actor, { lock: false });
      const employeeRoleId = await this.userRoles.roleIdByKey(tx, 'employee');
      const roleIds = [...new Set(requestedRoleIds ?? [employeeRoleId])];
      if (roleIds.some((id) => id !== employeeRoleId)) await this.authz.assert(actor, ADMIN_POWER);
      await this.userRoles.assertMayAssign(tx, actor, roleIds);

      const { userId } = await this.invitations.invite(tx, email, roleIds);
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'user.invited',
        entity: 'user',
        entityId: userId,
        after: { roleIds },
      });
      return this.summary(tx, userId);
    });
  }

  setRoles(actor: RequestAuth, userId: string, roleIds: string[]): Promise<UserSummary> {
    return this.db.tx(async (tx) => {
      await this.begin(tx, actor, { lock: true });
      const user = await this.findUser(tx, userId);
      const before = user.roles.map((r) => r.role.id).sort();
      const after = [...new Set(roleIds)].sort();
      await this.userRoles.assertRolesExist(tx, after);
      await this.userRoles.assertMayAssign(
        tx,
        actor,
        after.filter((id) => !before.includes(id)),
      );

      const wasAdministrator = user.status === 'active' && (await this.holdsAdminPower(tx, userId));
      await this.userRoles.setRoles(tx, userId, after);
      // Checked after the change: if this removed an administrator, someone else must remain (the whole
      // transaction rolls back otherwise).
      if (wasAdministrator && !(await this.holdsAdminPower(tx, userId))) {
        await this.assertAnotherAdministrator(tx, userId);
      }
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'user.roles_changed',
        entity: 'user',
        entityId: userId,
        before: { roleIds: before },
        after: { roleIds: after },
      });
      if (before.join() !== after.join()) {
        // Tell the person, in the same transaction as the change (they get it only if the change is kept).
        const roles = await tx.role.findMany({
          where: { id: { in: after } },
          select: { name: true },
          orderBy: { name: 'asc' },
        });
        await this.outbox.publish(tx, 'user.roles_changed', {
          userId,
          roleNames: roles.map((role) => role.name),
        });
      }
      return this.summary(tx, userId);
    });
  }

  disable(actor: RequestAuth, userId: string): Promise<UserSummary> {
    return this.db.tx(async (tx) => {
      await this.disableInTx(tx, actor, userId);
      return this.summary(tx, userId);
    });
  }

  enable(actor: RequestAuth, userId: string): Promise<UserSummary> {
    return this.db.tx(async (tx) => {
      await this.enableInTx(tx, actor, userId);
      return this.summary(tx, userId);
    });
  }

  /** Disables an account inside the caller's transaction (also used when an employee is deactivated). */
  async disableInTx(tx: TenantTx, actor: RequestAuth, userId: string): Promise<void> {
    if (userId === actor.userId) {
      throw new AppException('CANNOT_DISABLE_SELF', {
        message: 'You cannot disable your own account',
      });
    }
    await this.begin(tx, actor, { lock: true });
    const user = await this.findUser(tx, userId);
    await this.assertMayManageAdministrator(tx, actor, userId);
    if (user.status === 'disabled') return;

    if (user.status === 'active' && (await this.holdsAdminPower(tx, userId))) {
      await this.assertAnotherAdministrator(tx, userId);
    }
    await tx.user.update({ where: { id: userId }, data: { status: 'disabled' } });
    // Signed in right now? Not for long: every session ends immediately.
    await this.sessions.revokeAllForUser(tx, userId);
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: 'user.disabled',
      entity: 'user',
      entityId: userId,
      before: { status: user.status },
      after: { status: 'disabled' },
    });
  }

  /** Re-enables an account inside the caller's transaction (also used when an employee is reactivated). */
  async enableInTx(tx: TenantTx, actor: RequestAuth, userId: string): Promise<void> {
    await this.begin(tx, actor, { lock: false });
    const user = await this.findUser(tx, userId);
    await this.assertMayManageAdministrator(tx, actor, userId);
    if (user.status !== 'disabled') return;

    // Someone who never finished their invitation goes back to "invited"; everyone else to "active".
    const identities = await tx.authIdentity.count({ where: { userId } });
    const status = identities > 0 ? 'active' : 'invited';
    await tx.user.update({ where: { id: userId }, data: { status } });
    await this.audit.record(tx, {
      actorUserId: actor.userId,
      action: 'user.enabled',
      entity: 'user',
      entityId: userId,
      before: { status: 'disabled' },
      after: { status },
    });
  }

  // ----- helpers ------------------------------------------------------------------------------

  /**
   * Start of every change: optionally queue behind other administrator changes, then make sure the actor is
   * still an active user (they may have been disabled while this request waited for the lock).
   */
  private async begin(tx: TenantTx, actor: RequestAuth, options: { lock: boolean }): Promise<void> {
    if (options.lock) await this.lockAdministrators(tx);
    const current = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { status: true },
    });
    if (current?.status !== 'active') {
      throw new AppException('UNAUTHENTICATED', { message: 'Your account is no longer active' });
    }
  }

  private async findUser(tx: TenantTx, userId: string): Promise<UserRow> {
    // Row Level Security hides other workspaces' users, so a foreign id is simply "not found".
    const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw notFound();
    return user;
  }

  private async summary(tx: TenantTx, userId: string): Promise<UserSummary> {
    return toSummary(await this.findUser(tx, userId));
  }

  private lockAdministrators(tx: TenantTx): Promise<void> {
    return this.userRoles.lockAdministrators(tx);
  }

  private async holdsAdminPower(tx: TenantTx, userId: string): Promise<boolean> {
    const { permissions } = await this.permissions.forUser(tx, userId);
    return permissions[ADMIN_POWER] !== undefined;
  }

  /** Active users, other than the given one, who can still assign roles. */
  private async assertAnotherAdministrator(tx: TenantTx, excludeUserId: string): Promise<void> {
    if ((await this.userRoles.countAdministrators(tx, excludeUserId)) === 0) {
      throw new AppException('LAST_ADMIN', {
        message: 'The workspace must keep at least one active administrator',
      });
    }
  }

  /** Administrators can only be disabled or re-enabled by someone who can assign roles (not by HR). */
  private async assertMayManageAdministrator(
    tx: TenantTx,
    actor: RequestAuth,
    targetUserId: string,
  ): Promise<void> {
    if (await this.holdsAdminPower(tx, targetUserId)) await this.authz.assert(actor, ADMIN_POWER);
  }
}
