import { NOTIFICATION_TYPES } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { EVENT_DEFINITIONS, isEventType } from './events.js';

const USER = '0192f5a0-0000-7000-8000-00000000000a';
const leaveBase = {
  requestId: '0192f5a0-0000-7000-8000-00000000000b',
  employeeName: 'Ada Lovelace',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
};

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
      'leave.requested': { ...leaveBase, recipientUserIds: [USER], days: 2, autoApproved: false },
      'leave.decided': { ...leaveBase, recipientUserId: USER, status: 'approved' },
      'leave.cancelled': { ...leaveBase, recipientUserIds: [USER], by: 'employee' },
      'attendance.corrected': { recipientUserId: USER, date: '2026-11-02', action: 'updated' },
      'project.assigned': { recipientUserId: USER, projectId: USER, projectName: 'Website' },
      'task.assigned': { recipientUserId: USER, projectId: USER, taskKey: 'WEB-12' },
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

describe('leave events', () => {
  const other = '0192f5a0-0000-7000-8000-00000000000c';

  it('leave.requested notifies every approver with the same facts, once each', () => {
    const intents = EVENT_DEFINITIONS['leave.requested'].notify({
      ...leaveBase,
      recipientUserIds: [USER, other],
      days: 3.5,
      autoApproved: false,
    });
    expect(intents.map((i) => i.recipientUserId)).toEqual([USER, other]);
    expect(intents[0]).toMatchObject({
      type: 'leave.requested',
      params: { ...leaveBase, days: 3.5, autoApproved: false },
    });
    // the recipient list is routing, not part of what the notification says
    expect(JSON.stringify(intents[0]?.params)).not.toContain(other);
  });

  it('leave.decided tells the requester the outcome', () => {
    expect(
      EVENT_DEFINITIONS['leave.decided'].notify({
        recipientUserId: USER,
        requestId: leaveBase.requestId,
        status: 'rejected',
        startDate: leaveBase.startDate,
        endDate: leaveBase.endDate,
      }),
    ).toEqual([
      {
        recipientUserId: USER,
        type: 'leave.decided',
        params: {
          requestId: leaveBase.requestId,
          status: 'rejected',
          startDate: leaveBase.startDate,
          endDate: leaveBase.endDate,
        },
      },
    ]);
  });

  it.each([
    [
      'requested without recipients',
      'leave.requested',
      { ...leaveBase, recipientUserIds: [], days: 1, autoApproved: false },
    ],
    [
      'requested with zero days',
      'leave.requested',
      { ...leaveBase, recipientUserIds: [USER], days: 0, autoApproved: false },
    ],
    [
      'requested with a bad date',
      'leave.requested',
      {
        ...leaveBase,
        startDate: '2.11.2026',
        recipientUserIds: [USER],
        days: 1,
        autoApproved: false,
      },
    ],
    [
      'requested with over 100 recipients',
      'leave.requested',
      {
        ...leaveBase,
        recipientUserIds: Array.from({ length: 101 }, () => USER),
        days: 1,
        autoApproved: false,
      },
    ],
    [
      'decided with a status that is no decision',
      'leave.decided',
      { ...leaveBase, recipientUserId: USER, status: 'pending' },
    ],
    [
      'cancelled by nobody known',
      'leave.cancelled',
      { ...leaveBase, recipientUserIds: [USER], by: 'robot' },
    ],
    [
      'a blank employee name',
      'leave.cancelled',
      { ...leaveBase, employeeName: ' ', recipientUserIds: [USER], by: 'employee' },
    ],
  ] as const)('rejects %s', (_label, type, params) => {
    expect(EVENT_DEFINITIONS[type].params.safeParse(params).success).toBe(false);
  });
});

describe('attendance.corrected', () => {
  const definition = EVENT_DEFINITIONS['attendance.corrected'];

  it('tells the person which day and what happened, nothing more', () => {
    expect(
      definition.notify({ recipientUserId: USER, date: '2026-11-02', action: 'deleted' }),
    ).toEqual([
      {
        recipientUserId: USER,
        type: 'attendance.corrected',
        params: { date: '2026-11-02', action: 'deleted' },
      },
    ]);
  });

  it.each([
    ['no recipient', { date: '2026-11-02', action: 'updated' }],
    ['a bad date', { recipientUserId: USER, date: '2.11.2026', action: 'updated' }],
    ['an unknown action', { recipientUserId: USER, date: '2026-11-02', action: 'viewed' }],
  ])('rejects %s', (_label, params) => {
    expect(definition.params.safeParse(params).success).toBe(false);
  });
});

describe('project.assigned', () => {
  const definition = EVENT_DEFINITIONS['project.assigned'];

  it('tells the person which project, by id and name only', () => {
    expect(
      definition.notify({ recipientUserId: USER, projectId: USER, projectName: 'Website' }),
    ).toEqual([
      {
        recipientUserId: USER,
        type: 'project.assigned',
        params: { projectId: USER, projectName: 'Website' },
      },
    ]);
  });

  it.each([
    ['no recipient', { projectId: USER, projectName: 'Website' }],
    ['no project name', { recipientUserId: USER, projectId: USER, projectName: ' ' }],
    ['a very long name', { recipientUserId: USER, projectId: USER, projectName: 'x'.repeat(121) }],
    ['a bad project id', { recipientUserId: USER, projectId: 'x', projectName: 'Website' }],
  ])('rejects %s', (_label, params) => {
    expect(definition.params.safeParse(params).success).toBe(false);
  });
});

describe('task.assigned', () => {
  const definition = EVENT_DEFINITIONS['task.assigned'];

  it('tells the person the project and the reference, never a title', () => {
    expect(
      definition.notify({ recipientUserId: USER, projectId: USER, taskKey: 'WEB-12' }),
    ).toEqual([
      {
        recipientUserId: USER,
        type: 'task.assigned',
        params: { projectId: USER, taskKey: 'WEB-12' },
      },
    ]);
  });

  it.each([
    ['no recipient', { projectId: USER, taskKey: 'WEB-12' }],
    ['no reference', { recipientUserId: USER, projectId: USER, taskKey: ' ' }],
    ['a very long reference', { recipientUserId: USER, projectId: USER, taskKey: 'x'.repeat(31) }],
    ['a bad project id', { recipientUserId: USER, projectId: 'x', taskKey: 'WEB-12' }],
  ])('rejects %s', (_label, params) => {
    expect(definition.params.safeParse(params).success).toBe(false);
  });
});
