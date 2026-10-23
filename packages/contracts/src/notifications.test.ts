import { describe, expect, it } from 'vitest';
import {
  MAX_NOTIFICATION_PAGE,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_KEYS,
  isNotificationChannel,
  isNotificationType,
  notificationQuerySchema,
  parseNotificationParams,
  resolveChannels,
  type NotificationTypeDef,
  updateNotificationPreferenceSchema,
} from './notifications.js';

describe('catalog integrity', () => {
  it('has well-formed types, links and parameter schemas', () => {
    expect(NOTIFICATION_TYPE_KEYS.length).toBeGreaterThan(0);
    for (const type of NOTIFICATION_TYPE_KEYS) {
      expect(type).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(NOTIFICATION_TYPES[type].link.startsWith('/')).toBe(true);
      expect(NOTIFICATION_TYPES[type].link.startsWith('//')).toBe(false);
    }
  });

  it('a locked channel is also on by default (it could never be off)', () => {
    for (const type of NOTIFICATION_TYPE_KEYS) {
      const definition: NotificationTypeDef = NOTIFICATION_TYPES[type];
      for (const channel of ['in_app', 'email'] as const) {
        if (definition.locked[channel])
          expect(definition.defaults[channel], `${type} ${channel}`).toBe(true);
      }
    }
  });
});

describe('type and channel guards', () => {
  it('recognizes catalog types only, including inherited property names', () => {
    expect(isNotificationType('account.roles_changed')).toBe(true);
    for (const value of [
      'account.roles_changed ',
      'nope',
      '',
      null,
      undefined,
      1,
      'constructor',
      '__proto__',
      'toString',
    ]) {
      expect(isNotificationType(value)).toBe(false);
    }
  });

  it('recognizes channels', () => {
    expect(isNotificationChannel('email')).toBe(true);
    expect(isNotificationChannel('in_app')).toBe(true);
    for (const value of ['sms', 'EMAIL', '', null, undefined])
      expect(isNotificationChannel(value)).toBe(false);
  });
});

describe('resolveChannels', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(resolveChannels('account.roles_changed')).toEqual({
      in_app: { enabled: true, locked: false },
      email: { enabled: true, locked: true },
    });
  });

  it('lets a person switch off an unlocked channel', () => {
    expect(resolveChannels('account.roles_changed', { in_app: false }).in_app).toEqual({
      enabled: false,
      locked: false,
    });
  });

  it('ignores an attempt to switch off a locked channel', () => {
    expect(resolveChannels('account.roles_changed', { email: false }).email).toEqual({
      enabled: true,
      locked: true,
    });
  });

  it('turns everything off for unknown types (fail closed)', () => {
    expect(resolveChannels('made.up', { in_app: true, email: true })).toEqual({
      in_app: { enabled: false, locked: false },
      email: { enabled: false, locked: false },
    });
  });
});

describe('parseNotificationParams', () => {
  it('accepts valid parameters and trims labels', () => {
    expect(parseNotificationParams('account.roles_changed', { roleNames: [' HR '] })).toEqual({
      roleNames: ['HR'],
    });
  });

  it.each([
    ['missing parameters', undefined],
    ['an empty list', { roleNames: [] }],
    ['a blank name', { roleNames: ['  '] }],
    ['a name that is not text', { roleNames: [42] }],
    ['too many names', { roleNames: Array.from({ length: 11 }, () => 'x') }],
    ['an over-long name', { roleNames: ['x'.repeat(101)] }],
  ])('rejects %s', (_label, params) => {
    expect(() => parseNotificationParams('account.roles_changed', params)).toThrow();
  });
});

describe('API schemas', () => {
  it('applies defaults and limits to the list query', () => {
    expect(notificationQuerySchema.parse({})).toEqual({ limit: 20, unreadOnly: false });
    expect(notificationQuerySchema.parse({ limit: '5', unreadOnly: 'true' })).toEqual({
      limit: 5,
      unreadOnly: true,
    });
    expect(notificationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(
      notificationQuerySchema.safeParse({ limit: String(MAX_NOTIFICATION_PAGE + 1) }).success,
    ).toBe(false);
    expect(notificationQuerySchema.safeParse({ before: 'not-a-uuid' }).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ unreadOnly: 'maybe' }).success).toBe(false);
  });

  it('validates preference updates', () => {
    expect(
      updateNotificationPreferenceSchema.safeParse({
        type: 'account.roles_changed',
        channel: 'in_app',
        enabled: false,
      }).success,
    ).toBe(true);
    for (const body of [
      { type: 'made.up', channel: 'in_app', enabled: true },
      { type: 'account.roles_changed', channel: 'sms', enabled: true },
      { type: 'account.roles_changed', channel: 'email', enabled: 'yes' },
      { type: 'account.roles_changed', channel: 'email' },
    ]) {
      expect(updateNotificationPreferenceSchema.safeParse(body).success).toBe(false);
    }
  });
});
