// Shared by start.mjs and test.mjs: a PostgreSQL for PHP to talk to, with
// nothing to install. PGlite is PostgreSQL compiled to WebAssembly; its
// socket server speaks the normal wire protocol, so pdo_pgsql connects to
// it like to Supabase.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export async function startDb({ port, dataDir }) {
  const db = await PGlite.create({ dataDir, extensions: { btree_gist } });
  // Several connections, as PHP opens one per request; PGlite runs their queries one at a time.
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  return { url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`, stop: async () => { await server.stop(); await db.close(); } };
}

// PHP: $PHP, then php on the PATH, then where winget puts it on Windows.
export function phpBinary() {
  if (process.env.PHP) return process.env.PHP;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const link = join(local, 'Microsoft', 'WinGet', 'Links', 'php.exe');
    if (existsSync(link)) return link;
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(pkgs)) {
      const dir = readdirSync(pkgs).filter((d) => /^PHP\.PHP\.8\./.test(d)).sort().pop();
      if (dir && existsSync(join(pkgs, dir, 'php.exe'))) return join(pkgs, dir, 'php.exe');
    }
  }
  return 'php';
}

// Runs a command to completion without blocking this process.
export function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exited with ' + code))));
  });
}
