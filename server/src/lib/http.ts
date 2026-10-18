/* Request plumbing shared by the routes: idempotency, the Origin check,
   validation, and staff sessions with CSRF. */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { ApiError, E } from './errors.js';
import { safeEqual, sha256, token } from './util.js';
import type { Role } from '../services/records.js';
import { permissions } from '../services/records.js';

export interface Result { status: number; body: unknown }

/* Idempotency-Key: the same key and body return the first answer and do
   nothing twice. The same key with a different body is refused. A failure
   on the server's side (5xx) is forgotten, so a retry can succeed. */
export async function idempotent(db: Db, req: FastifyRequest, scope: string, run: () => Promise<Result>): Promise<Result> {
  const key = String(req.headers['idempotency-key'] || '');
  if (!key) return run();
  if (key.length > 100) throw E.validation({ 'Idempotency-Key': 'Too long.' });
  const hash = sha256(JSON.stringify(req.body ?? null));
  const inserted = await db.query(
    `insert into rayhab.idempotency_keys (scope, key, request_hash) values ($1, $2, $3)
     on conflict do nothing returning key`, [scope, key, hash]);
  if (!inserted.length) {
    const row = await db.one<{ request_hash: string; status_code: number | null; response: unknown }>(
      'select request_hash, status_code, response from rayhab.idempotency_keys where scope = $1 and key = $2', [scope, key]);
    if (row && row.request_hash !== hash) throw new ApiError(422, 'idempotency_mismatch', 'This key was already used for a different request.');
    if (row && row.status_code == null) throw new ApiError(409, 'in_progress', 'The same request is still being handled.');
    return { status: row!.status_code!, body: typeof row!.response === 'string' ? JSON.parse(row!.response as string) : row!.response };
  }
  const save = (status: number, body: unknown) => db.query(
    'update rayhab.idempotency_keys set status_code = $3, response = $4 where scope = $1 and key = $2',
    [scope, key, status, JSON.stringify(body)]);
  try {
    const res = await run();
    await save(res.status, res.body);
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) { await save(err.status, err.body()); }
    else await db.query('delete from rayhab.idempotency_keys where scope = $1 and key = $2', [scope, key]);
    throw err;
  }
}

export function send(reply: FastifyReply, res: Result) { return reply.code(res.status).send(res.body); }

/* Browser writes must come from the site itself. */
export function checkOrigin(cfg: Config, req: FastifyRequest) {
  const origin = req.headers.origin;
  if (!origin || cfg.origins.indexOf(origin) < 0) throw E.forbidden('origin', 'Requests must come from the clinic’s website.');
}

/* zod parse with the API's 422 shape: { errors: { field: message } }. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? 'body');
    if (!errors[k]) errors[k] = i.message;
  }
  throw E.validation(errors);
}

/* ---------- Staff sessions ----------
   The API's own session, issued after the password and the authenticator
   code: an opaque cookie (HttpOnly, Secure, SameSite=Strict, Path=/api/admin)
   whose hash is stored, and a CSRF token every change must echo back. */
export const SESSION_COOKIE = 'rh_admin';
export const PENDING_COOKIE = 'rh_pending';
export const LOGIN_URL = '/admin/login.html';
export const LOGOUT_URL = '/admin/login.html?signout=1';

export interface Staff { id: string; name: string; role: Role; auth_user_id: string | null; csrf: string; sessionHash: string }

export function cookieOpts(cfg: Config, maxAgeSec: number) {
  return { path: '/api/admin', httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'strict' as const, maxAge: maxAgeSec };
}

export async function createSession(db: Db, cfg: Config, reply: FastifyReply, practitionerId: string, ua: string) {
  const raw = token();
  const csrf = token();
  const hours = cfg.SESSION_HOURS;
  await db.query(`insert into rayhab.staff_sessions (id_hash, practitioner_id, csrf_token, expires_at, user_agent)
                  values ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
                 [sha256(raw), practitionerId, csrf, hours, ua.slice(0, 200)]);
  reply.setCookie(SESSION_COOKIE, raw, cookieOpts(cfg, hours * 3600));
}

export async function staffFrom(db: Db, req: FastifyRequest): Promise<Staff | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const h = sha256(raw);
  const row = await db.one<{ id: string; name: string; role: Role; auth_user_id: string | null; csrf_token: string }>(
    `select p.id, p.name, p.role, p.auth_user_id, s.csrf_token
       from rayhab.staff_sessions s join rayhab.practitioners p on p.id = s.practitioner_id
      where s.id_hash = $1 and s.expires_at > now() and p.active`, [h]);
  if (!row) return null;
  await db.query('update rayhab.staff_sessions set last_seen_at = now() where id_hash = $1', [h]);
  return { id: row.id, name: row.name, role: row.role, auth_user_id: row.auth_user_id, csrf: row.csrf_token, sessionHash: h };
}

/* Every admin route: a live session, and for changes the CSRF token and
   the site's own Origin. */
export async function requireStaff(db: Db, cfg: Config, req: FastifyRequest): Promise<Staff> {
  const staff = await staffFrom(db, req);
  if (!staff) throw E.unauthenticated(LOGIN_URL, req.cookies[SESSION_COOKIE] ? 'session_expired' : 'unauthenticated',
                                      req.cookies[SESSION_COOKIE] ? 'Your session has expired.' : 'Sign in to continue.');
  if (req.method !== 'GET') {
    checkOrigin(cfg, req);
    const sent = String(req.headers['x-csrf-token'] || '');
    if (!sent || !safeEqual(sent, staff.csrf)) throw E.forbidden('csrf', 'Missing or wrong CSRF token.');
  }
  return staff;
}

export function can(staff: Staff, what: 'confirm_cash' | 'manage_schedule') {
  if (!permissions(staff.role)[what]) throw E.forbidden('forbidden', 'You do not have permission to do this.');
}
