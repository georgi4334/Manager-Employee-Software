import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, base64url (43 characters). Used for refresh tokens and one-time links. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only hashes of tokens are stored, so a database leak does not expose usable tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
