import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Binds a ciphertext to its row, so a copy moved to another workspace, scope or person does not decrypt. */
export const credentialAad = (tenantId: string, scope: string, userId: string | null): string =>
  `${tenantId}|${scope}|${userId ?? ''}`;

/** AES-256-GCM with a random 96-bit IV: "iv.tag.ciphertext", each part base64. */
export function encryptSecret(masterKey: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

/** Throws when the master key, the additional data or the payload does not match. */
export function decryptSecret(masterKey: Buffer, payload: string, aad: string): string {
  const [iv, tag, data] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !data || iv.length !== 12 || tag.length !== 16) {
    throw new Error('malformed secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
