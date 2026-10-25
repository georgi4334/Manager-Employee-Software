// Starts a fresh, isolated API for the end-to-end tests (docs/adr/0012-e2e-and-accessibility.md):
// creates the database, applies the migrations, creates the first workspace and then runs the API in the
// foreground (Playwright stops it). The invitation link of the first administrator goes to .run/admin-invite.txt
// and everything the API mails (log transport) ends up in .run/api.log, where the tests read their links.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = resolve(root, 'e2e/.run');
mkdirSync(run, { recursive: true });

const owner = new URL(
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/postgres',
);
const database = 'intime_e2e';
const withRole = (role, password) => {
  const url = new URL(owner);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
};
const ownerDb = new URL(owner);
ownerDb.pathname = `/${database}`;
const admin = new URL(owner);
admin.pathname = '/postgres';

const exec = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};
const psql = (url, ...args) => exec('psql', [url.toString(), '-v', 'ON_ERROR_STOP=1', ...args]);

psql(
  admin,
  '-q',
  '-c',
  `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`,
  '-c',
  `CREATE DATABASE ${database}`,
);
psql(
  ownerDb,
  '-q',
  '-v',
  'app_password=intime_app',
  '-v',
  'system_password=intime_system',
  '-f',
  resolve(root, 'ops/bootstrap-db.sql'),
);

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: withRole('intime_app', 'intime_app'),
  SYSTEM_DATABASE_URL: withRole('intime_system', 'intime_system'),
  MIGRATION_DATABASE_URL: ownerDb.toString(),
  WEB_APP_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234567',
  MAIL_TRANSPORT: 'log',
  LOG_LEVEL: 'info',
  WORKER_ENABLED: 'true',
  REMINDERS_TOKEN: 'e2e-reminders-token-e2e-reminders-token-1234',
};

// Always through turbo: a cache hit is instant, and a stale dist/ would test yesterday's API.
exec('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@intime/api']);
exec('pnpm', ['--filter', '@intime/api', 'db:deploy'], { env });

const created = spawnSync(
  'pnpm',
  [
    '--filter',
    '@intime/api',
    'tenant:create',
    '--name',
    'Acme',
    '--slug',
    'acme',
    '--admin-email',
    'admin@acme.eu',
    '--admin-first-name',
    'Ada',
    '--admin-last-name',
    'Admin',
    '--timezone',
    'Europe/Sofia',
  ],
  { cwd: root, env, encoding: 'utf8' },
);
if (created.status !== 0)
  throw new Error(`tenant:create failed:\n${created.stdout}\n${created.stderr}`);
const link = /(https?:\/\/\S*accept-invitation\S*)/.exec(created.stdout)?.[1];
if (!link) throw new Error(`no invitation link in:\n${created.stdout}`);
writeFileSync(resolve(run, 'admin-invite.txt'), link);

const log = openSync(resolve(run, 'api.log'), 'w');
const api = spawn('node', ['dist/main.js'], {
  cwd: resolve(root, 'apps/api'),
  env,
  stdio: ['ignore', log, log],
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => api.kill(signal));
api.on('exit', (code) => process.exit(code ?? 0));
