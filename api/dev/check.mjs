// Checks Supabase and Resend from this computer, using infra/connect.<env>.env:
//   node api/dev/check.mjs production [--email you@example.com]
// Finds PHP (as start.mjs does) and runs api/bin/check-connect.php.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { phpBinary } from './lib.mjs';

const script = fileURLToPath(new URL('../bin/check-connect.php', import.meta.url));
const r = spawnSync(phpBinary(), [script, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
