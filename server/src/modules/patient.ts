/* The patient's secure link (README.md, "API contracts: payment choice").

     GET  /api/payment-selection/:token              what the page shows
     POST /api/payment-selection/:token              { method: "whish" | "cash" }
     POST /api/payment-selection/:token/reschedule   { accept: true | false }
     POST /api/payments/whish/create                 { token } -> { checkout_url }
     POST /api/webhooks/whish                        Whish's authenticated callback
     GET|POST /api/payments/whish/sandbox/:ref       the stand-in checkout (sandbox driver only) */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import { ApiError, E } from '../lib/errors.js';
import { checkOrigin, idempotent, parse, send } from '../lib/http.js';
import { id, iso, sha256, T } from '../lib/util.js';
import { resolveLink } from '../services/links.js';
import { loadAppointment, logEvent } from '../services/records.js';
import { staffNotice } from '../services/notify.js';
import { settleWhish } from '../services/payments.js';
import type { WhishDriver } from '../integrations/whish.js';

const LIVE = ['approved', 'confirmed', 'reschedule_requested'];

export function selectionView(cfg: Config, whish: WhishDriver, a: NonNullable<Awaited<ReturnType<typeof loadAppointment>>>) {
  const p = a.payment;
  const live = a.status === 'approved' || a.status === 'confirmed';
  const finalized = p.status === 'paid' || p.status === 'refunded';
  const methods = whish.name === 'disabled' ? ['cash'] : ['whish', 'cash'];
  const pendingWhish = p.last_attempt && p.last_attempt.status === 'pending';
  const deadline = cfg.PAYMENT_DEADLINE_HOURS > 0 ? new Date(Date.parse(a.start!) - cfg.PAYMENT_DEADLINE_HOURS * 3600000) : null;
  return {
    appointment: {
      reference: a.reference, status: a.status,
      service: { name: a.service.name, duration_min: a.service.duration_min },
      practitioner: { name: a.practitioner.name },
      mode: a.mode, local_date: a.local_date, local_time: a.local_time, timezone: T.TZ,
      location: a.mode === 'online' ? 'Online, video call' : cfg.CLINIC_LOCATION
    },
    payment: { method: p.method, status: p.status, amount: p.amount, currency: p.currency, outstanding: p.outstanding,
               last_attempt: p.last_attempt, receipt_reference: p.status === 'paid' ? p.receipt_reference : null },
    allowed_methods: live && !finalized ? methods : [],
    can_change_method: live && !finalized && p.status === 'awaiting_payment' && !pendingWhish,
    can_retry: live && p.method === 'whish' && p.status === 'awaiting_payment' && !!p.last_attempt &&
               p.last_attempt.status !== 'pending' && whish.name !== 'disabled',
    policy: {
      cash: cfg.POLICY_CASH_TEXT,
      whish: cfg.POLICY_WHISH_TEXT,
      deadline: deadline && deadline.getTime() > Date.now() ? deadline.toISOString() : null
    },
    clinic: { name: cfg.CLINIC_NAME, phone: cfg.CLINIC_PHONE }
  };
}

async function view(db: Db, cfg: Config, whish: WhishDriver, apptId: string) {
  const a = await loadAppointment(db, apptId, null);
  if (!a) throw new ApiError(404, 'link_invalid', 'This link is not recognized.');
  return selectionView(cfg, whish, a);
}

