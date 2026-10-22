import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { testUser } from '@/tests/server';
import { authKeys } from './api';
import { clearSession, startSession } from './session';

describe('session helpers', () => {
  it('startSession stores the signed-in user', () => {
    const client = new QueryClient();
    startSession(client, testUser);
    expect(client.getQueryData(authKeys.me)).toEqual(testUser);
  });

  it('clearSession signs out and drops cached data of the previous user', () => {
    const client = new QueryClient();
    startSession(client, testUser);
    client.setQueryData(['employees', 'list'], [{ name: 'Maria' }]);
    client.setQueryData(['leave', 'balance'], { days: 12 });

    clearSession(client);

    expect(client.getQueryData(authKeys.me)).toBeNull();
    expect(client.getQueryData(['employees', 'list'])).toBeUndefined();
    expect(client.getQueryData(['leave', 'balance'])).toBeUndefined();
  });

  it('clearSession keeps public sign-in data the login page is showing', () => {
    const client = new QueryClient();
    client.setQueryData(authKeys.providers, { google: true });
    clearSession(client);
    expect(client.getQueryData(authKeys.providers)).toEqual({ google: true });
  });

  it('clearSession works when nobody was signed in', () => {
    const client = new QueryClient();
    expect(() => clearSession(client)).not.toThrow();
    expect(client.getQueryData(authKeys.me)).toBeNull();
  });
});
