/* The clinic admin's API (README.md, "API contracts: clinic admin").
   Every route needs a signed-in staff session; every change also needs the
   CSRF token and the site's Origin (lib/http.ts requireStaff), and returns
   the record as the database now holds it. */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { E } from '../lib/errors.js';
import { can, idempotent, LOGIN_URL, LOGOUT_URL, parse, requireStaff, send, type Staff } from '../lib/http.js';
import { id, moneyText, T } from '../lib/util.js';
import { PG, pgCode } from '../db/db.js';
import { APPT_SELECT, loadAppointment, logEvent, paymentRow, permissions, shape } from '../services/records.js';
import { instants, LIVE, slotsFor } from '../services/scheduling.js';
import { issueLink } from '../services/links.js';
import { whatsapp } from '../services/notify.js';
import { afterCredit } from '../services/payments.js';

const ACTIONS: Record<string, string[]> = {
  approve: ['requested'],
  decline: ['requested'],
  reschedule: ['requested', 'approved', 'confirmed'],
  cancel: ['approved', 'confirmed', 'reschedule_requested'],
  complete: ['confirmed'],
  no_show: ['confirmed']
};

function pageArgs(q: Record<string, string>) {
  const size = Math.min(Math.max(parseInt(q.page_size, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { size, page, offset: (page - 1) * size };
}

async function messageRow(t: Db, apptId: string) {
  return t.one<any>(`select a.id, a.reference, a.local_date, a.local_time, a.mode, a.consent_whatsapp_at, a.starts_at,
                            s.name as service_name, p.phone_e164
                       from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                       join rayhab.patients p on p.id = a.patient_id where a.id = $1`, [apptId]);
}

export function adminRoutes(app: FastifyInstance, { cfg, db }: Deps) {
  const staffOf = (req: any) => requireStaff(db, cfg, req);

  app.get('/api/admin/session', async (req) => {
    const s = await staffOf(req);
    return {
      user: { id: s.id, name: s.name, role: s.role },
      practitioners: await db.query('select id, name, title from rayhab.practitioners where active order by name'),
      services: await db.query('select id, name from rayhab.services where active order by sort'),
      permissions: permissions(s.role),
      csrf_token: s.csrf,
      login_url: LOGIN_URL,
      logout_url: LOGOUT_URL,
      timezone: T.TZ
    };
  });

  app.get('/api/admin/overview', async (req) => {
    const s = await staffOf(req);
    const today = T.today();
    const todays = await db.query(APPT_SELECT + ` where a.local_date = $1 and a.status = any($2) order by a.starts_at`,
                                  [today, ['approved', 'confirmed', 'completed', 'reschedule_requested']]);
    const counts = await db.one<any>(`select
        (select count(*)::int from rayhab.appointments where status = 'requested') as requested,
        (select count(*)::int from rayhab.appointments a join rayhab.payment_intents pi on pi.appointment_id = a.id
          where pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed', 'completed')) as awaiting_payment`);
    const outstanding = await db.query<{ currency: string; amount: number }>(`
      select pi.currency, sum(pi.outstanding)::int as amount from rayhab.payment_intents pi join rayhab.appointments a on a.id = pi.appointment_id
       where pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed', 'completed') group by pi.currency`);
    const received = await db.query<{ currency: string; amount: number }>(`
      select currency, sum(amount)::int as amount from rayhab.payment_transactions
       where status = 'verified' and updated_at > now() - interval '7 days' group by currency`);
    const alerts: { level: string; text: string; appointment_id: string }[] = [];
    for (const r of await db.query<any>(`select a.id, a.reference, p.first_name, p.last_name from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id
                                          where a.status = 'requested' and a.created_at < now() - interval '1 day' order by a.created_at`)) {
      alerts.push({ level: 'warn', text: r.reference + ' (' + r.first_name + ' ' + r.last_name + ') has waited more than a day for a reply.', appointment_id: r.id });
    }
    for (const r of await db.query<any>(`select a.id, a.reference from rayhab.appointments a where a.status = 'requested'
                                          and a.hold_expires_at < now() + interval '3 hours' and a.created_at >= now() - interval '1 day'`)) {
      alerts.push({ level: 'warn', text: r.reference + ': the hold on this time ends within 3 hours. Reply before it lapses.', appointment_id: r.id });
    }
    for (const r of await db.query<any>(`select distinct a.id, a.reference from rayhab.payment_transactions t
                                          join rayhab.payment_intents pi on pi.id = t.intent_id join rayhab.appointments a on a.id = pi.appointment_id
                                         where t.status = 'failed' and pi.status = 'awaiting_payment' and a.status in ('approved', 'confirmed')`)) {
      alerts.push({ level: 'info', text: r.reference + ': a Whish payment failed. The patient can retry from their link.', appointment_id: r.id });
    }
    return {
      date: today, timezone: T.TZ,
      counts: { today: todays.length, requested: counts.requested, awaiting_payment: counts.awaiting_payment },
      outstanding, received_7d: received,
      today: await shape(db, todays, s.role),
      alerts
    };
  });

  app.get('/api/admin/appointments', async (req) => {
    const s = await staffOf(req);
    const q = req.query as Record<string, string>;
    const where: string[] = [], params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };
    if (q.status) add('a.status = any(?)', q.status.split(',').filter(Boolean));
    if (q.practitioner_id) add('a.practitioner_id = ?', q.practitioner_id);
    if (q.payment_method === 'none') where.push('pi.method is null');
    else if (q.payment_method) add('pi.method = ?', q.payment_method);
    if (q.date_from) add('a.local_date >= ?', q.date_from);
    if (q.date_to) add('a.local_date <= ?', q.date_to);
    if (q.q) {
      params.push('%' + q.q.trim().toLowerCase().replace(/[%_]/g, '') + '%');
      const n = '$' + params.length;
      where.push(`(lower(pt.first_name || ' ' || pt.last_name) like ${n} or lower(a.reference) like ${n}
                   or pt.phone_e164 like ${n} or lower(coalesce(pt.email, '')) like ${n})`);
    }
    const w = where.length ? ' where ' + where.join(' and ') : '';
    const { size, page, offset } = pageArgs(q);
    const total = await db.one<{ n: number }>(`select count(*)::int as n from (${APPT_SELECT}${w}) x`, params);
    const order = q.sort === 'created' ? 'a.created_at' : 'a.starts_at';
    const rows = await db.query(APPT_SELECT + w + ` order by ${order} limit ${size} offset ${offset}`, params);
    return { items: await shape(db, rows, s.role), page, page_size: size, total: total!.n };
  });

  app.get('/api/admin/appointments/:id', async (req) => {
    const s = await staffOf(req);
    const a = await loadAppointment(db, (req.params as { id: string }).id, s.role);
    if (!a) throw E.notFound('No such appointment.');
    const events = await db.query<any>(`select id, at, type, actor_kind, actor_name, appointment_id, summary from rayhab.events
                                         where appointment_id = $1 order by at desc, id desc`, [a.id]);
    return { appointment: a, events: events.map((e) => eventView(e, a.reference)) };
  });

  // The six appointment actions, one route each.
  for (const [action, path] of Object.entries({ approve: 'approve', decline: 'decline', reschedule: 'reschedule',
                                                cancel: 'cancel', complete: 'complete', no_show: 'no-show' })) {
    app.post('/api/admin/appointments/:id/' + path, async (req, reply) => {
      const s = await staffOf(req);
      const apptId = (req.params as { id: string }).id;
      const res = await idempotent(db, req, 'staff:' + s.id + ':' + action, async () => {
        await act(db, cfg, s, apptId, action, (req.body || {}) as Record<string, unknown>, req.id);
        return { status: 200, body: { appointment: await loadAppointment(db, apptId, s.role) } };
      });
      return send(reply, res);
    });
  }

  app.get('/api/admin/availability', async (req) => {
    await staffOf(req);
    const q = req.query as Record<string, string>;
    const hours = await db.query<any>(`select weekday, start_time, end_time from rayhab.working_hours
                                        where ($1::text is null or practitioner_id = $1) order by weekday, start_time`, [q.practitioner_id || null]);
    const byDay = new Map<number, { start: string; end: string }[]>();
    for (const h of hours) {
      if (!byDay.has(h.weekday)) byDay.set(h.weekday, []);
      byDay.get(h.weekday)!.push({ start: h.start_time, end: h.end_time });
    }
    const exceptions = await db.query<any>(`select id, practitioner_id, local_date as date, start_time as start, end_time as "end", reason
                                              from rayhab.schedule_exceptions
                                             where ($1::text is null or local_date >= $1) and ($2::text is null or local_date <= $2)
                                               and ($3::text is null or practitioner_id = $3) order by local_date, start_time`,
                                           [q.from || null, q.to || null, q.practitioner_id || null]);
    return { timezone: T.TZ, working_hours: [...byDay.entries()].map(([weekday, blocks]) => ({ weekday, blocks })), exceptions };
  });

  const Block = z.object({
    practitioner_id: z.string().nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'),
    start: z.string().regex(/^[0-2]\d:[0-5]\d$/, 'Choose a start time.'),
    end: z.string().regex(/^[0-2]\d:[0-5]\d$/, 'Choose an end time.'),
    reason: z.string().max(120).optional().default('')
  }).refine((b) => b.end > b.start, { message: 'End after the start time.', path: ['end'] });

  app.patch('/api/admin/availability', async (req, reply) => {
    const s = await staffOf(req);
    can(s, 'manage_schedule');
    const body = parse(z.object({ add: z.array(Block).max(20).optional().default([]), remove: z.array(z.string()).max(50).optional().default([]) }), req.body);
    const res = await idempotent(db, req, 'staff:' + s.id + ':schedule', async () => {
      await db.tx(async (t) => {
        for (const b of body.add) {
          const pid = b.practitioner_id || (await t.one<{ id: string }>(`select id from rayhab.practitioners where active and bookable order by created_at limit 1`))!.id;
          await t.query(`insert into rayhab.schedule_exceptions (id, practitioner_id, local_date, start_time, end_time, reason, created_by)
                         values ($1, $2, $3, $4, $5, $6, $7)`, [id('ex'), pid, b.date, b.start, b.end, b.reason, s.id]);
          await logEvent(t, { type: 'time_blocked', actor: { kind: 'staff', id: s.id, name: s.name },
                              summary: 'Blocked ' + T.dayLabel(b.date) + ' ' + b.start + '–' + b.end + (b.reason ? ' (' + b.reason + ')' : '') });
        }
        for (const exId of body.remove) {
          const gone = await t.query<any>('delete from rayhab.schedule_exceptions where id = $1 returning local_date, start_time, end_time', [exId]);
          if (gone.length) await logEvent(t, { type: 'block_removed', actor: { kind: 'staff', id: s.id, name: s.name },
                                               summary: 'Removed the block on ' + T.dayLabel(gone[0].local_date) + ' ' + gone[0].start_time + '–' + gone[0].end_time });
        }
      });
      const exceptions = await db.query(`select id, practitioner_id, local_date as date, start_time as start, end_time as "end", reason
                                           from rayhab.schedule_exceptions where local_date >= $1 order by local_date, start_time`, [T.today()]);
      return { status: 200, body: { exceptions } };
    });
    return send(reply, res);
  });

  app.get('/api/admin/payments', async (req) => {
    const s = await staffOf(req);
    const q = req.query as Record<string, string>;
    const where = [`(pi.method is not null or a.status in ('approved', 'confirmed'))`], params: unknown[] = [];
    if (q.status) { params.push(q.status); where.push('pi.status = $' + params.length); }
    if (q.payment_method === 'none') where.push('pi.method is null');
    else if (q.payment_method) { params.push(q.payment_method); where.push('pi.method = $' + params.length); }
    const w = ' where ' + where.join(' and ');
    const { size, page, offset } = pageArgs(q);
    const total = await db.one<{ n: number }>(`select count(*)::int as n from (${APPT_SELECT}${w}) x`, params);
    const rows = await db.query(APPT_SELECT + w + ` order by pi.updated_at desc limit ${size} offset ${offset}`, params);
    return { items: (await shape(db, rows, s.role)).map(paymentRow), page, page_size: size, total: total!.n };
  });

  app.post('/api/admin/payments/:id/confirm-cash', async (req, reply) => {
    const s = await staffOf(req);
    can(s, 'confirm_cash');
    const payId = (req.params as { id: string }).id;
    const b = parse(z.object({
      amount: z.number({ message: 'Enter the amount received.' }).int().positive('Enter the amount received.'),
      currency: z.string(),
      reference: z.string().trim().max(60).nullable().optional()
    }), req.body);
    const res = await idempotent(db, req, 'staff:' + s.id + ':cash', async () => {
      const apptId = await db.tx(async (t) => {
        const row = await t.one<any>(`select pi.id, pi.method, pi.status, pi.currency, pi.outstanding, a.id as appointment_id, a.status as appt_status, a.reference
                                         from rayhab.payment_intents pi join rayhab.appointments a on a.id = pi.appointment_id
                                        where pi.id = $1 for update of pi`, [payId]);
        if (!row) throw E.notFound('No such payment.');
        const offered = row.method === 'cash' && row.status === 'awaiting_payment' && ['approved', 'confirmed', 'completed'].includes(row.appt_status);
        if (!offered) throw E.conflict('already_recorded', row.status === 'paid' ? 'This cash payment is already recorded.' : 'Cash cannot be recorded for this payment.');
        if (b.currency !== row.currency) throw E.validation({ amount: 'Enter the amount received in ' + row.currency + '.' });
        if (b.amount > row.outstanding) throw E.validation({ amount: 'That is more than the ' + moneyText(row.outstanding, row.currency) + ' owed.' });
        const ref = b.reference || 'CASH-' + row.reference.replace(/^RQ-/, '');
        await t.query(`insert into rayhab.payment_transactions (id, intent_id, provider, status, amount, currency, reference, recorded_by)
                       values ($1, $2, 'cash', 'verified', $3, $4, $5, $6)`, [id('tx'), row.id, b.amount, row.currency, ref, s.id]);
        await logEvent(t, { type: 'cash_recorded', appointmentId: row.appointment_id, actor: { kind: 'staff', id: s.id, name: s.name },
                            summary: 'Cash received, ' + moneyText(b.amount, row.currency) +
                                     (b.amount < row.outstanding ? ', ' + moneyText(row.outstanding - b.amount, row.currency) + ' still owed' : ''), requestId: req.id });
        await afterCredit(t, cfg, row.id, b.amount);
        return row.appointment_id as string;
      });
      const a = await loadAppointment(db, apptId, s.role);
      return { status: 200, body: { payment: paymentRow(a!) } };
    });
    return send(reply, res);
  });

  app.get('/api/admin/audit', async (req) => {
    await staffOf(req);
    const q = req.query as Record<string, string>;
    const where: string[] = [], params: unknown[] = [];
    if (q.type) { params.push(q.type); where.push('e.type = $' + params.length); }
    if (q.appointment_id) { params.push(q.appointment_id); where.push('e.appointment_id = $' + params.length); }
    const w = where.length ? ' where ' + where.join(' and ') : '';
    const { size, page, offset } = pageArgs(q);
    const total = await db.one<{ n: number }>(`select count(*)::int as n from rayhab.events e${w}`, params);
    const rows = await db.query<any>(`select e.id, e.at, e.type, e.actor_kind, e.actor_name, e.appointment_id, e.summary, a.reference
                                        from rayhab.events e left join rayhab.appointments a on a.id = e.appointment_id${w}
                                       order by e.at desc, e.id desc limit ${size} offset ${offset}`, params);
    return { items: rows.map((e) => eventView(e, e.reference)), page, page_size: size, total: total!.n };
  });
}

function eventView(e: any, reference: string | null) {
  return { id: 'ev_' + e.id, at: new Date(e.at).toISOString(), type: e.type,
           actor: { kind: e.actor_kind, name: e.actor_name || (e.actor_kind === 'system' ? 'System' : '') },
           appointment_id: e.appointment_id, reference: reference || null, summary: e.summary };
}

/* One staff action on one appointment, in one transaction, with its
   message to the patient written to the outbox. */
async function act(db: Db, cfg: Config, s: Staff, apptId: string, action: string, body: Record<string, unknown>, requestId: string) {
  const actor = { kind: 'staff' as const, id: s.id, name: s.name };
  try {
    await db.tx(async (t) => {
      const a = await t.one<any>(`select a.*, s.name as service_name, s.duration_min, s.price_amount, s.currency as service_currency,
                                         pi.id as pay_id, pi.status as pay_status, pi.method as pay_method
                                    from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                                    join rayhab.payment_intents pi on pi.appointment_id = a.id
                                   where a.id = $1 for update of a`, [apptId]);
      if (!a) throw E.notFound('No such appointment.');
      if (!(ACTIONS[action] || []).includes(a.status)) {
        throw E.conflict('invalid_transition', 'This appointment can no longer be ' + ({ approve: 'approved', decline: 'declined', reschedule: 'moved',
          cancel: 'cancelled', complete: 'marked completed', no_show: 'marked no-show' } as Record<string, string>)[action] + '. It is now ' + a.status.replace('_', ' ') + '.');
      }
      const m = await messageRow(t, apptId);
      const set = (status: string, extra = '') => t.query(`update rayhab.appointments set status = $2, updated_at = now()${extra} where id = $1`, [apptId, status]);
      const log = (type: string, summary: string, next: string) =>
        logEvent(t, { type, appointmentId: apptId, actor, summary, oldStatus: a.status, newStatus: next, requestId });

      if (action === 'approve') {
        if (a.price_amount == null) throw E.conflict('price_missing', 'Set a price for ' + a.service_name + ' before approving, so the patient sees what to pay.');
        if (a.pay_status === 'not_selected') {
          await t.query(`update rayhab.payment_intents set amount = $2, outstanding = $2, currency = $3, updated_at = now() where id = $1`,
                        [a.pay_id, a.price_amount, a.service_currency]);
        }
        if (a.hold_expires_at && new Date(a.hold_expires_at).getTime() < Date.now()) {
          throw E.conflict('hold_expired', 'The hold on this time has lapsed. Propose a time instead.');
        }
        await set('approved', ', hold_expires_at = null');
        const link = await issueLink(t, cfg, apptId, new Date(a.starts_at));
        await log('approved', 'Approved. WhatsApp sent with the payment link', 'approved');
        await whatsapp(t, cfg, m, 'approved', [m.service_name, T.dayLabel(m.local_date, true), m.local_time], { linkToken: link, dedupe: 'approved:' + apptId + ':' + Date.now() });
      } else if (action === 'decline') {
        const b = parse(z.object({ reason: z.string().trim().min(1, 'Choose a reason.').max(120), message: z.string().max(500).nullable().optional() }), body);
        await set('declined', ', hold_expires_at = null');
        await t.query('update rayhab.payment_links set revoked_at = now() where appointment_id = $1 and revoked_at is null', [apptId]);
        await log('declined', 'Declined: ' + b.reason, 'declined');
        await whatsapp(t, cfg, m, 'declined', [m.service_name, (b.message || b.reason)], { dedupe: 'declined:' + apptId });
      } else if (action === 'reschedule') {
        const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'), time: z.string().regex(/^[0-2]\d:[0-5]\d$/, 'Choose a time.'),
                                    message: z.string().max(500).nullable().optional() }), body);
        // Free for this service, counting this appointment's own time as free.
        const slots = await slotsFor(t, cfg, { serviceId: a.service_id, practitionerId: a.practitioner_id, mode: a.mode, date: b.date, excludeId: apptId });
        if (!slots.find((x) => x.time === b.time && x.available)) throw E.conflict('slot_taken', 'That time is not free.');
        const { start, end } = instants(b.date, b.time, a.duration_min);
        await t.query(`update rayhab.appointments set status = 'reschedule_requested', starts_at = $2, ends_at = $3, local_date = $4, local_time = $5,
                              hold_expires_at = now() + make_interval(hours => $6), updated_at = now() where id = $1`,
                      [apptId, start, end, b.date, b.time, cfg.HOLD_HOURS]);
        const link = await issueLink(t, cfg, apptId, start);
        await log('reschedule_proposed', 'New time proposed: ' + T.dayLabel(b.date) + ' ' + b.time, 'reschedule_requested');
        await whatsapp(t, cfg, { ...m, local_date: b.date, local_time: b.time }, 'new_time', [m.service_name, T.dayLabel(b.date, true), b.time],
                       { linkToken: link, dedupe: 'newtime:' + apptId + ':' + b.date + b.time });
      } else if (action === 'cancel') {
        const b = parse(z.object({ reason: z.string().max(500).nullable().optional() }), body);
        await set('cancelled', ', hold_expires_at = null');
        await t.query('update rayhab.payment_links set revoked_at = now() where appointment_id = $1 and revoked_at is null', [apptId]);
        await log('cancelled', 'Cancelled' + (b.reason ? ': ' + b.reason : ''), 'cancelled');
        await whatsapp(t, cfg, m, 'cancelled', [m.service_name, T.dayLabel(m.local_date, true), m.local_time], { dedupe: 'cancelled:' + apptId });
      } else if (action === 'complete') {
        await set('completed');
        await log('completed', 'Marked completed', 'completed');
      } else if (action === 'no_show') {
        await set('no_show');
        await log('no_show', 'Marked no-show', 'no_show');
      }
    });
  } catch (err) {
    if (pgCode(err) === PG.exclusion) throw E.conflict('slot_taken', 'That time is no longer free.');
    throw err;
  }
}

export { LIVE };
