import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { isPermissionCode } from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  IS_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from '../src/common/auth/decorators.js';
import { createTestApp } from './helpers.js';

/**
 * The safety net behind "secure by default": every route of the real application must say how it is
 * protected. A new endpoint without @Public(), @Authenticated() or @RequirePermission(...) fails here
 * (and is refused with 403 at runtime), so nobody can ship an endpoint that every signed-in user can call.
 */
describe('route inventory', () => {
  let app: NestExpressApplication;
  const routes: { route: string; declaration: string }[] = [];
  const problems: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ prisma: { $queryRaw: vi.fn(), $disconnect: vi.fn() } });
    const discovery = new DiscoveryService(app.get(ModulesContainer));
    const scanner = new MetadataScanner();
    const reflector = app.get(Reflector);

    for (const wrapper of discovery.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype) continue;
      const prototype = metatype.prototype as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as () => unknown;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const route = `${metatype.name}.${name} [${['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][method] ?? method} ${path}]`;
        const targets = [handler, metatype];

        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
        const isAuthenticated = reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets);
        const permissions = reflector.getAllAndOverride<string[] | undefined>(
          REQUIRED_PERMISSIONS,
          targets,
        );

        const declarations = [
          isPublic && 'public',
          isAuthenticated && 'authenticated',
          permissions && `permission:${permissions.join('+')}`,
        ].filter(Boolean) as string[];
        routes.push({ route, declaration: declarations.join(', ') });
        if (declarations.length === 0) problems.push(`${route} declares no protection`);
        if (isPublic && (isAuthenticated || permissions))
          problems.push(`${route} is public AND protected`);
        for (const code of permissions ?? []) {
          if (!isPermissionCode(code))
            problems.push(`${route} requires unknown permission ${code}`);
        }
      }
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('finds the application’s routes (the scan itself works)', () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.some((r) => r.route.includes('UsersController.disable'))).toBe(true);
    expect(routes.some((r) => r.route.includes('HealthController.ready'))).toBe(true);
  });

  it('every route declares exactly one kind of protection with real permission codes', () => {
    expect(problems).toEqual([]);
  });

  it('only health checks, the sign-in flow and the reminder hook are public', () => {
    const publicRoutes = routes
      .filter((r) => r.declaration === 'public')
      .map((r) => r.route.split('.')[0]);
    // The reminder hook is public to the guard because it has no user: it checks a shared secret itself.
    expect(new Set(publicRoutes)).toEqual(
      new Set(['HealthController', 'AuthController', 'RemindersController']),
    );
    expect(
      routes.filter((r) => r.route.startsWith('RemindersController')).map((r) => r.route),
    ).toEqual(['RemindersController.run [POST reminders/run]']);
    const publicAuth = routes
      .filter((r) => r.route.startsWith('AuthController') && r.declaration === 'public')
      .map((r) => r.route.split(' ')[0]);
    expect(publicAuth).not.toContain('AuthController.me');
  });

  it('account administration requires specific permissions, not just a login', () => {
    const users = routes.filter((r) => r.route.startsWith('UsersController'));
    expect(users.length).toBe(6);
    for (const route of users)
      expect(route.declaration, route.route).toMatch(/^permission:admin\./);
  });
});
