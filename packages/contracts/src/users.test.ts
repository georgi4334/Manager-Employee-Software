import { describe, expect, it } from 'vitest';
import { MAX_ROLES_PER_USER, inviteUserRequestSchema, setUserRolesRequestSchema } from './users.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';

describe('inviteUserRequestSchema', () => {
  it('normalizes the email and makes roles optional', () => {
    expect(inviteUserRequestSchema.parse({ email: ' New@Acme.EU ' })).toEqual({
      email: 'new@acme.eu',
    });
    expect(inviteUserRequestSchema.parse({ email: 'a@b.co', roleIds: [ID] })).toEqual({
      email: 'a@b.co',
      roleIds: [ID],
    });
  });

  it.each([
    ['a bad email', { email: 'nope' }],
    ['an empty role list', { email: 'a@b.co', roleIds: [] }],
    ['a non-UUID role', { email: 'a@b.co', roleIds: ['admin'] }],
    [
      'too many roles',
      { email: 'a@b.co', roleIds: Array.from({ length: MAX_ROLES_PER_USER + 1 }, () => ID) },
    ],
    ['roles that are not a list', { email: 'a@b.co', roleIds: ID }],
  ])('rejects %s', (_label, body) => {
    expect(inviteUserRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('setUserRolesRequestSchema', () => {
  it('requires at least one role', () => {
    expect(setUserRolesRequestSchema.safeParse({ roleIds: [ID] }).success).toBe(true);
    expect(setUserRolesRequestSchema.safeParse({ roleIds: [] }).success).toBe(false);
    expect(setUserRolesRequestSchema.safeParse({}).success).toBe(false);
  });
});
