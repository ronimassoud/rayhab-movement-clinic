/* The database, behind one small interface.

   Plain SQL with $1 placeholders, run either on PostgreSQL (postgres.js:
   Supabase in production, a postgres:16 service in CI) or on PGlite, an
   in-process PostgreSQL used for local development and tests. Both are real
   PostgreSQL, so constraints, transactions and ranges behave the same.

   Every table lives in the private schema "rayhab", which Supabase's Data
   API does not expose; the browser never reaches the database. */
export interface Db {
  query<T = Record<string, any>>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(text: string, params?: unknown[]): Promise<T | undefined>;
  /* Several statements in one go, no parameters (migrations). */
  exec(text: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* PostgreSQL error codes the API turns into answers. */
export const PG = {
  unique: '23505',
  exclusion: '23P01',
  serialization: '40001'
};

export function pgCode(err: unknown): string {
  return (err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '');
}

export async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  // Supabase: use the session pooler (port 5432). Prepared statements are
  // left off so the transaction pooler would also work.
  const sql = postgres(url, {
    max: 10, prepare: false, idle_timeout: 30,
    connection: { search_path: 'rayhab,extensions,public', application_name: 'rayhab-api' }
  });
  const wrap = (s: any): Db => ({
    query: async (text, params = []) => (await s.unsafe(text, params as any[])) as any[],
    one: async (text, params = []) => ((await s.unsafe(text, params as any[])) as any[])[0],
    exec: async (text) => { await s.unsafe(text); },
    tx: (fn) => (s.begin ? s.begin((t: any) => fn(wrap(t))) : fn(wrap(s))) as any,
    close: async () => { await sql.end({ timeout: 5 }); }
  });
  return wrap(sql);
}

export async function connectPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const pg = new PGlite({ dataDir, extensions: { btree_gist } });
  await pg.exec('set search_path to rayhab, public, extensions');
  // PGlite is one connection: transactions are queued so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const wrap = (q: any, inTx: boolean): Db => ({
    query: async (text, params = []) => (await q.query(text, params)).rows,
    one: async (text, params = []) => (await q.query(text, params)).rows[0],
    exec: async (text) => { await q.exec(text); },
    tx: (fn) => {
      if (inTx) return fn(wrap(q, true));
      const run = chain.then(() => pg.transaction((t: any) => fn(wrap(t, true))));
      chain = run.catch(() => undefined);
      return run as any;
    },
    close: async () => { await pg.close(); }
  });
  return wrap(pg, false);
}
