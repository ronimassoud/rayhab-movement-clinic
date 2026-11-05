// Requests about one person's data (api/bin/subject.php), run from this
// computer against the real database, with the settings Vercel has:
//
//   node api/dev/subject.mjs production find --phone "+961 70 000 000"
//   node api/dev/subject.mjs production export --email them@example.com > request.json
//   node api/dev/subject.mjs production erase --phone "+961 70 000 000" --yes
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { phpBinary } from './lib.mjs';
import { settingsFor } from '../../infra/vercel/settings.mjs';

const [env, ...rest] = process.argv.slice(2);
let s;
try { s = settingsFor(env); } catch (e) { console.error(e.message); process.exit(1); }
const script = fileURLToPath(new URL('../bin/subject.php', import.meta.url));
const childEnv = { ...process.env, ...s };
delete childEnv.RAYHAB_ENV_FILE;
const r = spawnSync(phpBinary(), [script, ...rest], { env: childEnv, stdio: 'inherit' });
process.exit(r.status ?? 1);
