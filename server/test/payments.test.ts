// Payment choice and settlement: acceptance checks 9 to 12.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approve, booking, call, fullDay, setup, signIn, staffCall, type Ctx } from './helpers.js';
import { deliver, reconcile } from '../src/worker/jobs.js';
import { hmac } from '../src/lib/util.js';

let ctx: Ctx;
let staff: any;
let n = 0;
beforeAll(async () => { ctx = await setup(); staff = await signIn(ctx); });
afterAll(async () => { await ctx.app.close(); await ctx.db.close(); });

const silent: any = { info() {}, warn() {}, error() {}, debug() {} };
const workerDeps = () => ({ ...ctx.deps, log: silent, wa: { sendTemplate: async () => ({ providerMessageId: 'wamid.x' }) },
                            mail: { send: async () => ({ providerMessageId: 'm.x' }) } });

async function approved() {
  const times = ['09:00', '10:00', '11:00', '15:00', '16:00', '17:00'];
  const day = fullDay(2 + Math.floor(n / times.length) * 2);
  const r = await call(ctx, { url: '/api/appointments', body: booking({ date: day, time: times[n % times.length], phone: '+9617100' + String(1000 + n++) }) });
  expect(r.statusCode).toBe(201);
  const id = r.json().id;
  return { id, link: await approve(ctx, staff, id) };
}

describe('the payment page', () => {
  it('shows the approved appointment and both methods', async () => {
    const { link } = await approved();
    const v = (await call(ctx, { url: '/api/payment-selection/' + link })).json();
    expect(v.appointment).toMatchObject({ status: 'approved', service: { name: 'Scoliosis assessment' }, timezone: 'Asia/Beirut' });
    expect(v.payment).toMatchObject({ method: null, status: 'not_selected', amount: 8000, currency: 'USD', outstanding: 8000 });
    expect(v.allowed_methods).toEqual(['whish', 'cash']);
    expect(v.policy.cash).toBeTruthy();
  });

  it('unknown and expired links', async () => {
    expect((await call(ctx, { url: '/api/payment-selection/' + 'x'.repeat(43) })).json().error.code).toBe('link_invalid');
    const { id, link } = await approved();
    await ctx.db.query(`update rayhab.payment_links set expires_at = now() - interval '1 minute' where appointment_id = $1`, [id]);
    const r = await call(ctx, { url: '/api/payment-selection/' + link });
    expect(r.statusCode).toBe(410);
    expect(r.json().error.code).toBe('link_expired');
  });
});

describe('cash', () => {
  it('choosing cash confirms the appointment but leaves it unpaid', async () => {
    const { link } = await approved();
    const v = (await call(ctx, { url: '/api/payment-selection/' + link, body: { method: 'cash' } })).json();
    expect(v.appointment.status).toBe('confirmed');
    expect(v.payment).toMatchObject({ method: 'cash', status: 'awaiting_payment' });
    expect(v.can_change_method).toBe(true);
  });

  it('confirm cash received: once, however often it is pressed', async () => {
    const { id, link } = await approved();
    await call(ctx, { url: '/api/payment-selection/' + link, body: { method: 'cash' } });
    const a = (await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id })).json().appointment;
    expect(a.payment.actions).toEqual(['confirm_cash']);
    const url = '/api/admin/payments/' + a.payment.id + '/confirm-cash';
    const tooMuch = await staffCall(ctx, staff, { url, body: { amount: 9000, currency: 'USD' } });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().errors).toHaveProperty('amount');
    const h = { 'idempotency-key': 'cash-' + id };
    const [one, two] = await Promise.all([
      staffCall(ctx, staff, { url, body: { amount: 8000, currency: 'USD' }, headers: h }),
      staffCall(ctx, staff, { url, body: { amount: 8000, currency: 'USD' }, headers: h })
    ]);
    const codes = [one.statusCode, two.statusCode].sort();
    expect(codes[0]).toBe(200);
    const paid = [one, two].find((r) => r.statusCode === 200)!.json().payment;
    expect(paid).toMatchObject({ status: 'paid', method: 'cash', verified_by: 'cash_receipt', actions: [], recorded_by: { name: 'Dr. Rayan Halimeh' } });
    const newKey = await staffCall(ctx, staff, { url, body: { amount: 8000, currency: 'USD' }, headers: { 'idempotency-key': 'other' } });
    expect(newKey.json().error.code).toBe('already_recorded');
    const tx = await ctx.db.one<any>(`select count(*)::int as n from rayhab.payment_transactions where intent_id = $1 and provider = 'cash'`, [a.payment.id]);
    expect(tx.n).toBe(1);
    const after = (await staffCall(ctx, staff, { url: '/api/admin/appointments/' + id })).json().appointment;
    expect(after.financial_closed_at).toBeTruthy();
    expect(after.status).toBe('confirmed');   // paid is not completed
    const view = (await call(ctx, { url: '/api/payment-selection/' + link })).json();
    expect(view.payment.status).toBe('paid');
    expect(view.allowed_methods).toEqual([]);
  });
});

