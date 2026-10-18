// Configuration safety, the WhatsApp webhook, holds, and the shared time module.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { booking, call, setup, type Ctx } from './helpers.js';
import { expireHolds } from '../src/worker/jobs.js';
import { hmac } from '../src/lib/util.js';

describe('configuration', () => {
  const base = { APP_SECRET: 'x'.repeat(40) };
  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...base, DEPLOY_ENV: 'production', DATABASE_URL: 'postgres://x', PUBLIC_ORIGIN: 'https://dr-rayhab.com',
      SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'k', WHISH_DRIVER: 'sandbox', WHATSAPP_DRIVER: 'off', EMAIL_DRIVER: 'off' })).toThrow(/sandbox/);
    expect(() => loadConfig({ ...base, DEPLOY_ENV: 'production', DATABASE_URL: 'postgres://x', PUBLIC_ORIGIN: 'https://dr-rayhab.com',
      AUTH_DRIVER: 'dev', WHATSAPP_DRIVER: 'off', EMAIL_DRIVER: 'off' })).toThrow(/AUTH_DRIVER/);
    expect(() => loadConfig({ APP_SECRET: 'short' })).toThrow(/APP_SECRET/);
  });
  it('accepts a complete production setup', () => {
    const c = loadConfig({ ...base, DEPLOY_ENV: 'production', DATABASE_URL: 'postgres://x', PUBLIC_ORIGIN: 'https://dr-rayhab.com',
      SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'k', WHATSAPP_DRIVER: 'off', EMAIL_DRIVER: 'off' });
    expect(c.origins).toEqual(['https://dr-rayhab.com']);
  });
});

describe('with an API', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await setup({ WA_APP_SECRET: 'wa-secret', WA_VERIFY_TOKEN: 'verify-me' }); });
  afterAll(async () => { await ctx.app.close(); await ctx.db.close(); });

  it('WhatsApp webhook: subscription check and signed delivery receipts only', async () => {
    const ok = await call(ctx, { url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42' });
    expect(ok.body).toBe('42');
    expect((await call(ctx, { url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42' })).statusCode).toBe(403);
    await ctx.db.query(`insert into rayhab.notification_outbox (channel, template, recipient, provider_message_id, status) values ('whatsapp', 'approved', '+961', 'wamid.1', 'sent')`);
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] });
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' } });
    expect(bad.statusCode).toBe(401);
    const good = await ctx.app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + hmac('wa-secret', raw) } });
    expect(good.statusCode).toBe(200);
    expect((await ctx.db.one<any>(`select delivery_status from rayhab.notification_outbox where provider_message_id = 'wamid.1'`)).delivery_status).toBe('delivered');
  });

  it('a request nobody answers in time expires and frees its time', async () => {
    const r = await call(ctx, { url: '/api/appointments', body: booking({ time: '17:00' }) });
    await ctx.db.query(`update rayhab.appointments set hold_expires_at = now() - interval '1 minute' where id = $1`, [r.json().id]);
    expect(await expireHolds({ db: ctx.db } as any)).toBe(1);
    expect((await ctx.db.one<any>('select status from rayhab.appointments where id = $1', [r.json().id])).status).toBe('expired');
    expect((await call(ctx, { url: '/api/appointments', body: booking({ time: '17:00', phone: '+96170000999' }) })).statusCode).toBe(201);
  });

  it('answers unknown routes and bad bodies in the error shape', async () => {
    expect((await call(ctx, { url: '/api/nope' })).json().error.code).toBe('not_found');
    const r = await ctx.app.inject({ method: 'POST', url: '/api/appointments', payload: '{bad', headers: { 'content-type': 'application/json', origin: 'https://dr-rayhab.test' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('bad_request');
  });
});

describe('shared Beirut time', () => {
  it('the server copy matches the browser copy', () => {
    const browser = readFileSync(new URL('../../site/assets/js/api/time.js', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../shared/time.cjs', import.meta.url), 'utf8');
    expect(server).toBe(browser);
  });
});
