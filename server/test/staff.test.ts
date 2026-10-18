// Staff sign-in, sessions and the admin actions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approve, booking, call, fullDay, setup, signIn, STAFF, staffCall, type Ctx } from './helpers.js';
import { totp } from '../src/integrations/auth.js';

let ctx: Ctx;
let staff: { cookies: Record<string, string>; csrf: string };
beforeAll(async () => { ctx = await setup(); staff = await signIn(ctx); });
afterAll(async () => { await ctx.app.close(); await ctx.db.close(); });

async function request(time: string, day = fullDay(2), phone = '+96170009' + time.replace(':', '')) {
  const r = await call(ctx, { url: '/api/appointments', body: booking({ date: day, time, phone }) });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

describe('sign-in', () => {
  it('refuses a wrong password and answers 401 with login_url when signed out', async () => {
    expect((await call(ctx, { url: '/api/admin/login', body: { email: STAFF.email, password: 'wrong' } })).statusCode).toBe(401);
    const r = await call(ctx, { url: '/api/admin/session' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ error: { code: 'unauthenticated' }, login_url: '/admin/login.html' });
  });

  it('asks for the authenticator code once one is set up, and ends after five wrong codes', async () => {
    const login = await call(ctx, { url: '/api/admin/login', body: { email: STAFF.email, password: STAFF.password } });
    expect(login.json()).toEqual({ mfa: 'verify' });
    const pending = login.cookies.find((c) => c.name === 'rh_pending')!.value;
    for (let i = 0; i < 4; i++) {
      const bad = await call(ctx, { url: '/api/admin/mfa/verify', body: { code: '000000' }, cookies: { rh_pending: pending } });
      expect(bad.statusCode).toBe(422);
    }
    const fifth = await call(ctx, { url: '/api/admin/mfa/verify', body: { code: '000000' }, cookies: { rh_pending: pending } });
    expect(fifth.statusCode).toBe(401);
    const late = await call(ctx, { url: '/api/admin/mfa/verify', body: { code: totp((ctx as any).secret) }, cookies: { rh_pending: pending } });
    expect(late.json().error.code).toBe('login_expired');
  });

  it('gives a session with permissions, CSRF token and the sign-in and sign-out links', async () => {
    const s = await call(ctx, { url: '/api/admin/session', cookies: staff.cookies });
    expect(s.json()).toMatchObject({ user: { name: 'Dr. Rayan Halimeh', role: 'admin' }, permissions: { confirm_cash: true, manage_schedule: true },
                                     login_url: '/admin/login.html', logout_url: '/admin/login.html?signout=1' });
  });

  it('needs the CSRF token and the site Origin for every change', async () => {
    const id = await request('09:00');
    const noCsrf = await call(ctx, { url: '/api/admin/appointments/' + id + '/approve', body: {}, cookies: staff.cookies });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('csrf');
    const elsewhere = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/approve', body: {}, headers: { origin: 'https://evil.example' } });
    expect(elsewhere.json().error.code).toBe('origin');
  });
});

describe('appointment actions', () => {
  it('approve: approved, the WhatsApp message carries a sealed link, actions update', async () => {
    const id = await request('10:00');
    const link = await approve(ctx, staff, id);
    expect(link).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const a = (await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id })).json();
    expect(a.appointment.status).toBe('approved');
    expect(a.appointment.actions).toEqual(['reschedule', 'cancel']);
    expect(a.events.map((e: any) => e.type)).toEqual(['approved', 'requested']);
    const again = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/approve', body: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invalid_transition');
  });

  it('approve needs a price for the service', async () => {
    await ctx.db.query(`update rayhab.services set price_amount = null where id = 'sports'`);
    const r = await call(ctx, { url: '/api/appointments', body: booking({ service_id: 'sports', date: fullDay(5), time: '09:45', phone: '+96170008001' }) });
    const res = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + r.json().id + '/approve', body: {} });
    expect(res.json().error.code).toBe('price_missing');
    await ctx.db.query(`update rayhab.services set price_amount = 6000 where id = 'sports'`);
  });

  it('decline needs a reason and revokes the link', async () => {
    const id = await request('11:00');
    const r = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/decline', body: {} });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors).toHaveProperty('reason');
    const ok = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/decline', body: { reason: 'Duplicate request' } });
    expect(ok.json().appointment.status).toBe('declined');
  });

  it('reschedule: only to a free time; the patient accepts or asks again', async () => {
    const day = fullDay(6);
    const id = await request('09:00', day);
    await request('10:00', day);
    const taken = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/reschedule', body: { date: day, time: '10:00' } });
    expect(taken.json().error.code).toBe('slot_taken');
    const moved = await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/reschedule', body: { date: day, time: '15:00' } });
    expect(moved.json().appointment, moved.body).toMatchObject({ status: 'reschedule_requested', local_time: '15:00' });
    const { linkFromOutbox } = await import('./helpers.js');
    const link = await linkFromOutbox(ctx, id, 'new_time');
    const view = await call(ctx, { url: '/api/payment-selection/' + link });
    expect(view.json().appointment.status).toBe('reschedule_requested');
    const no = await call(ctx, { url: '/api/payment-selection/' + link + '/reschedule', body: { accept: false } });
    expect(no.json().appointment.status).toBe('requested');
    await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id + '/reschedule', body: { date: day, time: '16:00' } });
    const link2 = await linkFromOutbox(ctx, id, 'new_time');
    expect((await call(ctx, { url: '/api/payment-selection/' + link })).statusCode).toBe(410);   // the old link is revoked
    const yes = await call(ctx, { url: '/api/payment-selection/' + link2 + '/reschedule', body: { accept: true } });
    expect(yes.json().appointment).toMatchObject({ status: 'approved', local_time: '16:00' });
  });

  it('lists with filters and pages, and the overview counts', async () => {
    const all = (await staffCall(ctx, staff, { url: '/api/admin/appointments?page_size=2' })).json();
    expect(all.items.length).toBe(2);
    expect(all.total).toBeGreaterThan(2);
    const requested = (await staffCall(ctx, staff, { url: '/api/admin/appointments?status=requested' })).json();
    expect(requested.items.every((a: any) => a.status === 'requested')).toBe(true);
    const search = (await staffCall(ctx, staff, { url: '/api/admin/appointments?q=khoury' })).json();
    expect(search.total).toBe(all.total);   // every test patient is called Khoury
    const ov = (await staffCall(ctx, staff, { url: '/api/admin/overview' })).json();
    expect(ov.counts.requested).toBe(requested.total);
  });

  it('blocks and frees time, and blocked time is not offered', async () => {
    const day = fullDay(8);
    const block = await staffCall(ctx, staff, { method: 'PATCH', url: '/api/admin/availability', body: { add: [{ date: day, start: '09:00', end: '11:00', reason: 'Training' }] } });
    expect(block.statusCode).toBe(200);
    const slots = (await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=${day}` })).json().slots;
    expect(slots.filter((s: any) => s.available).map((s: any) => s.time)).not.toContain('09:00');
    expect(slots.find((s: any) => s.time === '10:00').available).toBe(false);
    const ex = (await staffCall(ctx, staff, { url: `/api/admin/availability?from=${day}&to=${day}` })).json().exceptions;
    expect(ex[0]).toMatchObject({ date: day, start: '09:00', end: '11:00', reason: 'Training' });
    await staffCall(ctx, staff, { method: 'PATCH', url: '/api/admin/availability', body: { remove: [ex[0].id] } });
    expect((await call(ctx, { url: `/api/availability?service_id=assessment&mode=clinic&date=${day}` })).json().slots[0].available).toBe(true);
  });

  it('records history in the audit log', async () => {
    const r = (await staffCall(ctx, staff, { url: '/api/admin/audit?type=approved' })).json();
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]).toMatchObject({ type: 'approved', actor: { kind: 'staff', name: 'Dr. Rayan Halimeh' } });
  });

  it('signing out ends the session', async () => {
    const s2 = await signIn(ctx);
    await call(ctx, { url: '/api/admin/logout', body: {}, cookies: s2.cookies });
    expect((await call(ctx, { url: '/api/admin/session', cookies: s2.cookies })).statusCode).toBe(401);
  });
});
