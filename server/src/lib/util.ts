/* Small shared pieces: ids, tokens, hashing, sealing, Beirut time. */
import { createRequire } from 'node:module';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* The browser's own Beirut-time module (copied by scripts/sync-shared.mjs),
   so both sides agree on days, offsets and daylight saving. */
interface BeirutTime {
  TZ: string;
  today(now?: number): string;
  addDays(iso: string, n: number): string;
  daysBetween(a: string, b: string): number;
  dow(iso: string): number;
  toUtc(isoDate: string, hhmm: string): number;
  fromInstant(iso: string | number): { date: string; time: string };
  dayLabel(iso: string, full?: boolean): string;
  toMin(hhmm: string): number;
  fromMin(m: number): string;
}
export const T: BeirutTime = createRequire(import.meta.url)('../../shared/time.cjs');

export function id(prefix: string): string {
  return prefix + '_' + randomBytes(9).toString('base64url');
}

// A token for a link: 256 bits, URL-safe.
export function token(): string { return randomBytes(32).toString('base64url'); }

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

export function hmac(secret: string, s: string): string { return createHmac('sha256', secret).update(s).digest('hex'); }

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* AES-256-GCM with a key derived from APP_SECRET, for the few seconds-to-
   minutes a value must be kept but must not be readable at rest. */
function key(secret: string) { return createHash('sha256').update('rayhab-seal:' + secret).digest(); }
export function seal(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
export function unseal(secret: string, sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

export function moneyText(amount: number, currency: string): string {
  if (currency === 'USD') return '$' + (amount / 100).toFixed(2).replace(/\.00$/, '');
  return currency + ' ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}
