/* A fresh API on a fresh database for each test file: PGlite in memory by
   default, or a real PostgreSQL when TEST_DATABASE_URL is set (CI). */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { connectPglite, connectPostgres, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { seed, SEED_PRACTITIONER } from '../src/db/seed.js';
import { boot } from '../src/boot.js';
import { buildApp } from '../src/app.js';
import { devUserId, totp } from '../src/integrations/auth.js';
import { T } from '../src/lib/util.js';

export const ORIGIN = 'https://dr-rayhab.test';
export const STAFF = { email: 'staff@rayhab.test', password: 'correct horse battery' };

export interface Ctx { app: FastifyInstance; db: Db; deps: Awaited<ReturnType<typeof boot>> }

export async function setup(extra: Record<string, string> = {}): Promise<Ctx> {
  let db: Db;
  if (process.env.TEST_DATABASE_URL) {
    // A database of its own for every setup, as each PGlite one is, so one
    // test's fresh start never wipes another's data mid-run.
    const admin = await connectPostgres(process.env.TEST_DATABASE_URL);
    const name = 'rayhab_t_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await admin.exec('create database ' + name);
    await admin.close();
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = '/' + name;
    db = await connectPostgres(url.toString());
  } else {
    db = await connectPglite();
  }
  await migrate(db, () => {});
  await seed(db, () => {});
  await db.query(`update rayhab.services set price_amount = 8000`);
  await db.query('update rayhab.practitioners set auth_user_id = $1 where id = $2', [devUserId(STAFF.email), SEED_PRACTITIONER.id]);
  const deps = await boot({
    DEPLOY_ENV: 'test', PUBLIC_ORIGIN: ORIGIN, APP_SECRET: 'test-secret-test-secret-test-secret-0000',
    COOKIE_SECURE: 'false', AUTH_DRIVER: 'dev', DEV_STAFF: STAFF.email + ':' + STAFF.password + ':' + SEED_PRACTITIONER.id,
    WHATSAPP_DRIVER: 'log', EMAIL_DRIVER: 'log', STAFF_EMAILS: 'clinic@rayhab.test', WHISH_DRIVER: 'sandbox',
    HORIZON_DAYS: '200', LOG_LEVEL: 'silent', ...extra
  } as any, db);
  const app = await buildApp(deps, { logger: false });
  await app.ready();
  return { app, db, deps };
}

/* The next open clinic day at least `from` days ahead (closed Sun and Wed). */
export function openDay(from = 1): string {
  let d = T.addDays(T.today(), from);
  while ([0, 3].includes(T.dow(d))) d = T.addDays(d, 1);
  return d;
}

/* The next day open mornings and afternoons (not Saturday). */
export function fullDay(from = 1): string {
  let d = openDay(from);
  while (T.dow(d) === 6 || [0, 3].includes(T.dow(d))) d = T.addDays(d, 1);
  return d;
}

export function booking(over: Record<string, unknown> = {}) {
  return {
    service_id: 'assessment', practitioner_id: null, for_whom: 'me', mode: 'clinic',
    date: fullDay(), time: '09:00', timezone: 'Asia/Beirut',
    first_name: 'Maya', last_name: 'Khoury', phone: '+96170000101', email: 'maya@example.com', note: '',
    consents: { storage: true, whatsapp: true, version: '2026-10-15' }, website: '', elapsed_ms: 40000,
    ...over
  };
}

let ipSeq = 0;
type Inject = { method?: string; url: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string> };

export async function call(ctx: Ctx, o: Inject): Promise<LightMyRequestResponse & { json: () => any }> {
  const method = (o.method || (o.body !== undefined ? 'POST' : 'GET')) as any;
  // Each call comes from its own address (through the trusted proxy), as
  // separate visitors would, so the per-IP rate limits only bite where a
  // test means them to.
  ipSeq = (ipSeq + 1) % 60000;
  const headers: Record<string, string> = { 'x-forwarded-for': '10.' + (ipSeq >> 8) + '.' + (ipSeq & 255) + '.9',
    ...(method !== 'GET' ? { origin: ORIGIN } : {}), ...(o.headers || {}) };
  return ctx.app.inject({ method, url: o.url, payload: o.body as any, headers, cookies: o.cookies }) as any;
}

/* Signs a staff member in through the real flow: password, authenticator
   set-up, code. Returns the session cookie and CSRF token. */
export async function signIn(ctx: Ctx) {
  const login = await call(ctx, { url: '/api/admin/login', body: { email: STAFF.email, password: STAFF.password } });
  const pending = login.cookies.find((c) => c.name === 'rh_pending')!.value;
  let secret: string;
  if (login.json().mfa === 'enroll') {
    const enroll = await call(ctx, { url: '/api/admin/mfa/enroll', body: {}, cookies: { rh_pending: pending } });
    secret = enroll.json().secret;
    (ctx as any).secret = secret;
  } else secret = (ctx as any).secret;
  const verify = await call(ctx, { url: '/api/admin/mfa/verify', body: { code: totp(secret) }, cookies: { rh_pending: pending } });
  const session = verify.cookies.find((c) => c.name === 'rh_admin')!.value;
  const s = await call(ctx, { url: '/api/admin/session', cookies: { rh_admin: session } });
  return { cookies: { rh_admin: session }, csrf: s.json().csrf_token as string };
}

export function staffCall(ctx: Ctx, staff: { cookies: Record<string, string>; csrf: string }, o: Inject) {
  return call(ctx, { ...o, cookies: staff.cookies, headers: { 'x-csrf-token': staff.csrf, ...(o.headers || {}) } });
}

/* Approves a request and returns the link token the WhatsApp message carries. */
export async function approve(ctx: Ctx, staff: any, apptId: string): Promise<string> {
  const r = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + apptId + '/approve', body: {} });
  if (r.statusCode !== 200) throw new Error('approve failed: ' + r.body);
  return linkFromOutbox(ctx, apptId, 'approved');
}

export async function linkFromOutbox(ctx: Ctx, apptId: string, template: string): Promise<string> {
  const { unseal } = await import('../src/lib/util.js');
  const row = await ctx.db.one<any>(`select payload from rayhab.notification_outbox where appointment_id = $1 and template = $2
                                      order by id desc limit 1`, [apptId, template]);
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return unseal(ctx.deps.cfg.APP_SECRET, payload.link_sealed);
}
