import { NOTIFICATION_TYPES } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { EVENT_DEFINITIONS, isEventType } from './events.js';

const USER = '0192f5a0-0000-7000-8000-00000000000a';

describe('event catalog', () => {
  it('recognizes events, not inherited property names', () => {
    expect(isEventType('user.roles_changed')).toBe(true);
    for (const value of ['nope', '', null, undefined, 'constructor', '__proto__', 'toString']) {
      expect(isEventType(value)).toBe(false);
    }
  });

  it('every event only notifies with types that exist in the notification catalog', () => {
    const samples: Record<keyof typeof EVENT_DEFINITIONS, unknown> = {
      'user.roles_changed': { userId: USER, roleNames: ['HR'] },
    };
    for (const [type, definition] of Object.entries(EVENT_DEFINITIONS)) {
      const params = definition.params.parse(samples[type as keyof typeof samples]);
      for (const intent of (definition.notify as (p: unknown) => { type: string }[])(params)) {
        expect(Object.keys(NOTIFICATION_TYPES)).toContain(intent.type);
      }
    }
  });
});

describe('user.roles_changed', () => {
  const definition = EVENT_DEFINITIONS['user.roles_changed'];

  it('notifies the person whose roles changed, with the new role names', () => {
    expect(definition.notify({ userId: USER, roleNames: ['HR', 'Manager'] })).toEqual([
      {
        recipientUserId: USER,
        type: 'account.roles_changed',
        params: { roleNames: ['HR', 'Manager'] },
      },
    ]);
  });

  it.each([
    ['no user', { roleNames: ['HR'] }],
    ['a user that is not a UUID', { userId: 'maria', roleNames: ['HR'] }],
    ['no role names', { userId: USER, roleNames: [] }],
    ['blank role names', { userId: USER, roleNames: [' '] }],
    ['too many role names', { userId: USER, roleNames: Array.from({ length: 11 }, () => 'r') }],
  ])('rejects %s', (_label, params) => {
    expect(definition.params.safeParse(params).success).toBe(false);
  });
});
