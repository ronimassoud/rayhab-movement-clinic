/* Staff sign-in: password, then an authenticator code (TOTP), always.

     POST /api/admin/login        { email, password } -> { mfa: "verify" | "enroll" }
     POST /api/admin/mfa/enroll   first sign-in only  -> { qr_code, secret }
     POST /api/admin/mfa/verify   { code }            -> { ok: true }, session cookie set
     POST /api/admin/logout

   Between the steps, the identity provider's first-step token is kept
   server-side, sealed, for five minutes, behind a short-lived cookie.
   Five wrong codes end the attempt. */
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../lib/errors.js';
import { checkOrigin, cookieOpts, createSession, parse, PENDING_COOKIE, SESSION_COOKIE } from '../lib/http.js';
import { seal, sha256, token, unseal } from '../lib/util.js';
import { logEvent } from '../services/records.js';

interface Pending { accessToken: string; userId: string; practitionerId: string; factorId: string | null; enrolled: boolean; tries: number }

const expired = () => new ApiError(401, 'login_expired', 'The sign-in took too long. Start again.');

export function authRoutes(app: FastifyInstance, { cfg, db, auth }: Deps) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  async function readPending(req: FastifyRequest): Promise<{ hash: string; p: Pending }> {
    const raw = req.cookies[PENDING_COOKIE];
    if (!raw) throw expired();
    const row = await db.one<{ sealed: string }>('select sealed from rayhab.auth_pending where id_hash = $1 and expires_at > now()', [sha256(raw)]);
    if (!row) throw expired();
    return { hash: sha256(raw), p: JSON.parse(unseal(cfg.APP_SECRET, row.sealed)) };
  }
  async function writePending(hash: string, p: Pending) {
    await db.query('update rayhab.auth_pending set sealed = $2 where id_hash = $1', [hash, seal(cfg.APP_SECRET, JSON.stringify(p))]);
  }
  function clearPending(reply: FastifyReply) { reply.clearCookie(PENDING_COOKIE, { path: '/api/admin' }); }

  app.post('/api/admin/login', strict, async (req, reply) => {
    checkOrigin(cfg, req);
    const b = parse(z.object({ email: z.string().trim().email('Enter your email.').max(200), password: z.string().min(1, 'Enter your password.').max(200) }), req.body);
    const r = await auth.password(b.email, b.password);
    const staff = await db.one<{ id: string }>('select id from rayhab.practitioners where auth_user_id = $1 and active', [r.userId]);
    if (!staff) throw new ApiError(403, 'not_staff', 'This account has no access to the clinic admin.');
    const verified = r.factors.find((f) => f.type === 'totp' && f.status === 'verified');
    const raw = token();
    const p: Pending = { accessToken: r.accessToken, userId: r.userId, practitionerId: staff.id, factorId: verified ? verified.id : null, enrolled: !!verified, tries: 0 };
    await db.query(`delete from rayhab.auth_pending where expires_at < now()`);
    await db.query(`insert into rayhab.auth_pending (id_hash, sealed, expires_at) values ($1, $2, now() + interval '5 minutes')`,
                   [sha256(raw), seal(cfg.APP_SECRET, JSON.stringify(p))]);
    reply.setCookie(PENDING_COOKIE, raw, cookieOpts(cfg, 300));
    return { mfa: verified ? 'verify' : 'enroll' };
  });

  app.post('/api/admin/mfa/enroll', strict, async (req) => {
    checkOrigin(cfg, req);
    const { hash, p } = await readPending(req);
    if (p.enrolled) throw new ApiError(409, 'already_enrolled', 'An authenticator is already set up. Enter its code.');
    const e = await auth.enroll(p.accessToken);
    p.factorId = e.factorId;
    await writePending(hash, p);
    return { qr_code: e.qrCode, secret: e.secret };
  });

  app.post('/api/admin/mfa/verify', strict, async (req, reply) => {
    checkOrigin(cfg, req);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }), req.body);
    const { hash, p } = await readPending(req);
    if (!p.factorId) throw new ApiError(409, 'enroll_first', 'Set up the authenticator first.');
    try {
      await auth.verify(p.accessToken, p.factorId, code);
    } catch (err) {
      p.tries += 1;
      if (p.tries >= 5) {
        await db.query('delete from rayhab.auth_pending where id_hash = $1', [hash]);
        clearPending(reply);
        throw expired();
      }
      await writePending(hash, p);
      throw err;
    }
    await db.query('delete from rayhab.auth_pending where id_hash = $1', [hash]);
    clearPending(reply);
    await createSession(db, cfg, reply, p.practitionerId, String(req.headers['user-agent'] || ''));
    const who = await db.one<{ name: string }>('select name from rayhab.practitioners where id = $1', [p.practitionerId]);
    await logEvent(db, { type: 'signed_in', actor: { kind: 'staff', id: p.practitionerId, name: who?.name }, summary: p.enrolled ? 'Signed in' : 'Signed in and set up an authenticator' });
    return { ok: true };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    checkOrigin(cfg, req);
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) await db.query('delete from rayhab.staff_sessions where id_hash = $1', [sha256(raw)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/api/admin' });
    return { ok: true };
  });
}
