import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { credentialAad, decryptSecret, encryptSecret } from './ai-crypto.js';

const key = randomBytes(32);
const aad = credentialAad('t1', 'user', 'u1');

describe('ai secret encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const payload = encryptSecret(key, 'gsk_secret-value-1234', aad);
    expect(payload).not.toContain('secret-value');
    expect(payload.split('.')).toHaveLength(3);
    expect(decryptSecret(key, payload, aad)).toBe('gsk_secret-value-1234');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret(key, 'same', aad)).not.toBe(encryptSecret(key, 'same', aad));
  });

  it('refuses another master key', () => {
    const payload = encryptSecret(key, 'x-secret-key', aad);
    expect(() => decryptSecret(randomBytes(32), payload, aad)).toThrow();
  });

  it.each([
    ['another workspace', credentialAad('t2', 'user', 'u1')],
    ['another person', credentialAad('t1', 'user', 'u2')],
    ['another scope', credentialAad('t1', 'workspace', null)],
  ])('refuses a ciphertext moved to %s', (_name, other) => {
    const payload = encryptSecret(key, 'x-secret-key', aad);
    expect(() => decryptSecret(key, payload, other)).toThrow();
  });

  it('refuses tampered and malformed payloads', () => {
    const [iv, tag, data] = encryptSecret(key, 'x-secret-key', aad).split('.') as [
      string,
      string,
      string,
    ];
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      decryptSecret(key, [iv, tag, flipped.toString('base64')].join('.'), aad),
    ).toThrow();
    expect(() => decryptSecret(key, 'nonsense', aad)).toThrow();
    expect(() => decryptSecret(key, '', aad)).toThrow();
    expect(() => decryptSecret(key, `${iv}.${tag}`, aad)).toThrow();
  });
});
