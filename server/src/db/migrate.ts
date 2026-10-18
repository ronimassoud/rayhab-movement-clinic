/* Applies migrations/NNN_*.sql in order, each once, each in its own
   transaction. Run by deploy.sh before a new API version starts, with the
   schema owner's connection (DATABASE_MIGRATE_URL), never the API's own.

   Migrations only ever move forward. Rolling back the application does not
   roll back the schema, so every migration keeps the previous API version
   working (add, never rename or drop in the same release). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

const DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.query('create schema if not exists rayhab');
  await db.query(`create table if not exists rayhab.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from rayhab.schema_migrations')).map((r) => r.name));
  const files = readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(DIR + f, 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('insert into rayhab.schema_migrations (name) values ($1)', [f]);
    });
    applied.push(f);
    log('migrated ' + f);
  }
  if (!applied.length) log('database is up to date');
  return applied;
}
