/* Messages, written to the outbox in the same transaction as the change
   that causes them. The worker delivers them (src/worker.ts); nothing is
   sent from inside a database transaction.

   WhatsApp goes only to patients who ticked the WhatsApp consent. A link
   token in a message is stored sealed, and removed once the message has
   been sent, so the outbox never holds a working link in the clear. */
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { seal, T } from '../lib/util.js';

/* The WhatsApp templates to submit to Meta (exact wording in
   docs/production-runbook.md). Parameters are positional: {{1}}, {{2}}, … */
export const WA_TEMPLATES = {
  request_received: 'rayhab_request_received',     // service, day, time
  approved: 'rayhab_approved_choose_payment',       // service, day, time; URL button: payment link
  declined: 'rayhab_request_declined',              // service, reason
  new_time: 'rayhab_new_time_proposed',             // service, new day, new time; URL button: link
  cancelled: 'rayhab_appointment_cancelled',        // service, day, time
  payment_received: 'rayhab_payment_received',      // amount, service, day
  reminder: 'rayhab_appointment_reminder'           // service, day, time, place
} as const;
export type WaTemplate = keyof typeof WA_TEMPLATES;

export interface ApptForMessage {
  id: string; reference: string; service_name: string; local_date: string; local_time: string;
  mode: string; phone_e164: string; consent_whatsapp_at: Date | string | null;
}

export async function whatsapp(db: Db, cfg: Config, a: ApptForMessage, template: WaTemplate,
                               params: string[], opts: { linkToken?: string; dedupe?: string } = {}) {
  if (!a.consent_whatsapp_at) return;
  const payload: Record<string, unknown> = { params };
  if (opts.linkToken) payload.link_sealed = seal(cfg.APP_SECRET, opts.linkToken);
  await db.query(`insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id, dedupe_key)
                  values ('whatsapp', $1, $2, $3, $4, $5) on conflict (dedupe_key) do nothing`,
    [template, a.phone_e164, JSON.stringify(payload), a.id, opts.dedupe || null]);
}

/* Staff email: a reference, the service and the time, and a link to the
   admin. No patient name, number or note: those stay behind the sign-in. */
export async function staffEmail(db: Db, cfg: Config, a: ApptForMessage, kind: 'new_request') {
  for (const to of cfg.STAFF_EMAILS) {
    await db.query(`insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id, dedupe_key)
                    values ('email', $1, $2, $3, $4, $5) on conflict (dedupe_key) do nothing`,
      [kind, to, JSON.stringify({
        subject: 'New booking request ' + a.reference,
        text: 'A new booking request is waiting for your reply.\n\n' +
              a.reference + ': ' + a.service_name + ', ' + T.dayLabel(a.local_date, true) + ' at ' + a.local_time +
              ' (Beirut time), ' + (a.mode === 'online' ? 'online' : 'at the clinic') + '.\n\n' +
              'Review it: ' + new URL('/admin/#/requests', cfg.PUBLIC_ORIGIN).toString() + '\n'
      }), a.id, kind + ':' + a.id + ':' + to]);
  }
}

export function dayText(date: string) { return T.dayLabel(date, true); }

/* A short note to staff that something needs them, by reference only. */
export async function staffNotice(db: Db, cfg: Config, appointmentId: string, kind: 'reschedule_rejected') {
  const a = await db.one<{ reference: string }>('select reference from rayhab.appointments where id = $1', [appointmentId]);
  if (!a) return;
  for (const to of cfg.STAFF_EMAILS) {
    await db.query(`insert into rayhab.notification_outbox (channel, template, recipient, payload, appointment_id)
                    values ('email', $1, $2, $3, $4)`,
      [kind, to, JSON.stringify({
        subject: a.reference + ': the patient asked for another time',
        text: 'The patient did not accept the new time proposed for ' + a.reference + ' and asked for another one.\n\n' +
              'Review it: ' + new URL('/admin/#/requests', cfg.PUBLIC_ORIGIN).toString() + '\n'
      }), appointmentId]);
  }
}
