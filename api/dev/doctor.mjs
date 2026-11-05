// Runs the doctor (api/bin/doctor.php) from this computer against the real
// staging or production setup: the same settings Vercel gets
// (infra/vercel/settings.mjs), so it checks the database as rayhab_app,
// the migrations, prices, the linked staff account, Supabase sign-in, and
// with --email it sends one test email through Resend.
//
//   node api/dev/doctor.mjs production --email you@example.com
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { phpBinary } from './lib.mjs';
import { settingsFor } from '../../infra/vercel/settings.mjs';

const [env, ...rest] = process.argv.slice(2);
let s;
try { s = settingsFor(env); } catch (e) { console.error(e.message); process.exit(1); }
const script = fileURLToPath(new URL('../bin/doctor.php', import.meta.url));
const childEnv = { ...process.env, ...s };
delete childEnv.RAYHAB_ENV_FILE;
const r = spawnSync(phpBinary(), [script, ...rest], { env: childEnv, stdio: 'inherit' });
process.exit(r.status ?? 1);
