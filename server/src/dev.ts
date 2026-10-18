/* npm run dev: the whole site on one port, with nothing to install.

     http://localhost:4700/          the website (site/), as Nginx will serve it
     http://localhost:4700/api/      this API
     PostgreSQL                      PGlite, in server/.dev-db (delete it to start fresh)
     staff sign-in                   DEV_STAFF, default dev@rayhab.test / rayhab-dev
     WhatsApp and email              written to the log
     Whish                           the sandbox checkout

   The worker runs in the same process every two seconds. Never used in
   production: config refuses these drivers there. */
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { connectPglite } from './db/db.js';
import { migrate } from './db/migrate.js';
import { seed, SEED_PRACTITIONER } from './db/seed.js';
import { boot } from './boot.js';
import { buildApp } from './app.js';
import { devUserId } from './integrations/auth.js';
import { mailer, whatsapp } from './integrations/messaging.js';
import { startWorker } from './worker/jobs.js';

const PORT = Number(process.env.PORT || 4700);
const env = {
  DEPLOY_ENV: 'development',
  PORT: String(PORT),
  PUBLIC_ORIGIN: 'http://localhost:' + PORT,
  EXTRA_ORIGINS: 'http://127.0.0.1:' + PORT,
  APP_SECRET: 'dev-only-secret-not-for-production-0000000000',
  COOKIE_SECURE: 'false',
  AUTH_DRIVER: 'dev',
  DEV_STAFF: 'dev@rayhab.test:rayhab-dev:' + SEED_PRACTITIONER.id,
  WHATSAPP_DRIVER: 'log',
  EMAIL_DRIVER: 'log',
  STAFF_EMAILS: 'clinic@rayhab.test',
  WHISH_DRIVER: 'sandbox',
  LOG_LEVEL: 'info',
  ...process.env
};

const dataDir = process.env.DEV_DB === 'memory' ? undefined : fileURLToPath(new URL('../.dev-db', import.meta.url));
const db = await connectPglite(dataDir);
await migrate(db);
await seed(db);
// Sample prices so the payment flow can be tried; the clinic sets the real ones.
await db.query(`update rayhab.services set price_amount = case when duration_min >= 60 then 8000 else 6000 end where price_amount is null`);
for (const u of env.DEV_STAFF.split(',')) {
  const [email, , pid] = u.split(':');
  await db.query('update rayhab.practitioners set auth_user_id = $1 where id = $2', [devUserId(email), pid]);
}

const deps = await boot(env, db);
const app = await buildApp(deps, { logger: { level: env.LOG_LEVEL, transport: undefined } });
await app.register(fastifyStatic, { root: fileURLToPath(new URL('../../site/', import.meta.url)), prefix: '/', wildcard: true });
startWorker({ ...deps, wa: whatsapp(deps.cfg, app.log), mail: await mailer(deps.cfg, app.log), log: app.log }, { tickMs: 2000 });
await app.listen({ host: '127.0.0.1', port: PORT });
app.log.info('Rayhab dev: http://localhost:' + PORT + '  (staff: ' + env.DEV_STAFF.split(':').slice(0, 2).join(' / ') + ')');
