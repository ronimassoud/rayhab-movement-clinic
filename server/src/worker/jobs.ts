/* The background worker's jobs. Each is safe to run twice and safe to run
   on two machines at once (rows are claimed with FOR UPDATE SKIP LOCKED, or
   updated with conditions that only one run can meet).

     deliver     send due outbox messages; retry with backoff; give up after 8
     expireHolds requests nobody answered in time, and unanswered new times
     reconcile   ask Whish about payments still pending after a minute
     remind      WhatsApp reminder about 24 hours before a confirmed visit
     sweep       remove expired sessions, sign-in steps and idempotency keys */
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/db.js';
import type { Mailer, WhatsApp } from '../integrations/messaging.js';
import { SendError } from '../integrations/messaging.js';
import type { WhishDriver } from '../integrations/whish.js';
import { logEvent } from '../services/records.js';
import { whatsapp as queueWhatsApp, type WaTemplate } from '../services/notify.js';
import { settleWhish } from '../services/payments.js';
import { T, unseal } from '../lib/util.js';

export interface WorkerDeps { cfg: Config; db: Db; wa: WhatsApp; mail: Mailer; whish: WhishDriver; log: FastifyBaseLogger }

const MAX_ATTEMPTS = 8;
const backoff = (n: number) => Math.min(60 * 2 ** (n - 1), 6 * 3600);   // 1 min, 2, 4 … capped at 6 h

export async function deliver({ cfg, db, wa, mail, log }: WorkerDeps, batch = 10): Promise<number> {
  const rows = await db.tx((t) => t.query<any>(`
    update rayhab.notification_outbox set status = 'sending', attempts = attempts + 1
     where id in (select id from rayhab.notification_outbox
                   where status in ('pending', 'failed') and next_attempt_at <= now()
                   order by id limit $1 for update skip locked)
     returning id, channel, template, recipient, payload, attempts`, [batch]));
  for (const r of rows) {
    const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    try {
      let res;
      if (r.channel === 'whatsapp') {
        const link = payload.link_sealed ? unseal(cfg.APP_SECRET, payload.link_sealed) : undefined;
        res = await wa.sendTemplate(r.recipient, r.template as WaTemplate, payload.params || [], link);
      } else {
        res = await mail.send(r.recipient, payload.subject, payload.text, payload.reply_to);
      }
      // Sent: the sealed link is no longer needed in the outbox.
      delete payload.link_sealed;
      await db.query(`update rayhab.notification_outbox set status = $2, sent_at = now(), provider_message_id = $3, payload = $4, last_error = null
                       where id = $1`, [r.id, res.skipped ? 'skipped' : 'sent', res.providerMessageId || null, JSON.stringify(payload)]);
    } catch (e) {
      const retry = !(e instanceof SendError) || e.retry;
      const dead = !retry || r.attempts >= MAX_ATTEMPTS;
      await db.query(`update rayhab.notification_outbox set status = $2, last_error = $3,
                             next_attempt_at = now() + make_interval(secs => $4) where id = $1`,
                     [r.id, dead ? 'dead' : 'failed', String((e as Error).message).slice(0, 500), backoff(r.attempts)]);
      log[dead ? 'error' : 'warn']({ id: r.id, template: r.template, attempts: r.attempts, err: (e as Error).message }, dead ? 'message given up' : 'message will be retried');
    }
  }
  return rows.length;
}

export async function expireHolds({ db }: WorkerDeps): Promise<number> {
  return db.tx(async (t) => {
    const gone = await t.query<{ id: string; status: string }>(`
      update rayhab.appointments a set status = 'expired', updated_at = now()
        from (select id, status from rayhab.appointments
               where status in ('requested', 'reschedule_requested') and hold_expires_at < now() for update skip locked) old
       where a.id = old.id returning a.id, old.status`);
    for (const g of gone) {
      await t.query('update rayhab.payment_links set revoked_at = now() where appointment_id = $1 and revoked_at is null', [g.id]);
      await logEvent(t, { type: 'expired', appointmentId: g.id, actor: { kind: 'system', name: 'System' },
                          summary: g.status === 'requested' ? 'Not answered in time; the time was released' : 'The new time was not accepted in time',
                          oldStatus: g.status, newStatus: 'expired' });
    }
    return gone.length;
  });
}

export async function reconcile(deps: WorkerDeps): Promise<number> {
  const { db, cfg, whish } = deps;
  if (whish.name === 'disabled') return 0;
  const pending = await db.query<{ external_ref: string; created_at: Date }>(`
    select external_ref, created_at from rayhab.payment_transactions
     where provider = 'whish' and status = 'pending' and external_ref is not null
       and updated_at < now() - interval '${whish.name === 'sandbox' ? '2 seconds' : '1 minute'}'
     order by created_at limit 20`);
  let settled = 0;
  for (const p of pending) {
    let status = await whish.fetchStatus(p.external_ref);
    // A checkout nobody finished in two hours is treated as left unpaid.
    if (status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 2 * 3600000) status = 'abandoned';
    if (await settleWhish(db, cfg, p.external_ref, status)) settled++;
  }
  return settled;
}

export async function remind({ db, cfg }: WorkerDeps): Promise<number> {
  const due = await db.query<any>(`
    select a.id, a.reference, a.local_date, a.local_time, a.mode, a.consent_whatsapp_at, s.name as service_name, p.phone_e164
      from rayhab.appointments a join rayhab.services s on s.id = a.service_id join rayhab.patients p on p.id = a.patient_id
     where a.status = 'confirmed' and a.reminded_at is null
       and a.starts_at between now() + interval '20 hours' and now() + interval '28 hours'`);
  for (const a of due) {
    await db.tx(async (t) => {
      await queueWhatsApp(t, cfg, a, 'reminder', [a.service_name, T.dayLabel(a.local_date, true), a.local_time,
        a.mode === 'online' ? 'Online, video call' : cfg.CLINIC_LOCATION], { dedupe: 'reminder:' + a.id });
      await t.query('update rayhab.appointments set reminded_at = now() where id = $1', [a.id]);
    });
  }
  return due.length;
}

export async function sweep({ db }: WorkerDeps) {
  await db.query(`delete from rayhab.staff_sessions where expires_at < now()`);
  await db.query(`delete from rayhab.auth_pending where expires_at < now()`);
  await db.query(`delete from rayhab.idempotency_keys where created_at < now() - interval '2 days'`);
}

/* The loop: messages every few seconds, the rest on their own rhythm. */
export function startWorker(deps: WorkerDeps, opts: { tickMs?: number } = {}) {
  const tick = opts.tickMs ?? 5000;
  let stopped = false, n = 0, running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await deliver(deps);
      if (n % 2 === 0) await reconcile(deps);
      if (n % 12 === 0) await expireHolds(deps);
      if (n % 120 === 0) await remind(deps);
      if (n % 720 === 0) await sweep(deps);
    } catch (e) {
      deps.log.error({ err: e }, 'worker tick failed');
    } finally { n++; running = false; }
  };
  const timer = setInterval(run, tick);
  run();
  return { stop: () => { stopped = true; clearInterval(timer); } };
}
