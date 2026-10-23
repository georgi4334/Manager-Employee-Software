import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SystemRole } from '@intime/contracts';
import request from 'supertest';
import { expect } from 'vitest';
import { MAILER } from '../../src/infrastructure/mail/mailer.js';
import type { MemoryMailer } from '../../src/infrastructure/mail/memory.mailer.js';
import { TenantProvisioningService } from '../../src/modules/tenants/tenant-provisioning.service.js';

export const PASSWORD = 'correct horse battery staple';

export type Agent = ReturnType<typeof request.agent>;

export interface Member {
  agent: Agent;
  id: string;
  email: string;
}

export interface Workspace {
  tenantId: string;
  admin: Member;
  roleIds: Record<SystemRole, string>;
}

/**
 * Helpers for HTTP tests: workspaces whose people are signed in with real cookies. Every agent gets its
 * own client IP so per-IP rate limits of one test never affect another.
 */
export function httpWorkspaceHelpers(getApp: () => NestExpressApplication) {
  let nextIp = 0;
  const agent = (): Agent => {
    nextIp += 1;
    return request
      .agent(getApp().getHttpServer())
      .set('X-Forwarded-For', `10.3.${nextIp >> 8}.${nextIp & 255}`);
  };

  const mailer = () => getApp().get(MAILER) as MemoryMailer;

  const tokenFor = (email: string): string => {
    const message = [...mailer().sent].reverse().find((m) => m.to === email);
    const link = message?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
    return new URL(link).searchParams.get('token') ?? '';
  };

  async function accept(email: string): Promise<Member> {
    const member = agent();
    const res = await member
      .post('/api/v1/auth/invitations/accept')
      .send({ token: tokenFor(email), password: PASSWORD });
    expect(res.status).toBe(200);
    return { agent: member, id: res.body.id as string, email };
  }

  async function workspace(slug: string, adminEmail = `admin@${slug}.eu`): Promise<Workspace> {
    const { tenantId } = await getApp()
      .get(TenantProvisioningService)
      .create({ name: `${slug} GmbH`, slug, adminEmail });
    const admin = await accept(adminEmail);
    const roles = (await admin.agent.get('/api/v1/roles')).body as { id: string; key: string }[];
    const roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id])) as Record<
      SystemRole,
      string
    >;
    return { tenantId, admin, roleIds };
  }

  /** The admin invites somebody with a role and they accept: returns their signed-in session. */
  async function member(
    ws: Workspace,
    email: string,
    role: SystemRole = 'employee',
  ): Promise<Member> {
    const res = await ws.admin.agent
      .post('/api/v1/users/invitations')
      .send({ email, roleIds: [ws.roleIds[role]] });
    expect(res.status).toBe(201);
    return accept(email);
  }

  return { agent, tokenFor, accept, workspace, member, mailer };
}
