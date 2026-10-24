import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = resolve(dirname(fileURLToPath(import.meta.url)), '../.run');

/** The invitation link of the first administrator, printed by `tenant:create`. */
export const adminInvitation = (): string =>
  readFileSync(resolve(run, 'admin-invite.txt'), 'utf8').trim();

/**
 * The newest invitation link mailed to an address. The API runs with the log mail transport, so its log holds
 * every message; this is the e2e stand-in for the person's inbox.
 */
export function invitationFor(email: string): string {
  const log = readFileSync(resolve(run, 'api.log'), 'utf8');
  let found: string | undefined;
  for (const block of log.split(/To: /).slice(1)) {
    if (!block.startsWith(email)) continue;
    const link = /(https?:\/\/[^\s"\\]*accept-invitation[^\s"\\]*)/.exec(block)?.[1];
    if (link) found = link;
  }
  if (!found) throw new Error(`No invitation mailed to ${email} yet`);
  return found;
}
