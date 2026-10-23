import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  NOTIFICATION_TYPE_KEYS,
  apiErrorBodySchema,
  notificationListSchema,
  notificationPreferenceSchema,
} from '@intime/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorCode = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error.code;

describe.skipIf(!urls)('inbox and notification preferences over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { agent, workspace, member, mailer } = httpWorkspaceHelpers(() => app);

  /** Admin changes the person's role; the worker delivers the resulting notification. */
  async function changeRoles(
    ws: Workspace,
    who: Member,
    ...keys: ('employee' | 'manager' | 'hr')[]
  ) {
    const res = await ws.admin.agent
      .put(`/api/v1/users/${who.id}/roles`)
      .send({ roleIds: keys.map((k) => ws.roleIds[k]) });
    expect(res.status).toBe(200);
    await app.get(OutboxWorker).runOnce();
  }

  const give = (tenantId: string, userId: string, name: string, data: object = {}) =>
    system.notification.create({
      data: {
        tenantId,
        recipientUserId: userId,
        type: 'account.roles_changed',
        params: { roleNames: [name] },
        link: '/notifications',
        ...data,
      },
    });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });
  beforeEach(async () => {
    await system.tenant.deleteMany();
    mailer().clear();
  });

  describe('access', () => {
    it.each([
      ['get', '/api/v1/notifications'],
      ['get', '/api/v1/notifications/unread-count'],
      ['post', '/api/v1/notifications/read-all'],
      ['post', '/api/v1/notifications/0192f5a0-0000-7000-8000-00000000000a/read'],
      ['get', '/api/v1/notifications/preferences'],
      ['put', '/api/v1/notifications/preferences'],
    ] as const)('%s %s needs a signed-in user', async (method, path) => {
      const res = await agent()[method](path).send({});
      expect([res.status, errorCode(res)]).toEqual([401, 'UNAUTHENTICATED']);
    });

    it('rejects writes sent from another website (CSRF)', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent
        .post('/api/v1/notifications/read-all')
        .set('Origin', 'https://evil.example');
      expect([res.status, errorCode(res)]).toEqual([403, 'FORBIDDEN']);
    });
  });

  describe('the real flow: an administrator changes someone’s roles', () => {
    it('the person finds a notification in their inbox and an email in their mailbox; the administrator gets none', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      mailer().clear();

      await changeRoles(ws, maria, 'hr');

      const inbox = await maria.agent.get('/api/v1/notifications');
      expect(inbox.status).toBe(200);
      const list = notificationListSchema.parse(inbox.body);
      expect(list.unreadCount).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        type: 'account.roles_changed',
        params: { roleNames: ['HR'] },
        link: '/notifications',
        readAt: null,
      });
      expect(list.nextCursor).toBeNull();

      expect(mailer().sent.map((m) => m.to)).toEqual(['maria@acme.eu']);
      expect((await ws.admin.agent.get('/api/v1/notifications')).body.items).toEqual([]);
    });

    it('nothing happens when the roles stay the same', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      await changeRoles(ws, maria, 'employee');
      expect((await maria.agent.get('/api/v1/notifications/unread-count')).body).toEqual({
        unreadCount: 0,
      });
    });
  });

  describe('GET /notifications', () => {
    it('is empty for someone with no notifications', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.get('/api/v1/notifications');
      expect(res.body).toEqual({ items: [], unreadCount: 0, nextCursor: null });
    });

    it('lists newest first and pages with a cursor, without gaps or repeats', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      for (let i = 1; i <= 5; i++) await give(ws.tenantId, maria.id, `n${i}`);

      const names = (list: { items: { params: { roleNames: string[] } }[] }) =>
        list.items.map((n) => n.params.roleNames[0]);
      const page1 = notificationListSchema.parse(
        (await maria.agent.get('/api/v1/notifications?limit=2')).body,
      );
      expect(names(page1 as never)).toEqual(['n5', 'n4']);
      expect(page1.unreadCount).toBe(5);
      expect(page1.nextCursor).toBe(page1.items[1]?.id);

      const page2 = notificationListSchema.parse(
        (await maria.agent.get(`/api/v1/notifications?limit=2&before=${page1.nextCursor}`)).body,
      );
      expect(names(page2 as never)).toEqual(['n3', 'n2']);

      const page3 = notificationListSchema.parse(
        (await maria.agent.get(`/api/v1/notifications?limit=2&before=${page2.nextCursor}`)).body,
      );
      expect(names(page3 as never)).toEqual(['n1']);
      expect(page3.nextCursor).toBeNull();
    });

    it('can show only unread notifications', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      await give(ws.tenantId, maria.id, 'read', { readAt: new Date() });
      await give(ws.tenantId, maria.id, 'unread');
      const res = await maria.agent.get('/api/v1/notifications?unreadOnly=true');
      expect(
        res.body.items.map((n: { params: { roleNames: string[] } }) => n.params.roleNames[0]),
      ).toEqual(['unread']);
      expect(res.body.unreadCount).toBe(1);
    });

    it.each(['limit=0', 'limit=51', 'limit=abc', 'before=not-a-uuid', 'unreadOnly=maybe'])(
      'rejects the query %s',
      async (query) => {
        const ws = await workspace('acme');
        const res = await ws.admin.agent.get(`/api/v1/notifications?${query}`);
        expect([res.status, errorCode(res)]).toEqual([400, 'VALIDATION_FAILED']);
      },
    );

    it('never shows a colleague’s or another workspace’s notifications, and hides entries meant for email only', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      const maria = await member(acme, 'maria@acme.eu');
      const ivan = await member(acme, 'ivan@acme.eu');
      const emma = await member(beta, 'emma@beta.eu');
      await give(acme.tenantId, maria.id, 'for-maria');
      await give(acme.tenantId, ivan.id, 'for-ivan');
      await give(beta.tenantId, emma.id, 'for-emma');
      await give(acme.tenantId, maria.id, 'email-only', { inApp: false });

      const seen = async (who: Member) =>
        (await who.agent.get('/api/v1/notifications')).body.items.map(
          (n: { params: { roleNames: string[] } }) => n.params.roleNames[0],
        );
      expect(await seen(maria)).toEqual(['for-maria']);
      expect(await seen(ivan)).toEqual(['for-ivan']);
      expect(await seen(emma)).toEqual(['for-emma']);
      expect((await maria.agent.get('/api/v1/notifications/unread-count')).body.unreadCount).toBe(
        1,
      );
    });

    it('passes an unknown (newer) notification type through untouched, so clients can show it generically', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      await give(ws.tenantId, maria.id, 'x', { type: 'future.thing', params: { anything: 1 } });
      const res = await maria.agent.get('/api/v1/notifications');
      expect(res.body.items[0]).toMatchObject({ type: 'future.thing', params: { anything: 1 } });
    });
  });

  describe('marking as read', () => {
    it('marks one notification read, lowers the unread count, and is idempotent', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      const first = await give(ws.tenantId, maria.id, 'a');
      await give(ws.tenantId, maria.id, 'b');

      expect((await maria.agent.post(`/api/v1/notifications/${first.id}/read`)).status).toBe(204);
      expect((await maria.agent.get('/api/v1/notifications/unread-count')).body.unreadCount).toBe(
        1,
      );
      const readAt = (await system.notification.findUniqueOrThrow({ where: { id: first.id } }))
        .readAt;
      expect(readAt).toBeInstanceOf(Date);

      expect((await maria.agent.post(`/api/v1/notifications/${first.id}/read`)).status).toBe(204);
      expect(
        (
          await system.notification.findUniqueOrThrow({ where: { id: first.id } })
        ).readAt?.getTime(),
      ).toBe(readAt?.getTime());
    });

    it('someone else’s notification is "not found" and stays unread', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      const ivan = await member(ws, 'ivan@acme.eu');
      const mine = await give(ws.tenantId, maria.id, 'mine');
      const res = await ivan.agent.post(`/api/v1/notifications/${mine.id}/read`);
      expect([res.status, errorCode(res)]).toEqual([404, 'NOT_FOUND']);
      expect(
        (await system.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt,
      ).toBeNull();
    });

    it('another workspace’s, unknown and malformed ids are rejected', async () => {
      const acme = await workspace('acme');
      const beta = await workspace('beta');
      const emma = await member(beta, 'emma@beta.eu');
      const foreign = await give(beta.tenantId, emma.id, 'foreign');
      for (const id of [foreign.id, '0192f5a0-0000-7000-8000-0000000000ff']) {
        const res = await acme.admin.agent.post(`/api/v1/notifications/${id}/read`);
        expect([res.status, errorCode(res)]).toEqual([404, 'NOT_FOUND']);
      }
      const malformed = await acme.admin.agent.post('/api/v1/notifications/not-a-uuid/read');
      expect([malformed.status, errorCode(malformed)]).toEqual([400, 'VALIDATION_FAILED']);
      expect(
        (await system.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt,
      ).toBeNull();
    });

    it('"read all" marks only my notifications', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      const ivan = await member(ws, 'ivan@acme.eu');
      await give(ws.tenantId, maria.id, 'm1');
      await give(ws.tenantId, maria.id, 'm2');
      await give(ws.tenantId, ivan.id, 'i1');

      const res = await maria.agent.post('/api/v1/notifications/read-all');
      expect([res.status, res.body]).toEqual([200, { updated: 2 }]);
      expect((await maria.agent.get('/api/v1/notifications/unread-count')).body.unreadCount).toBe(
        0,
      );
      expect((await ivan.agent.get('/api/v1/notifications/unread-count')).body.unreadCount).toBe(1);
      expect((await maria.agent.post('/api/v1/notifications/read-all')).body).toEqual({
        updated: 0,
      });
    });
  });

  describe('preferences', () => {
    it('lists every notification type with its channels, marking locked ones', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.get('/api/v1/notifications/preferences');
      expect(res.status).toBe(200);
      const prefs = (res.body as unknown[]).map((p) => notificationPreferenceSchema.parse(p));
      expect(prefs.map((p) => p.type)).toEqual(NOTIFICATION_TYPE_KEYS);
      expect(prefs[0]?.channels).toEqual({
        in_app: { enabled: true, locked: false },
        email: { enabled: true, locked: true },
      });
    });

    it('lets a person switch the inbox off and on again; the change is theirs alone', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      const ivan = await member(ws, 'ivan@acme.eu');
      const off = await maria.agent
        .put('/api/v1/notifications/preferences')
        .send({ type: 'account.roles_changed', channel: 'in_app', enabled: false });
      expect(off.status).toBe(200);
      expect(off.body.channels.in_app).toEqual({ enabled: false, locked: false });

      const mine = (await maria.agent.get('/api/v1/notifications/preferences')).body[0];
      const theirs = (await ivan.agent.get('/api/v1/notifications/preferences')).body[0];
      expect(mine.channels.in_app.enabled).toBe(false);
      expect(theirs.channels.in_app.enabled).toBe(true);

      const on = await maria.agent
        .put('/api/v1/notifications/preferences')
        .send({ type: 'account.roles_changed', channel: 'in_app', enabled: true });
      expect(on.body.channels.in_app.enabled).toBe(true);
      expect(await system.notificationPreference.count({ where: { userId: maria.id } })).toBe(1);
    });

    it('switching the inbox off really stops new entries (the email, which is locked, still arrives)', async () => {
      const ws = await workspace('acme');
      const maria = await member(ws, 'maria@acme.eu');
      await maria.agent
        .put('/api/v1/notifications/preferences')
        .send({ type: 'account.roles_changed', channel: 'in_app', enabled: false });
      mailer().clear();
      await changeRoles(ws, maria, 'manager');
      expect((await maria.agent.get('/api/v1/notifications')).body.items).toEqual([]);
      expect(mailer().sent.map((m) => m.to)).toEqual(['maria@acme.eu']);
    });

    it('refuses to switch off a locked channel', async () => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent
        .put('/api/v1/notifications/preferences')
        .send({ type: 'account.roles_changed', channel: 'email', enabled: false });
      expect([res.status, errorCode(res)]).toEqual([400, 'VALIDATION_FAILED']);
      expect(res.body.error.details[0].code).toBe('locked');
      expect(await system.notificationPreference.count()).toBe(0);
    });

    it.each([
      ['an unknown type', { type: 'made.up', channel: 'in_app', enabled: true }],
      ['an unknown channel', { type: 'account.roles_changed', channel: 'sms', enabled: true }],
      ['a non-boolean value', { type: 'account.roles_changed', channel: 'in_app', enabled: 'yes' }],
      ['a missing field', { type: 'account.roles_changed', channel: 'in_app' }],
      ['an empty body', {}],
    ])('rejects %s', async (_label, body) => {
      const ws = await workspace('acme');
      const res = await ws.admin.agent.put('/api/v1/notifications/preferences').send(body);
      expect([res.status, errorCode(res)]).toEqual([400, 'VALIDATION_FAILED']);
    });
  });
});
