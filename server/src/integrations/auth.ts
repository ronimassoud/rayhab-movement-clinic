/* Staff identity: Supabase Auth, with a TOTP authenticator required.

   Everything happens server-side, through Supabase Auth's REST API, so no
   Supabase key or token ever reaches the browser:

     password       POST {SUPABASE_URL}/auth/v1/token?grant_type=password
     enroll         POST {SUPABASE_URL}/auth/v1/factors                (first sign-in)
     challenge      POST {SUPABASE_URL}/auth/v1/factors/{id}/challenge
     verify         POST {SUPABASE_URL}/auth/v1/factors/{id}/verify    -> aal2

   Once Supabase confirms the second factor (aal2), the API issues its own
   session (lib/http.ts) and keeps no Supabase token. */
import { createHmac, randomBytes } from 'node:crypto';
import { ApiError } from '../lib/errors.js';

export interface Factor { id: string; status: string; type: string }
export interface PasswordResult { userId: string; accessToken: string; factors: Factor[] }

export interface AuthDriver {
  password(email: string, password: string): Promise<PasswordResult>;
  enroll(accessToken: string): Promise<{ factorId: string; qrCode: string; secret: string }>;
  verify(accessToken: string, factorId: string, code: string): Promise<void>;
}

const badLogin = () => new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
const badCode = () => new ApiError(422, 'invalid_code', 'That code did not work. Check the time on your phone and try again.',
                                   { errors: { code: 'That code did not work. Try the newest one.' } });

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

export function supabaseAuth(url: string, anonKey: string): AuthDriver {
  const base = url.replace(/\/$/, '') + '/auth/v1';
  async function call(path: string, body: unknown, bearer?: string) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const json: any = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  return {
    async password(email, password) {
      const r = await call('/token?grant_type=password', { email, password });
      if (r.status === 400 || r.status === 401 || r.status === 422) throw badLogin();
      if (!r.ok) throw new ApiError(502, 'auth_unavailable', 'Sign-in is not available right now.');
      const factors: Factor[] = (r.json.user?.factors || []).map((f: any) => ({ id: f.id, status: f.status, type: f.factor_type }));
      return { userId: r.json.user.id, accessToken: r.json.access_token, factors };
    },
    async enroll(accessToken) {
      const r = await call('/factors', { factor_type: 'totp', friendly_name: 'Rayhab admin ' + new Date().toISOString().slice(0, 16) }, accessToken);
      if (!r.ok) throw new ApiError(502, 'auth_unavailable', 'The authenticator could not be set up. Try again.');
      return { factorId: r.json.id, qrCode: r.json.totp.qr_code, secret: r.json.totp.secret };
    },
    async verify(accessToken, factorId, code) {
      const ch = await call('/factors/' + encodeURIComponent(factorId) + '/challenge', {}, accessToken);
      if (!ch.ok) throw new ApiError(502, 'auth_unavailable', 'Sign-in is not available right now.');
      const v = await call('/factors/' + encodeURIComponent(factorId) + '/verify', { challenge_id: ch.json.id, code }, accessToken);
      if (!v.ok) throw badCode();
      if (claims(v.json.access_token).aal !== 'aal2') throw badCode();
    }
  };
}

/* ---------- Development stand-in ----------
   The same three steps with local users (DEV_STAFF="email:password:practitionerId")
   and real TOTP codes (RFC 6238), so the sign-in page can be exercised end
   to end without a Supabase project. Refused outside development. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret: string, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function devUserId(email: string): string {
  const h = createHmac('sha256', 'rayhab-dev').update(email.toLowerCase()).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

export function devAuth(spec: string): AuthDriver & { users: { email: string; userId: string; practitionerId: string }[]; factors: Map<string, { secret: string; verified: boolean }> } {
  const users = spec.split(',').filter(Boolean).map((u) => {
    const [email, password, practitionerId] = u.split(':');
    return { email, password, practitionerId, userId: devUserId(email) };
  });
  const factors = new Map<string, { secret: string; verified: boolean; userId: string }>();
  return {
    users: users.map(({ email, userId, practitionerId }) => ({ email, userId, practitionerId })),
    factors,
    async password(email, password) {
      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
      if (!u) throw badLogin();
      const fs = [...factors.entries()].filter(([, f]) => f.userId === u.userId).map(([id, f]) => ({ id, status: f.verified ? 'verified' : 'unverified', type: 'totp' }));
      return { userId: u.userId, accessToken: 'dev.' + u.userId, factors: fs };
    },
    async enroll(accessToken) {
      const userId = accessToken.slice(4);
      const secret = base32(randomBytes(20));
      const id = 'factor_' + randomBytes(6).toString('hex');
      factors.set(id, { secret, verified: false, userId });
      const uri = 'otpauth://totp/Rayhab%20admin?secret=' + secret + '&issuer=Rayhab';
      const { default: QR } = await import('qrcode');
      return { factorId: id, qrCode: await QR.toDataURL(uri), secret };
    },
    async verify(accessToken, factorId, code) {
      const f = factors.get(factorId);
      if (!f || f.userId !== accessToken.slice(4)) throw badCode();
      const now = Date.now();
      if (![now - 30000, now, now + 30000].some((t) => totp(f.secret, t) === code)) throw badCode();
      f.verified = true;
    }
  };
}