describe('Whish (sandbox driver)', () => {
  async function startWhish() {
    const a = await approved();
    await call(ctx, { url: '/api/payment-selection/' + a.link, body: { method: 'whish' } });
    const co = await call(ctx, { url: '/api/payments/whish/create', body: { token: a.link } });
    expect(co.statusCode).toBe(200);
    const ref = new URL(co.json().checkout_url).pathname.split('/').pop()!;
    return { ...a, ref, url: co.json().checkout_url };
  }

  it('coming back from checkout is not proof: unpaid until verified', async () => {
    const w = await startWhish();
    const back = (await call(ctx, { url: '/api/payment-selection/' + w.link })).json();
    expect(back.payment).toMatchObject({ status: 'awaiting_payment', last_attempt: { status: 'pending' } });
    expect(back.can_change_method).toBe(false);
    // Opening checkout again reuses the open one rather than starting a second.
    const again = await call(ctx, { url: '/api/payments/whish/create', body: { token: w.link } });
    expect(again.json().checkout_url).toBe(w.url);
    // The tester pays on the stand-in page; only reconciliation makes it paid.
    await call(ctx, { url: '/api/payments/whish/sandbox/' + w.ref, body: 'outcome=verified&return=' + encodeURIComponent('https://dr-rayhab.test/payment/'),
                      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect((await call(ctx, { url: '/api/payment-selection/' + w.link })).json().payment.status).toBe('awaiting_payment');
    await ctx.db.query(`update rayhab.payment_transactions set updated_at = now() - interval '1 minute' where external_ref = $1`, [w.ref]);
    expect(await reconcile(workerDeps() as any)).toBe(1);
    const paid = (await call(ctx, { url: '/api/payment-selection/' + w.link })).json();
    expect(paid.payment).toMatchObject({ status: 'paid', receipt_reference: w.ref });
    expect(await reconcile(workerDeps() as any)).toBe(0);   // settles once
  });

  it('a failed payment stays unpaid and may be retried', async () => {
    const w = await startWhish();
    await call(ctx, { url: '/api/payments/whish/sandbox/' + w.ref, body: 'outcome=failed', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    await ctx.db.query(`update rayhab.payment_transactions set updated_at = now() - interval '1 minute' where external_ref = $1`, [w.ref]);
    await reconcile(workerDeps() as any);
    const v = (await call(ctx, { url: '/api/payment-selection/' + w.link })).json();
    expect(v.payment).toMatchObject({ status: 'awaiting_payment', last_attempt: { status: 'failed' } });
    expect(v.can_retry).toBe(true);
    expect(v.can_change_method).toBe(true);
  });

  it('a callback must be authentic, and counts once', async () => {
    const w = await startWhish();
    const raw = JSON.stringify({ ref: w.ref, status: 'verified', event_id: 'ev1' });
    const forged = await ctx.app.inject({ method: 'POST', url: '/api/webhooks/whish', payload: raw, headers: { 'content-type': 'application/json', 'x-sandbox-signature': 'nope' } });
    expect(forged.statusCode).toBe(401);
    const sig = hmac(ctx.deps.cfg.APP_SECRET, raw);
    for (let i = 0; i < 2; i++) {
      const ok = await ctx.app.inject({ method: 'POST', url: '/api/webhooks/whish', payload: raw, headers: { 'content-type': 'application/json', 'x-sandbox-signature': sig } });
      expect(ok.statusCode).toBe(200);
    }
    const v = (await call(ctx, { url: '/api/payment-selection/' + w.link })).json();
    expect(v.payment.status).toBe('paid');
    const credits = await ctx.db.one<any>(`select count(*)::int as n from rayhab.events e join rayhab.appointments a on a.id = e.appointment_id
                                            where a.id = $1 and e.type = 'payment_verified'`, [w.id]);
    expect(credits.n).toBe(1);
  });

  it('with Whish disabled, only cash is offered', async () => {
    const off = await (await import('./helpers.js')).setup({ WHISH_DRIVER: 'disabled' });
    const s = await signIn(off);
    const r = await call(off, { url: '/api/appointments', body: booking() });
    const link = await approve(off, s, r.json().id);
    expect((await call(off, { url: '/api/payment-selection/' + link })).json().allowed_methods).toEqual(['cash']);
    await off.app.close(); await off.db.close();
  });
});

describe('messages', () => {
  it('delivers the outbox and removes the sealed link once sent', async () => {
    await approved();
    const sent = await deliver(workerDeps() as any, 100);
    expect(sent).toBeGreaterThan(0);
    const left = await ctx.db.query<any>(`select payload from rayhab.notification_outbox where status <> 'sent' and status <> 'skipped'`);
    expect(left.length).toBe(0);
    const withLink = await ctx.db.query<any>(`select payload from rayhab.notification_outbox where template = 'approved'`);
    for (const r of withLink) {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      expect(p.link_sealed).toBeUndefined();
    }
  });

  it('gives up on a permanent error and retries a temporary one', async () => {
    const { SendError } = await import('../src/integrations/messaging.js');
    await approved();
    const deps: any = { ...workerDeps(), wa: { sendTemplate: async () => { throw new SendError('WhatsApp 400: template not approved', false); } } };
    await deliver(deps, 100);
    expect((await ctx.db.one<any>(`select status from rayhab.notification_outbox where channel = 'whatsapp' order by id desc limit 1`)).status).toBe('dead');
    await approved();
    const temp: any = { ...workerDeps(), wa: { sendTemplate: async () => { throw new SendError('WhatsApp 503', true); } } };
    await deliver(temp, 100);
    expect((await ctx.db.one<any>(`select status from rayhab.notification_outbox where channel = 'whatsapp' order by id desc limit 1`)).status).toBe('failed');
  });
});
