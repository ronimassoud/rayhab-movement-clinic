// npm test --prefix api/dev: the PHP tests against an in-memory PostgreSQL
// (PGlite), with nothing to install. CI runs the same tests against a real
// PostgreSQL 16 (TEST_DATABASE_URL), without this file.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startDb, phpBinary } from './lib.mjs';

const api = fileURLToPath(new URL('..', import.meta.url));
const db = await startDb({ port: 5434 });
const p = spawn(phpBinary(), [api + 'tests/run.php', ...process.argv.slice(2)], { env: { ...process.env, TEST_DATABASE_URL: db.url }, stdio: 'inherit' });
p.on('exit', async (code) => { await db.stop(); process.exit(code ?? 1); });
