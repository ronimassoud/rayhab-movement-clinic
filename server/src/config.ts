/* Configuration, read once from the environment and checked at boot.

   The process refuses to start with an incomplete or unsafe setup rather
   than failing later on a patient's request. Every variable is listed in
   infra/env.example with what it is for. */
import { z } from 'zod';

const bool = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === '1');
const int = (d: number) => z.coerce.number().int().default(d);
const list = z.string().default('').transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const Schema = z.object({
  DEPLOY_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: int(3000),
  HOST: z.string().default('127.0.0.1'),
  // The site's own origin. Browser POSTs from anywhere else are refused, and
  // links in messages are built on it.
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:4700'),
  EXTRA_ORIGINS: list,
  DATABASE_URL: z.string().default(''),
  DATABASE_MIGRATE_URL: z.string().default(''),
  // Encrypts short-lived sign-in material and keys IP hashes. 32+ characters.
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  TRUST_PROXY: z.string().default('127.0.0.1'),
  COOKIE_SECURE: bool.default(true),
  LOG_LEVEL: z.string().default('info'),

  AUTH_DRIVER: z.enum(['supabase', 'dev']).default('supabase'),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().default(''),
  DEV_STAFF: z.string().default(''),             // dev driver only: "email:password:practitionerId"
  SESSION_HOURS: int(12),

  WHATSAPP_DRIVER: z.enum(['cloud', 'log', 'off']).default('log'),
  WA_TOKEN: z.string().default(''),
  WA_PHONE_NUMBER_ID: z.string().default(''),
  WA_APP_SECRET: z.string().default(''),
  WA_VERIFY_TOKEN: z.string().default(''),
  WA_GRAPH_VERSION: z.string().default('v21.0'),
  WA_LANG: z.string().default('en'),

  EMAIL_DRIVER: z.enum(['smtp', 'log', 'off']).default('log'),
  SMTP_URL: z.string().default(''),
  EMAIL_FROM: z.string().default('Rayhab bookings <bookings@dr-rayhab.com>'),
  STAFF_EMAILS: list,

  WHISH_DRIVER: z.enum(['disabled', 'sandbox', 'whish']).default('disabled'),
  WHISH_BASE_URL: z.string().default(''),
  WHISH_MERCHANT_ID: z.string().default(''),
  WHISH_SECRET: z.string().default(''),

  // Booking rules.
  LEAD_DAYS: int(1),
  HORIZON_DAYS: int(90),
  HOLD_HOURS: int(24),
  LINK_TTL_DAYS: int(14),
  PAYMENT_DEADLINE_HOURS: int(24),     // before the appointment; 0 for none
  POLICY_CASH_TEXT: z.string().default('Pay at reception when you come in.'),
  POLICY_WHISH_TEXT: z.string().default('You pay now through Whish. Your booking is secured once Whish confirms the payment.'),
  CLINIC_NAME: z.string().default('Rayhab Movement Clinic'),
  CLINIC_PHONE: z.string().default('+961 71 383 315'),
  CLINIC_LOCATION: z.string().default('Rayhab Movement Clinic, Beirut')
});

export type Config = z.infer<typeof Schema> & { origins: string[] };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => '  ' + i.path.join('.') + ': ' + i.message);
    throw new Error('Configuration is incomplete:\n' + lines.join('\n'));
  }
  const c = parsed.data;
  const live = c.DEPLOY_ENV === 'production' || c.DEPLOY_ENV === 'staging';
  const problems: string[] = [];
  if (live) {
    if (!c.DATABASE_URL) problems.push('DATABASE_URL is required');
    if (c.AUTH_DRIVER !== 'supabase') problems.push('AUTH_DRIVER must be supabase outside development');
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) problems.push('SUPABASE_URL and SUPABASE_ANON_KEY are required');
    if (!c.PUBLIC_ORIGIN.startsWith('https://')) problems.push('PUBLIC_ORIGIN must be https');
    if (!c.COOKIE_SECURE) problems.push('COOKIE_SECURE must stay on');
  }
  if (c.DEPLOY_ENV === 'production') {
    if (c.WHISH_DRIVER === 'sandbox') problems.push('WHISH_DRIVER=sandbox is not allowed in production');
    if (c.WHATSAPP_DRIVER === 'log') problems.push('WHATSAPP_DRIVER=log is not allowed in production (use cloud, or off)');
    if (c.EMAIL_DRIVER === 'log') problems.push('EMAIL_DRIVER=log is not allowed in production (use smtp, or off)');
  }
  if (c.WHATSAPP_DRIVER === 'cloud' && (!c.WA_TOKEN || !c.WA_PHONE_NUMBER_ID || !c.WA_APP_SECRET || !c.WA_VERIFY_TOKEN)) {
    problems.push('WHATSAPP_DRIVER=cloud needs WA_TOKEN, WA_PHONE_NUMBER_ID, WA_APP_SECRET and WA_VERIFY_TOKEN');
  }
  if (c.EMAIL_DRIVER === 'smtp' && (!c.SMTP_URL || !c.STAFF_EMAILS.length)) problems.push('EMAIL_DRIVER=smtp needs SMTP_URL and STAFF_EMAILS');
  if (c.WHISH_DRIVER === 'whish' && (!c.WHISH_BASE_URL || !c.WHISH_MERCHANT_ID || !c.WHISH_SECRET)) {
    problems.push('WHISH_DRIVER=whish needs WHISH_BASE_URL, WHISH_MERCHANT_ID and WHISH_SECRET');
  }
  if (problems.length) throw new Error('Configuration is unsafe or incomplete:\n  ' + problems.join('\n  '));
  return { ...c, origins: [new URL(c.PUBLIC_ORIGIN).origin, ...c.EXTRA_ORIGINS] };
}
