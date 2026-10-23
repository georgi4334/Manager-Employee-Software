import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { RequestAuth } from './auth.types.js';
import { Authenticated, Public, RequirePermission } from './decorators.js';
import { PermissionGuard } from './permission.guard.js';

const guard = new PermissionGuard(new Reflector());

const auth = (permissions: RequestAuth['permissions']): RequestAuth => ({
  userId: 'u',
  tenantId: 't',
  sessionId: 's',
  roles: [],
  permissions,
});

function contextFor(
  handlerName: string,
  controller: new () => object,
  request: { auth?: RequestAuth },
) {
  const handler = (controller.prototype as Record<string, () => void>)[handlerName] as () => void;
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

class OpenController {
  @Public()
  open() {}
}

@Public()
class PublicController {
  anything() {}
}

class DeclaredController {
  @Authenticated()
  anyUser() {}

  @RequirePermission('leave.approve')
  one() {}

  @RequirePermission('leave.approve', 'leave.view_balance')
  both() {}

  undeclared() {}
}

@RequirePermission('admin.user.view')
class ClassLevelController {
  inherited() {}

  @RequirePermission('leave.approve')
  overridden() {}
}

const SIGNED_IN = auth({});
const run = (handler: string, controller: new () => object, request: { auth?: RequestAuth }) =>
  guard.canActivate(contextFor(handler, controller, request));

describe('PermissionGuard', () => {
  it('lets public routes through, signed in or not', () => {
    expect(run('open', OpenController, {})).toBe(true);
    expect(run('anything', PublicController, {})).toBe(true);
  });

  it('refuses a non-public route without a signed-in user', () => {
    expect(() => run('anyUser', DeclaredController, {})).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('lets any signed-in user use an @Authenticated route', () => {
    expect(run('anyUser', DeclaredController, { auth: SIGNED_IN })).toBe(true);
  });

  it('allows a route when the permission is held, at any scope', () => {
    expect(run('one', DeclaredController, { auth: auth({ 'leave.approve': 'reports' }) })).toBe(
      true,
    );
    expect(run('one', DeclaredController, { auth: auth({ 'leave.approve': 'all' }) })).toBe(true);
  });

  it('refuses a route when the permission is missing', () => {
    expect(() => run('one', DeclaredController, { auth: auth({ 'leave.view': 'all' }) })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', status: 403 }),
    );
    expect(() => run('one', DeclaredController, { auth: SIGNED_IN })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('requires every listed permission', () => {
    const both = auth({ 'leave.approve': 'all', 'leave.view_balance': 'own' });
    expect(run('both', DeclaredController, { auth: both })).toBe(true);
    expect(() =>
      run('both', DeclaredController, { auth: auth({ 'leave.approve': 'all' }) }),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('refuses a route that declares nothing, even for an Admin-like user (fail closed)', () => {
    const everything = auth({ 'admin.role.assign': 'all', 'leave.approve': 'all' });
    expect(() => run('undeclared', DeclaredController, { auth: everything })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', message: 'Route has no access declaration' }),
    );
  });

  it('applies a class-level permission to its methods, and lets a method override it', () => {
    expect(
      run('inherited', ClassLevelController, { auth: auth({ 'admin.user.view': 'all' }) }),
    ).toBe(true);
    expect(() =>
      run('inherited', ClassLevelController, { auth: auth({ 'leave.approve': 'all' }) }),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(
      run('overridden', ClassLevelController, { auth: auth({ 'leave.approve': 'all' }) }),
    ).toBe(true);
    expect(() =>
      run('overridden', ClassLevelController, { auth: auth({ 'admin.user.view': 'all' }) }),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
