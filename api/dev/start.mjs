// npm run dev --prefix api/dev: the whole site on one port.
//
//   http://localhost:4700/       the website (site/), as Apache will serve it
//   http://localhost:4700/api/   the PHP API, through PHP's built-in server
//   PostgreSQL                   PGlite, in api/dev/.dev-db (delete it to start fresh)
//   staff sign-in                dev@rayhab.test / rayhab-dev, then any authenticator app
//   WhatsApp and email           written to this terminal, payment links included
//   Whish                        the sandbox checkout
//
// The cron worker runs every five seconds. Never used in production: the
// API's configuration refuses these drivers there.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDb, phpBinary, run } from './lib.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const api = fileURLToPath(new URL('..', import.meta.url));
const site = fileURLToPath(new URL('../../site', import.meta.url));
const PORT = Number(process.env.PORT || 4700);
const PHP = phpBinary();

const db = await startDb({ port: 5433, dataDir: process.env.DEV_DB === 'memory' ? undefined : here + '.dev-db' });
const envFile = here + 'dev.env';
writeFileSync(envFile, [
  'DEPLOY_ENV=development',
  `PUBLIC_ORIGIN=http://localhost:${PORT}`,
  `EXTRA_ORIGINS=http://127.0.0.1:${PORT}`,
  `DATABASE_URL=${db.url}`,
  'APP_SECRET=dev-only-secret-not-for-production-0000000000',
  'COOKIE_SECURE=false',
  'AUTH_DRIVER=dev',
  'DEV_STAFF=dev@rayhab.test:rayhab-dev:pr-rayan',
  'WHATSAPP_DRIVER=log',
  'EMAIL_DRIVER=log',
  'STAFF_EMAILS=clinic@rayhab.test',
  'WHISH_DRIVER=sandbox'
].join('\n') + '\n');

const env = { ...process.env, RAYHAB_ENV_FILE: envFile, DATABASE_MIGRATE_URL: db.url };
// Not execFileSync: the database lives in this process and must keep answering.
await run(PHP, [api + 'bin/migrate.php'], env);
// Sample prices, so the payment flow can be tried, and the dev staff account.
await run(PHP, [here + 'prepare.php'], env);

const server = spawn(PHP, ['-S', `127.0.0.1:${PORT}`, '-t', site, here + 'router.php'], { env, stdio: 'inherit' });
const worker = setInterval(() => {
  const w = spawn(PHP, [api + 'bin/worker.php'], { env, stdio: 'inherit' });
  w.on('error', () => {});
}, 5000);
console.log(`Rayhab dev: http://localhost:${PORT}  (staff: dev@rayhab.test / rayhab-dev)`);

const stop = async () => { clearInterval(worker); server.kill(); await db.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', stop);
