/* The background worker process: messages, holds, payment reconciliation,
   reminders. Runs beside the API from the same image (infra/compose.yaml). */
import { writeFileSync } from 'node:fs';
import pino from 'pino';
import { boot } from './boot.js';
import { mailer, whatsapp } from './integrations/messaging.js';
import { startWorker } from './worker/jobs.js';

const deps = await boot();
const log = pino({ level: deps.cfg.LOG_LEVEL, name: 'rayhab-worker' });
const worker = startWorker({ ...deps, wa: whatsapp(deps.cfg, log), mail: await mailer(deps.cfg, log), log });
log.info('worker started');

// The container's health check reads this file's age (infra/compose.yaml).
const beat = () => { try { writeFileSync('/tmp/heartbeat', String(Date.now())); } catch { /* not in a container */ } };
beat();
setInterval(beat, 15000).unref();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    log.info({ sig }, 'worker stopping');
    worker.stop();
    await deps.db.close();
    process.exit(0);
  });
}
