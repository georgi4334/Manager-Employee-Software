import { describe, expect, it } from 'vitest';
import { isSystemRole, SYSTEM_ROLES } from './roles.js';

describe('isSystemRole', () => {
  it.each(SYSTEM_ROLES)('accepts system role %s', (role) => {
    expect(isSystemRole(role)).toBe(true);
  });

  it.each(['superuser', 'Admin', '', 'employee ', 42, null, undefined])('rejects %p', (value) => {
    expect(isSystemRole(value)).toBe(false);
  });
});
