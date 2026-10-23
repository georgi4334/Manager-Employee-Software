import type { NestExpressApplication } from '@nestjs/platform-express';
import { mergeGrants, systemRoleGrants } from '@intime/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAILER } from '../src/infrastructure/mail/mailer.js';
import type { MemoryMailer } from '../src/infrastructure/mail/memory.mailer.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { TenantContext, type TenantTx } from '../src/infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../src/infrastructure/tenancy/tenant-db.service.js';
import { EmailDispatcher } from '../src/modules/notifications/delivery/email-dispatcher.service.js';
import {
  MAX_ATTEMPTS,
  NotificationProcessor,
} from '../src/modules/notifications/delivery/notification-processor.service.js';
import {
  NotificationRetention,
  RETENTION,
} from '../src/modules/notifications/delivery/notification-retention.service.js';
import { OutboxWorker } from '../src/modules/notifications/delivery/outbox-worker.service.js';
import { OutboxService } from '../src/modules/notifications/outbox.service.js';
import { SystemRolesService } from '../src/modules/roles/system-roles.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';

const urls = testDbUrls();
const DAY = 24 * 60 * 60 * 1000;
const MISSING_USER = '0192f5a0-0000-7000-8000-0000000000ff';

describe.skipIf(!urls)('notifications pipeline (real database)', () => {
  const env = testEnv({ DATABASE_URL: urls?.app, SYSTEM_DATABASE_URL: urls?.system });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  let db: TenantDb;
  let context: TenantContext;
  let mailer: MemoryMailer;
  let outbox: OutboxService;
  let worker: OutboxWorker;
  let processor: NotificationProcessor;
  let dispatcher: EmailDispatcher;
  let retention: NotificationRetention;
  let tenantA: string;
  let tenantB: string;

  const asTenant = <T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
    context.run(tenantId, () => db.tx(fn));

  async function user(
    tenantId: string,
    email: string,
    data: { status?: string; locale?: string } = {},
  ) {
    return system.user.create({
      data: { tenantId, email, status: data.status ?? 'active', locale: data.locale },
    });
  }

  const publish = (tenantId: string, userId: string, roleNames = ['HR']) =>
    asTenant(tenantId, (tx) => outbox.publish(tx, 'user.roles_changed', { userId, roleNames }));

  const events = () => system.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  const notifications = () => system.notification.findMany({ orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    db = app.get(TenantDb);
    context = app.get(TenantContext);
    mailer = app.get(MAILER);
    outbox = app.get(OutboxService);
    worker = app.get(OutboxWorker);
    processor = app.get(NotificationProcessor);
    dispatcher = app.get(EmailDispatcher);
    retention = app.get(NotificationRetention);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });
  beforeEach(async () => {
    await system.tenant.deleteMany();
    tenantA = (await system.tenant.create({ data: { name: 'Acme GmbH', slug: 'acme' } })).id;
    tenantB = (await system.tenant.create({ data: { name: 'Beta AG', slug: 'beta' } })).id;
    mailer.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('delivery', () => {
    it('turns a published event into an in-app notification and an email, and finishes the event', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id, ['HR', 'Manager']);
      expect((await events()).map((e) => e.status)).toEqual(['pending']);
      expect(await notifications()).toHaveLength(0);

      const stats = await worker.runOnce();
      expect(stats).toMatchObject({ events: 1, emails: 1 });

      const [event] = await events();
      expect(event).toMatchObject({ status: 'done', lockedUntil: null, lastError: null });
      expect(event?.processedAt).toBeInstanceOf(Date);

      const [notification] = await notifications();
      expect(notification).toMatchObject({
        tenantId: tenantA,
        recipientUserId: maria.id,
        eventId: event?.id,
        type: 'account.roles_changed',
        params: { roleNames: ['HR', 'Manager'] },
        link: '/notifications',
        inApp: true,
        readAt: null,
        emailStatus: 'sent',
        emailAttempts: 1,
      });
      expect(notification?.emailSentAt).toBeInstanceOf(Date);
    });

    it('sends the email in the person’s language, naming the workspace and linking into the app, without details', async () => {
      const hans = await user(tenantA, 'hans@acme.eu', { locale: 'de' });
      await publish(tenantA, hans.id, ['Administrator-Rolle']);
      await worker.runOnce();
      expect(mailer.sent).toHaveLength(1);
      const [mail] = mailer.sent;
      expect(mail?.to).toBe('hans@acme.eu');
      expect(mail?.subject).toBe('Ihre Berechtigungen in Acme GmbH wurden geändert');
      expect(mail?.text).toContain('http://localhost:5173/notifications');
      expect(mail?.text).not.toContain('Administrator-Rolle');
    });

    it('falls back to the workspace language, then English', async () => {
      await system.tenant.update({ where: { id: tenantA }, data: { defaultLocale: 'bg' } });
      const ivan = await user(tenantA, 'ivan@acme.eu');
      const emma = await user(tenantB, 'emma@beta.eu');
      await publish(tenantA, ivan.id);
      await publish(tenantB, emma.id);
      await worker.runOnce();
      const bySubject = Object.fromEntries(mailer.sent.map((m) => [m.to, m.subject]));
      expect(bySubject['ivan@acme.eu']).toBe('Правата ви в Acme GmbH бяха променени');
      expect(bySubject['emma@beta.eu']).toBe('Your access in Beta AG has changed');
    });

    it('is idempotent: running again changes nothing and sends nothing more', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      await worker.runOnce();
      const second = await worker.runOnce();
      expect(second).toMatchObject({ events: 0, emails: 0 });
      expect(await notifications()).toHaveLength(1);
      expect(mailer.sent).toHaveLength(1);
    });

    it('creating the same notification twice (event processed again) keeps a single one', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      await worker.runOnce();
      await system.outboxEvent.updateMany({ data: { status: 'pending', availableAt: new Date() } });
      await worker.runOnce();
      expect(await notifications()).toHaveLength(1);
    });

    it('works across workspaces in one pass, each notification in its own workspace', async () => {
      const a = await user(tenantA, 'a@acme.eu');
      const b = await user(tenantB, 'b@beta.eu');
      await publish(tenantA, a.id);
      await publish(tenantB, b.id);
      await worker.runOnce();
      const rows = await notifications();
      expect(rows.map((n) => [n.tenantId, n.recipientUserId]).sort()).toEqual(
        [
          [tenantA, a.id],
          [tenantB, b.id],
        ].sort(),
      );
    });
  });

  describe('preferences', () => {
    it('someone who switched the inbox off still gets the (locked) email, and the entry is hidden from the inbox', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await system.notificationPreference.create({
        data: {
          tenantId: tenantA,
          userId: maria.id,
          type: 'account.roles_changed',
          channel: 'in_app',
          enabled: false,
        },
      });
      await publish(tenantA, maria.id);
      await worker.runOnce();
      const [notification] = await notifications();
      expect(notification).toMatchObject({ inApp: false, emailStatus: 'sent' });
      expect(mailer.sent).toHaveLength(1);
      expect(
        await asTenant(tenantA, (tx) => tx.notification.count({ where: { inApp: true } })),
      ).toBe(0);
    });

    it('a stored "email off" cannot silence a locked channel', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await system.notificationPreference.create({
        data: {
          tenantId: tenantA,
          userId: maria.id,
          type: 'account.roles_changed',
          channel: 'email',
          enabled: false,
        },
      });
      await publish(tenantA, maria.id);
      await worker.runOnce();
      expect(mailer.sent).toHaveLength(1);
    });

    it('another person’s preferences do not affect this one', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      const ivan = await user(tenantA, 'ivan@acme.eu');
      await system.notificationPreference.create({
        data: {
          tenantId: tenantA,
          userId: ivan.id,
          type: 'account.roles_changed',
          channel: 'in_app',
          enabled: false,
        },
      });
      await publish(tenantA, maria.id);
      await worker.runOnce();
      expect((await notifications())[0]?.inApp).toBe(true);
    });
  });

  describe('recipients', () => {
    it('nobody to tell (user does not exist): no notification, event still finished', async () => {
      await publish(tenantA, MISSING_USER);
      await worker.runOnce();
      expect(await notifications()).toHaveLength(0);
      expect((await events())[0]?.status).toBe('done');
      expect(mailer.sent).toHaveLength(0);
    });

    it('a user of another workspace is never notified from this workspace’s event', async () => {
      const outsider = await user(tenantB, 'outsider@beta.eu');
      await publish(tenantA, outsider.id);
      await worker.runOnce();
      expect(await notifications()).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
      // Handled cleanly (nobody to tell), not as a failure that would be retried.
      expect((await events())[0]).toMatchObject({ status: 'done', attempts: 1, lastError: null });
    });

    it.each(['disabled', 'invited'])(
      'a %s account gets the inbox entry but no email',
      async (status) => {
        const person = await user(tenantA, `${status}@acme.eu`, { status });
        await publish(tenantA, person.id);
        await worker.runOnce();
        expect((await notifications())[0]).toMatchObject({ emailStatus: 'skipped', inApp: true });
        expect(mailer.sent).toHaveLength(0);
      },
    );
  });

  describe('broken events', () => {
    const rawEvent = (data: { type: string; params: object }) =>
      system.outboxEvent.create({ data: { tenantId: tenantA, ...data } });

    it('invalid parameters are a permanent failure: dead at once, no notification, a short reason', async () => {
      await rawEvent({ type: 'user.roles_changed', params: { userId: 'not-a-uuid' } });
      await worker.runOnce();
      const [event] = await events();
      expect(event).toMatchObject({
        status: 'dead',
        attempts: 1,
        lastError: 'Invalid event parameters',
      });
      expect(await notifications()).toHaveLength(0);
    });

    it('an unknown event type is dead at once', async () => {
      await rawEvent({ type: 'made.up_event', params: {} });
      await worker.runOnce();
      expect((await events())[0]).toMatchObject({
        status: 'dead',
        lastError: 'Unknown event type made.up_event',
      });
    });

    it('a broken event does not hold back the healthy ones', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await rawEvent({ type: 'made.up_event', params: {} });
      await publish(tenantA, maria.id);
      await worker.runOnce();
      expect((await events()).map((e) => e.status).sort()).toEqual(['dead', 'done']);
      expect(await notifications()).toHaveLength(1);
    });
  });

  describe('retries', () => {
    it('a temporary failure is retried later with a growing delay, then succeeds', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      vi.spyOn(system, '$transaction').mockRejectedValueOnce(new Error('db down'));

      const t0 = new Date();
      await worker.runOnce(t0);
      const [failed] = await events();
      expect(failed).toMatchObject({ status: 'pending', attempts: 1, lastError: 'db down' });
      expect(failed?.availableAt.getTime()).toBe(t0.getTime() + 30_000);
      expect(await notifications()).toHaveLength(0);

      // Too early: not claimed.
      expect(await worker.runOnce(new Date(t0.getTime() + 10_000))).toMatchObject({ events: 0 });
      // After the delay: delivered.
      expect(await worker.runOnce(new Date(t0.getTime() + 31_000))).toMatchObject({ events: 1 });
      expect((await events())[0]).toMatchObject({ status: 'done', attempts: 2, lastError: null });
      expect(await notifications()).toHaveLength(1);
    });

    it('gives up after the maximum number of attempts and keeps the event for inspection', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      vi.spyOn(system, '$transaction').mockRejectedValue(new Error('db down'));

      let now = Date.now();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        now += 2 * 60 * 60 * 1000;
        await worker.runOnce(new Date(now));
      }
      expect((await events())[0]).toMatchObject({
        status: 'dead',
        attempts: MAX_ATTEMPTS,
        lastError: 'db down',
      });
      now += 2 * 60 * 60 * 1000;
      expect(await worker.runOnce(new Date(now))).toMatchObject({ events: 0 });
    });
  });

  describe('claiming (several workers, crashes)', () => {
    it('two workers claiming at the same moment never get the same event', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      for (let i = 0; i < 40; i++) await publish(tenantA, maria.id, [`Role ${i}`]);
      const now = new Date();
      const [first, second] = await Promise.all([
        processor.claim(25, now),
        processor.claim(25, now),
      ]);
      const ids = [...first, ...second].map((e) => e.id);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
      expect(first.every((e) => e.attempts === 1)).toBe(true);
    });

    it('a worker skips events another worker is holding instead of waiting for them (SKIP LOCKED)', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      for (let i = 0; i < 10; i++) await publish(tenantA, maria.id, [`Role ${i}`]);
      const now = new Date();

      const outcome = await system.$transaction(async (holder) => {
        // Worker 1 is busy with the oldest five events (rows locked, not yet committed).
        const held = await holder.$queryRaw<{ id: string }[]>`
          SELECT id FROM outbox_event ORDER BY created_at, id LIMIT 5 FOR UPDATE`;
        // Worker 2 must neither wait for them nor take them.
        const started = Date.now();
        const claimed = await processor.claim(10, now);
        return {
          held: held.map((e) => e.id),
          claimed: claimed.map((e) => e.id),
          waitedMs: Date.now() - started,
        };
      });
      expect(outcome.held).toHaveLength(5);
      expect(outcome.claimed).toHaveLength(5);
      expect(outcome.claimed.some((id) => outcome.held.includes(id))).toBe(false);
      expect(outcome.waitedMs).toBeLessThan(2_000);
    });

    it('an event being processed (live lease) is left alone; after the lease expires it is taken again', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      const now = new Date();
      expect(await processor.claim(10, now)).toHaveLength(1);
      expect(await processor.claim(10, new Date(now.getTime() + 60_000))).toHaveLength(0);
      const later = await processor.claim(10, new Date(now.getTime() + 6 * 60_000));
      expect(later).toHaveLength(1);
      expect(later[0]?.attempts).toBe(2);
    });

    it('a crashed worker’s event is finished by the next pass', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      await processor.claim(10, new Date()); // claimed, then "crashed" before processing
      expect(await worker.runOnce()).toMatchObject({ events: 0 });
      expect(await worker.runOnce(new Date(Date.now() + 6 * 60_000))).toMatchObject({ events: 1 });
      expect(await notifications()).toHaveLength(1);
    });
  });

  describe('email delivery', () => {
    const pendingNotification = async (email = 'maria@acme.eu') => {
      const person = await user(tenantA, email);
      await publish(tenantA, person.id);
      return person;
    };

    it('a failing mail server leads to retries with growing delay, then success', async () => {
      await pendingNotification();
      const send = vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('smtp down'));
      const t0 = new Date();
      await worker.runOnce(t0);
      const [first] = await notifications();
      expect(first).toMatchObject({ emailStatus: 'pending', emailAttempts: 1, inApp: true });
      expect(first?.emailNextAt?.getTime()).toBe(t0.getTime() + 30_000);

      expect(await worker.runOnce(new Date(t0.getTime() + 5_000))).toMatchObject({ emails: 0 });
      expect(await worker.runOnce(new Date(t0.getTime() + 31_000))).toMatchObject({ emails: 1 });
      expect((await notifications())[0]).toMatchObject({ emailStatus: 'sent', emailAttempts: 2 });
      expect(send).toHaveBeenCalledTimes(2);
      expect(mailer.sent).toHaveLength(1);
    });

    it('gives up after the maximum number of attempts; the inbox entry stays', async () => {
      await pendingNotification();
      vi.spyOn(mailer, 'send').mockRejectedValue(new Error('smtp down'));
      let now = Date.now();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        now += 2 * 60 * 60 * 1000;
        await worker.runOnce(new Date(now));
      }
      expect((await notifications())[0]).toMatchObject({
        emailStatus: 'failed',
        emailAttempts: MAX_ATTEMPTS,
        inApp: true,
        emailNextAt: null,
      });
    });

    it('two workers never claim the same email', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      for (let i = 0; i < 30; i++) {
        await system.notification.create({
          data: {
            tenantId: tenantA,
            recipientUserId: maria.id,
            type: 'account.roles_changed',
            params: { roleNames: ['x'] },
            link: '/notifications',
            emailStatus: 'pending',
            emailNextAt: new Date(),
          },
        });
      }
      const now = new Date(Date.now() + 1000);
      const [first, second] = await Promise.all([
        dispatcher.claim(20, now),
        dispatcher.claim(20, now),
      ]);
      const ids = [...first, ...second].map((e) => e.id);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    });

    it('an email stuck in "sending" (crash) is sent after the lease', async () => {
      await pendingNotification();
      await processor
        .claim(10, new Date())
        .then((claimed) => Promise.all(claimed.map((e) => processor.process(e, new Date()))));
      await dispatcher.claim(10, new Date(Date.now() + 1000)); // claimed, then "crashed"
      expect((await notifications())[0]?.emailStatus).toBe('sending');
      expect(await worker.runOnce(new Date(Date.now() + 6 * 60_000))).toMatchObject({ emails: 1 });
      expect(mailer.sent).toHaveLength(1);
    });

    it('a person who was disabled before the email went out gets none', async () => {
      const person = await pendingNotification();
      await processor
        .claim(10, new Date())
        .then((claimed) => Promise.all(claimed.map((e) => processor.process(e, new Date()))));
      await system.user.update({ where: { id: person.id }, data: { status: 'disabled' } });
      await worker.runOnce(new Date(Date.now() + 1000));
      expect((await notifications())[0]?.emailStatus).toBe('skipped');
      expect(mailer.sent).toHaveLength(0);
    });
  });

  describe('retention (GDPR)', () => {
    it('deletes old notifications and queue entries, keeps everything recent and anything still waiting for an email', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      const now = new Date();
      const ago = (days: number) => new Date(now.getTime() - days * DAY);
      const base = {
        tenantId: tenantA,
        recipientUserId: maria.id,
        type: 'account.roles_changed',
        link: '/notifications',
      };
      const make = (name: string, data: object) =>
        system.notification.create({ data: { ...base, params: { roleNames: [name] }, ...data } });

      await make('old-read', {
        readAt: ago(RETENTION.readNotificationDays + 1),
        createdAt: ago(200),
      });
      await make('recent-read', { readAt: ago(5), createdAt: ago(10) });
      await make('old-unread', { createdAt: ago(RETENTION.unreadNotificationDays + 1) });
      await make('unread-90d', { createdAt: ago(100) });
      await make('old-but-email-pending', {
        readAt: ago(300),
        createdAt: ago(300),
        emailStatus: 'pending',
        emailNextAt: now,
      });
      await make('old-but-email-sending', {
        createdAt: ago(300),
        emailStatus: 'sending',
        emailNextAt: now,
      });

      const rawEvent = (data: object) =>
        system.outboxEvent.create({
          data: { tenantId: tenantA, type: 'user.roles_changed', params: {}, ...data },
        });
      await rawEvent({
        status: 'done',
        processedAt: ago(RETENTION.doneEventDays + 1),
        createdAt: ago(40),
      });
      await rawEvent({ status: 'done', processedAt: ago(1), createdAt: ago(1) });
      await rawEvent({ status: 'dead', createdAt: ago(RETENTION.deadEventDays + 1) });
      await rawEvent({ status: 'dead', createdAt: ago(10) });
      await rawEvent({ status: 'pending', createdAt: ago(400) });
      await rawEvent({ status: 'processing', createdAt: ago(400) });

      const result = await retention.purge(now);
      expect(result).toEqual({ notifications: 2, events: 2 });
      expect(
        (await notifications())
          .map((n) => (n.params as { roleNames: string[] }).roleNames[0])
          .sort(),
      ).toEqual(['old-but-email-pending', 'old-but-email-sending', 'recent-read', 'unread-90d']);
      expect((await events()).map((e) => e.status).sort()).toEqual([
        'dead',
        'done',
        'pending',
        'processing',
      ]);
    });
  });

  describe('privileges and isolation', () => {
    it('requests cannot read or change the queue', async () => {
      await publish(tenantA, (await user(tenantA, 'maria@acme.eu')).id);
      await expect(
        asTenant(tenantA, (tx) => tx.$queryRaw`SELECT * FROM outbox_event`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`UPDATE outbox_event SET status = 'done'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`DELETE FROM outbox_event`),
      ).rejects.toThrow(/permission denied/);
    });

    it('people can mark their notification read, but cannot change anything else or delete it', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      await worker.runOnce();
      const [n] = await notifications();
      await asTenant(tenantA, (tx) =>
        tx.notification.updateMany({ where: { id: n?.id }, data: { readAt: new Date() } }),
      );
      expect((await notifications())[0]?.readAt).toBeInstanceOf(Date);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`UPDATE notification SET email_status = 'sent'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`UPDATE notification SET params = '{}'::jsonb`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(tenantA, (tx) => tx.$executeRaw`DELETE FROM notification`),
      ).rejects.toThrow(/permission denied/);
    });

    it('notifications and preferences are invisible to other workspaces', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await publish(tenantA, maria.id);
      await worker.runOnce();
      await system.notificationPreference.create({
        data: {
          tenantId: tenantA,
          userId: maria.id,
          type: 'account.roles_changed',
          channel: 'in_app',
          enabled: false,
        },
      });
      expect(await asTenant(tenantB, (tx) => tx.notification.count())).toBe(0);
      expect(await asTenant(tenantB, (tx) => tx.notificationPreference.count())).toBe(0);
      expect(await asTenant(tenantA, (tx) => tx.notification.count())).toBe(1);
    });

    it('a notification cannot be addressed to a user of another workspace, even by the database user of the app', async () => {
      const outsider = await user(tenantB, 'outsider@beta.eu');
      await expect(
        asTenant(tenantA, (tx) =>
          tx.notification.create({
            data: {
              recipientUserId: outsider.id,
              type: 'account.roles_changed',
              link: '/notifications',
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        system.notification.create({
          data: {
            tenantId: tenantA,
            recipientUserId: outsider.id,
            type: 'account.roles_changed',
            link: '/notifications',
          },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['an external link', { link: 'https://evil.example' }],
      ['a protocol-relative link', { link: '//evil.example' }],
      ['a malformed type', { type: 'Not A Type' }],
      ['an unknown email status', { emailStatus: 'maybe' }],
      ['negative attempts', { emailAttempts: -1 }],
    ])('the database refuses %s', async (_label, bad) => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await expect(
        system.notification.create({
          data: {
            tenantId: tenantA,
            recipientUserId: maria.id,
            type: 'account.roles_changed',
            link: '/notifications',
            ...bad,
          },
        }),
      ).rejects.toThrow();
    });

    it('the database refuses unknown channels and malformed event types', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      await expect(
        system.notificationPreference.create({
          data: {
            tenantId: tenantA,
            userId: maria.id,
            type: 'account.roles_changed',
            channel: 'sms',
            enabled: true,
          },
        }),
      ).rejects.toThrow();
      await expect(
        system.outboxEvent.create({ data: { tenantId: tenantA, type: 'Bad Type', params: {} } }),
      ).rejects.toThrow();
      await expect(
        system.outboxEvent.create({
          data: { tenantId: tenantA, type: 'user.roles_changed', params: {}, status: 'weird' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('the event is part of the change (transactional outbox)', () => {
    it('publishing inside a transaction that fails stores nothing and wakes nobody', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      const wake = vi.fn();
      const bound = new OutboxService(db, { wake } as unknown as OutboxWorker);
      await expect(
        asTenant(tenantA, async (tx) => {
          await bound.publish(tx, 'user.roles_changed', { userId: maria.id, roleNames: ['HR'] });
          throw new Error('the change itself failed');
        }),
      ).rejects.toThrow('the change itself failed');
      expect(await events()).toHaveLength(0);
      expect(wake).not.toHaveBeenCalled();
    });

    it('publishing inside a successful transaction stores the event and wakes the worker after the commit', async () => {
      const maria = await user(tenantA, 'maria@acme.eu');
      const wake = vi.fn(async () => {
        // At wake-up time the event must already be visible to the worker.
        expect(await system.outboxEvent.count()).toBe(1);
      });
      const bound = new OutboxService(db, { wake } as unknown as OutboxWorker);
      await asTenant(tenantA, (tx) =>
        bound.publish(tx, 'user.roles_changed', { userId: maria.id, roleNames: ['HR'] }),
      );
      expect(wake).toHaveBeenCalledOnce();
      await vi.waitFor(async () => expect(await system.outboxEvent.count()).toBe(1));
    });

    describe('first producer: changing roles (UsersService.setRoles)', () => {
      async function setup() {
        const { roleIds } = await asTenant(tenantA, (tx) =>
          app.get(SystemRolesService).ensureSystemRoles(tx),
        );
        const admin = await user(tenantA, 'admin@acme.eu');
        const maria = await user(tenantA, 'maria@acme.eu');
        await system.userRole.createMany({
          data: [
            { tenantId: tenantA, userId: admin.id, roleId: roleIds.admin },
            { tenantId: tenantA, userId: maria.id, roleId: roleIds.employee },
          ],
        });
        const actor = {
          userId: admin.id,
          tenantId: tenantA,
          sessionId: '0192f5a0-0000-7000-8000-0000000000aa',
          roles: [],
          permissions: mergeGrants([systemRoleGrants('admin')]),
        };
        return { roleIds, admin, maria, actor, users: app.get(UsersService) };
      }

      it('tells the person whose roles changed, with the new role names', async () => {
        const { roleIds, maria, actor, users } = await setup();
        await context.run(tenantA, () =>
          users.setRoles(actor, maria.id, [roleIds.hr, roleIds.manager]),
        );
        const [event] = await events();
        expect(event).toMatchObject({
          type: 'user.roles_changed',
          status: 'pending',
          params: { userId: maria.id, roleNames: ['HR', 'Manager'] },
        });

        await worker.runOnce();
        const [notification] = await notifications();
        expect(notification).toMatchObject({
          recipientUserId: maria.id,
          type: 'account.roles_changed',
          params: { roleNames: ['HR', 'Manager'] },
        });
        expect(mailer.sent.map((m) => m.to)).toEqual(['maria@acme.eu']);
      });

      it('sends nothing when the roles did not actually change', async () => {
        const { roleIds, maria, actor, users } = await setup();
        await context.run(tenantA, () => users.setRoles(actor, maria.id, [roleIds.employee]));
        expect(await events()).toHaveLength(0);
      });

      it('sends nothing when the change is rolled back (last administrator protection)', async () => {
        const { roleIds, admin, actor, users } = await setup();
        await expect(
          context.run(tenantA, () => users.setRoles(actor, admin.id, [roleIds.employee])),
        ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
        expect(await events()).toHaveLength(0);
        await worker.runOnce();
        expect(mailer.sent).toHaveLength(0);
      });
    });
  });
});
