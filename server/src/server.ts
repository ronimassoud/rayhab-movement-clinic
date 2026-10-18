/* The API process (production and the staging backend). */
import { buildApp } from './app.js';
import { boot } from './boot.js';

const deps = await boot();
const app = await buildApp(deps);
await app.listen({ host: deps.cfg.HOST, port: deps.cfg.PORT });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    await deps.db.close();
    process.exit(0);
  });
}