export function patientRoutes(app: FastifyInstance, { cfg, db, whish }: Deps) {
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/api/payment-selection/:token', limit, async (req) => {
    const apptId = await resolveLink(db, (req.params as { token: string }).token);
    return view(db, cfg, whish, apptId);
  });

  app.post('/api/payment-selection/:token', limit, async (req, reply) => {
    checkOrigin(cfg, req);
    const tok = (req.params as { token: string }).token;
    const apptId = await resolveLink(db, tok);
    const { method } = parse(z.object({ method: z.enum(['whish', 'cash']) }), req.body);
    const res = await idempotent(db, req, 'select:' + sha256(tok), async () => {
      await db.tx(async (t) => {
        const row = await t.one<any>(`select a.status, pi.id, pi.method, pi.status as pay_status
                                         from rayhab.appointments a join rayhab.payment_intents pi on pi.appointment_id = a.id
                                        where a.id = $1 for update`, [apptId]);
        if (!row || !['approved', 'confirmed'].includes(row.status)) throw E.conflict('appointment_closed', 'This appointment is no longer active.');
        if (row.pay_status === 'paid' || row.pay_status === 'refunded') throw E.conflict('method_finalized', 'This appointment is already paid.');
        const current = await loadAppointment(t, apptId, null);
        const v = selectionView(cfg, whish, current!);
        if (!v.allowed_methods.includes(method)) throw E.conflict('method_finalized', 'This payment method is not available.');
        if (row.method && row.method !== method && !v.can_change_method) throw E.conflict('method_finalized', 'The payment method can no longer be changed.');
        if (row.method !== method) {
          await t.query(`update rayhab.payment_intents set method = $2, status = 'awaiting_payment', updated_at = now() where id = $1`, [row.id, method]);
          await logEvent(t, { type: 'payment_selected', appointmentId: apptId, actor: { kind: 'patient', name: 'Patient' },
                              summary: 'Chose ' + (method === 'cash' ? 'cash at the clinic' : 'Whish') });
        }
        // Choosing how to pay confirms an approved appointment. It does not pay it.
        if (row.status === 'approved') {
          await t.query(`update rayhab.appointments set status = 'confirmed', updated_at = now() where id = $1`, [apptId]);
          await logEvent(t, { type: 'confirmed', appointmentId: apptId, actor: { kind: 'patient', name: 'Patient' },
                              summary: 'Confirmed by choosing a payment method', oldStatus: 'approved', newStatus: 'confirmed' });
        }
      });
      return { status: 200, body: await view(db, cfg, whish, apptId) };
    });
    return send(reply, res);
  });

  app.post('/api/payment-selection/:token/reschedule', limit, async (req, reply) => {
    checkOrigin(cfg, req);
    const tok = (req.params as { token: string }).token;
    const apptId = await resolveLink(db, tok);
    const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
    const res = await idempotent(db, req, 'reschedule:' + sha256(tok), async () => {
      await db.tx(async (t) => {
        const row = await t.one<any>(`select a.status, a.local_date, a.local_time, pi.method
                                         from rayhab.appointments a join rayhab.payment_intents pi on pi.appointment_id = a.id
                                        where a.id = $1 for update`, [apptId]);
        if (!row || row.status !== 'reschedule_requested') throw E.conflict('appointment_closed', 'There is no new time waiting for an answer.');
        if (accept) {
          const next = row.method ? 'confirmed' : 'approved';
          await t.query(`update rayhab.appointments set status = $2, hold_expires_at = null, updated_at = now() where id = $1`, [apptId, next]);
          await logEvent(t, { type: 'reschedule_accepted', appointmentId: apptId, actor: { kind: 'patient', name: 'Patient' },
                              summary: 'Accepted ' + T.dayLabel(row.local_date) + ' ' + row.local_time, oldStatus: row.status, newStatus: next });
        } else {
          await t.query(`update rayhab.appointments set status = 'requested', hold_expires_at = now() + make_interval(hours => $2),
                                updated_at = now() where id = $1`, [apptId, cfg.HOLD_HOURS]);
          await logEvent(t, { type: 'reschedule_rejected', appointmentId: apptId, actor: { kind: 'patient', name: 'Patient' },
                              summary: 'Asked for another time', oldStatus: row.status, newStatus: 'requested' });
          await staffNotice(t, cfg, apptId, 'reschedule_rejected');
        }
      });
      return { status: 200, body: await view(db, cfg, whish, apptId) };
    });
    return send(reply, res);
  });

  app.post('/api/payments/whish/create', limit, async (req, reply) => {
    checkOrigin(cfg, req);
    const { token: tok } = parse(z.object({ token: z.string().min(1).max(200) }), req.body);
    const apptId = await resolveLink(db, tok);
    const res = await idempotent(db, req, 'whish:' + sha256(tok), async () => {
      const a = await loadAppointment(db, apptId, null);
      if (!a || !['approved', 'confirmed'].includes(a.status)) throw E.conflict('appointment_closed', 'This appointment is no longer active.');
      if (a.payment.status === 'paid') throw E.conflict('already_paid', 'This appointment is already paid.');
      if (a.payment.method !== 'whish') throw E.conflict('method_mismatch', 'Choose Whish first.');
      // A checkout still open from a moment ago is reused, never doubled.
      const open = await db.one<any>(`select checkout_url, created_at from rayhab.payment_transactions
                                       where intent_id = $1 and provider = 'whish' and status = 'pending'
                                         and created_at > now() - interval '15 minutes' order by created_at desc limit 1`, [a.payment.id]);
      if (open && open.checkout_url) {
        return { status: 200, body: { checkout_url: open.checkout_url, expires_at: new Date(new Date(open.created_at).getTime() + 15 * 60000).toISOString() } };
      }
      const returnUrl = new URL('/payment/#t=' + tok + '&r=1', cfg.PUBLIC_ORIGIN).toString();
      const co = await whish.createCheckout({ intentId: a.payment.id, amount: a.payment.outstanding, currency: a.payment.currency,
                                              description: a.service.name + ' ' + a.reference, returnUrl,
                                              idempotencyKey: String(req.headers['idempotency-key'] || id('ik')) });
      await db.tx(async (t) => {
        await t.query(`insert into rayhab.payment_transactions (id, intent_id, provider, status, amount, currency, external_ref, checkout_url)
                       values ($1, $2, 'whish', 'pending', $3, $4, $5, $6)`,
                      [id('tx'), a.payment.id, a.payment.outstanding, a.payment.currency, co.externalRef, co.checkoutUrl]);
        await logEvent(t, { type: 'checkout_started', appointmentId: apptId, actor: { kind: 'patient', name: 'Patient' }, summary: 'Whish checkout started' });
      });
      return { status: 200, body: { checkout_url: co.checkoutUrl, expires_at: iso(co.expiresAt) } };
    });
    return send(reply, res);
  });

  /* Whish's callback. Authenticated by the driver; the body is read raw so
     a signature can be checked over exactly what was sent. */
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/api/webhooks/whish', async (req, reply) => {
      const parsed = await whish.parseWebhook(req.headers, String(req.body || ''));
      if (!parsed) throw new ApiError(401, 'unauthenticated', 'Callback not authenticated.');
      await settleWhish(db, cfg, parsed.externalRef, parsed.status);
      return reply.code(200).send({ ok: true });
    });
  });

  if (whish.name === 'sandbox') {
    const pendingRef = (ref: string) => db.one(`select id from rayhab.payment_transactions
                                                 where external_ref = $1 and provider = 'whish' and status = 'pending'`, [ref]);
    app.get('/api/payments/whish/sandbox/:ref', async (req, reply) => {
      const { ref } = req.params as { ref: string };
      const q = req.query as Record<string, string>;
      if (!(await pendingRef(ref))) return reply.code(404).type('text/html').send('<p>Unknown or finished sandbox payment.</p>');
      const amount = q.currency === 'USD' ? '$' + (Number(q.amount) / 100).toFixed(2) : q.currency + ' ' + q.amount;
      const ret = String(q.return || '');
      const form = (outcome: string, label: string) =>
        `<form method="post"><input type="hidden" name="outcome" value="${outcome}"><input type="hidden" name="return" value="${escapeHtml(ret)}"><button>${label}</button></form>`;
      return reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Whish sandbox</title><style>body{font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px}
        button{display:block;width:100%;margin:10px 0;padding:14px;font:inherit;border-radius:10px;border:1px solid #888;cursor:pointer}
        .k{color:#6B4A07;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:12px}</style>
        <p class="k">Whish sandbox, not a real payment</p><h1>${escapeHtml(amount)}</h1>
        ${form('verified', 'Pay (Whish confirms it)')}${form('failed', 'Payment fails')}${form('abandoned', 'Close without paying')}`);
    });
    app.post('/api/payments/whish/sandbox/:ref', async (req, reply) => {
      const { ref } = req.params as { ref: string };
      const b = (req.body || {}) as Record<string, string>;
      if (!(await pendingRef(ref)) || !['verified', 'failed', 'abandoned'].includes(b.outcome)) return reply.code(400).send('bad request');
      await db.query(`update rayhab.payment_transactions set raw = jsonb_build_object('sandbox_outcome', $2::text)
                       where external_ref = $1 and status = 'pending'`, [ref, b.outcome]);
      // Like Whish, send the patient back; the worker learns the outcome by asking.
      const back = String(b.return || '');
      return reply.redirect(back.startsWith(cfg.PUBLIC_ORIGIN) ? back : '/', 303);
    });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
