// The API's settings for one environment, built from infra/connect.<env>.env:
// what Vercel's environment variables must hold (push-env.mjs), and what the
// doctor uses from this computer (api/dev/doctor.mjs). Phase 1 defaults:
// cash only, patients emailed through Resend's API.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BRANCH = { staging: 'redesign-2.0' };   // staging = previews of this branch

export function connectFile(env) {
  return fileURLToPath(new URL(`../connect.${env}.env`, import.meta.url));
}

function read(file) {
  const v = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) v[m[1]] = m[2].trim();
  }
  return v;
}

/* A long random secret, made once and kept in the connect file, so every
   later run sends the same one (a new APP_SECRET signs everyone out). */
function keep(file, c, key) {
  if (c[key]) return c[key];
  const value = randomBytes(36).toString('base64url');
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
    : text.replace(/\n?$/, `\n${key}=${value}\n`));
  console.log(`Generated ${key} and saved it in infra/connect.${c.DEPLOY_ENV || 'env'}.env.`);
  c[key] = value;
  return value;
}

export function settingsFor(env) {
  if (!['staging', 'production'].includes(env)) throw new Error('environment: staging or production');
  const file = connectFile(env);
  if (!existsSync(file)) throw new Error(`Missing infra/connect.${env}.env (copy infra/connect.example.env).`);
  const c = read(file);
  const need = ['PUBLIC_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DATABASE_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'STAFF_EMAILS'];
  const empty = need.filter((k) => !c[k]);
  if (empty.length) throw new Error(`Still empty in infra/connect.${env}.env: ${empty.join(', ')}`);
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(c.SUPABASE_URL)) throw new Error('SUPABASE_URL should look like https://<ref>.supabase.co');
  if (!c.DATABASE_URL.includes('rayhab_app')) throw new Error('DATABASE_URL should sign in as rayhab_app (infra/supabase/setup.sql), not postgres.');
  if (!c.RESEND_API_KEY.startsWith('re_')) throw new Error('RESEND_API_KEY should start with re_');
  const whish = c.WHISH_DRIVER || 'disabled';
  if (!['disabled', 'whish'].includes(whish) && !(env === 'staging' && whish === 'sandbox')) throw new Error('WHISH_DRIVER should be disabled or whish (sandbox: staging only)');
  const channel = c.PATIENT_CHANNEL || 'email';
  if (!['email', 'whatsapp'].includes(channel)) throw new Error('PATIENT_CHANNEL should be email or whatsapp');

  const s = {
    DEPLOY_ENV: env,
    PUBLIC_ORIGIN: c.PUBLIC_ORIGIN.replace(/\/$/, ''),
    APP_SECRET: keep(file, c, 'APP_SECRET'),
    CRON_SECRET: keep(file, c, 'CRON_SECRET'),
    DATABASE_URL: c.DATABASE_URL,
    AUTH_DRIVER: 'supabase',
    SUPABASE_URL: c.SUPABASE_URL.replace(/\/$/, ''),
    SUPABASE_ANON_KEY: c.SUPABASE_ANON_KEY,
    EMAIL_DRIVER: 'resend',
    RESEND_API_KEY: c.RESEND_API_KEY,
    EMAIL_FROM: c.EMAIL_FROM,
    STAFF_EMAILS: c.STAFF_EMAILS,
    PATIENT_CHANNEL: channel,
    WHISH_DRIVER: whish,
    WHATSAPP_DRIVER: c.WHATSAPP_DRIVER || 'off',
  };
  if (c.CLINIC_EMAIL) s.CLINIC_EMAIL = c.CLINIC_EMAIL;
  for (const k of ['WA_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'WHISH_BASE_URL', 'WHISH_MERCHANT_ID', 'WHISH_SECRET',
                   'POLICY_CASH_TEXT', 'POLICY_WHISH_TEXT', 'HOLD_HOURS']) {
    if (c[k]) s[k] = c[k];
  }
  return s;
}
