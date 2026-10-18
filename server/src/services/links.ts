/* The patient's secure link: https://dr-rayhab.com/payment/#t={token}.

   256 random bits, stored only as a SHA-256 hash, scoped to one
   appointment, expiring. Issuing a new link revokes the previous one. */
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { sha256, token } from '../lib/util.js';
import { ApiError, E } from '../lib/errors.js';

const invalid = () => new ApiError(404, 'link_invalid', 'This link is not recognized.');

export async function issueLink(db: Db, cfg: Config, appointmentId: string, startsAt: Date): Promise<string> {
  const t = token();
  // Valid for LINK_TTL_DAYS, and never beyond the day after the appointment.
  const cap = startsAt.getTime() + 24 * 3600000;
  const expires = new Date(Math.min(Date.now() + cfg.LINK_TTL_DAYS * 86400000, cap));
  await db.query('update rayhab.payment_links set revoked_at = now() where appointment_id = $1 and revoked_at is null', [appointmentId]);
  await db.query('insert into rayhab.payment_links (token_hash, appointment_id, expires_at) values ($1, $2, $3)',
                 [sha256(t), appointmentId, expires]);
  return t;
}

export function linkUrl(cfg: Config, t: string): string {
  return new URL('/payment/#t=' + t, cfg.PUBLIC_ORIGIN).toString();
}

/* The appointment a token opens, or the reason it does not. */
export async function resolveLink(db: Db, t: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(t)) throw invalid();
  const row = await db.one<{ appointment_id: string; expires_at: Date; revoked_at: Date | null }>(
    'select appointment_id, expires_at, revoked_at from rayhab.payment_links where token_hash = $1', [sha256(t)]);
  if (!row) throw invalid();
  if (row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) throw E.gone('link_expired', 'This link has expired.');
  await db.query('update rayhab.payment_links set last_used_at = now() where token_hash = $1', [sha256(t)]);
  return row.appointment_id;
}
