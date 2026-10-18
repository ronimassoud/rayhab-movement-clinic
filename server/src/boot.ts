/* What every process needs: configuration, the database, the drivers. */
import { loadConfig, type Config } from './config.js';
import { connectPostgres, type Db } from './db/db.js';
import { devAuth, supabaseAuth, type AuthDriver } from './integrations/auth.js';
import { whishDriver } from './integrations/whish.js';

export async function boot(env = process.env, db?: Db) {
  const cfg: Config = loadConfig(env);
  const database = db || (await connectPostgres(cfg.DATABASE_URL));
  const auth: AuthDriver = cfg.AUTH_DRIVER === 'dev' ? devAuth(cfg.DEV_STAFF) : supabaseAuth(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return { cfg, db: database, auth, whish: whishDriver(cfg, database) };
}
