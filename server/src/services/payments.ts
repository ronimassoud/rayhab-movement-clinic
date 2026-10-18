/* Settling money. Only two things make a payment paid:
     - a Whish payment the driver reports verified (callback or status query),
     - cash recorded by a staff member with the permission to.
   Both run in a transaction with the payment row locked, and both are
   idempotent: settling something already settled changes nothing. */
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { logEvent } from './records.js';
import { whatsapp } from './notify.js';
import type { WhishStatus } from '../integrations/whish.js';
import { T, moneyText } from '../lib/util.js';

async function messageRow(t: Db, appointmentId: string) {
  return t.one<any>(`select a.id, a.reference, a.local_date, a.local_time, a.mode, a.consent_whatsapp_at,
                            s.name as service_name, p.phone_e164
                       from rayhab.appointments a join rayhab.services s on s.id = a.service_id
                       join rayhab.patients p on p.id = a.patient_id where a.id = $1`, [appointmentId]);
}

/* After money arrives: paid when nothing is owed, then the financial case
   closes. Clinical status is untouched: paid is not completed. */
export async function afterCredit(t: Db, cfg: Config, intentId: string, credited: number) {
  const pi = await t.one<any>(`update rayhab.payment_intents
                                  set outstanding = greatest(outstanding - $2, 0),
                                      status = case when outstanding - $2 <= 0 then 'paid' else status end,
                                      updated_at = now()
                                where id = $1 returning appointment_id, status, amount, currency`, [intentId, credited]);
  if (pi.status === 'paid') {
    const closed = await t.query(`update rayhab.appointments set financial_closed_at = now(), updated_at = now()
                                   where id = $1 and financial_closed_at is null returning id`, [pi.appointment_id]);
    if (closed.length) await logEvent(t, { type: 'financial_closed', appointmentId: pi.appointment_id, actor: { kind: 'system', name: 'System' }, summary: 'Financial case closed' });
    const m = await messageRow(t, pi.appointment_id);
    if (m) await whatsapp(t, cfg, m, 'payment_received', [moneyText(pi.amount, pi.currency), m.service_name, T.dayLabel(m.local_date, true)],
                          { dedupe: 'paid:' + pi.appointment_id });
  }
  return pi;
}

export async function settleWhish(db: Db, cfg: Config, externalRef: string, status: WhishStatus): Promise<boolean> {
  if (status === 'pending') return false;
  return db.tx(async (t) => {
    const tx = await t.one<any>(`select id, intent_id, status, amount, currency from rayhab.payment_transactions
                                  where external_ref = $1 and provider = 'whish' for update`, [externalRef]);
    if (!tx || tx.status !== 'pending') return false;              // unknown, or already settled
    await t.query(`select id from rayhab.payment_intents where id = $1 for update`, [tx.intent_id]);
    await t.query(`update rayhab.payment_transactions set status = $2, reference = case when $2 = 'verified' then external_ref else reference end,
                          updated_at = now() where id = $1`, [tx.id, status]);
    const appt = await t.one<{ appointment_id: string }>('select appointment_id from rayhab.payment_intents where id = $1', [tx.intent_id]);
    if (status === 'verified') {
      await logEvent(t, { type: 'payment_verified', appointmentId: appt!.appointment_id, actor: { kind: 'system', name: 'System' },
                          summary: 'Verified with Whish, ' + moneyText(tx.amount, tx.currency) });
      await afterCredit(t, cfg, tx.intent_id, tx.amount);
    } else {
      await logEvent(t, { type: status === 'failed' ? 'payment_failed' : 'checkout_abandoned', appointmentId: appt!.appointment_id,
                          actor: { kind: 'system', name: 'System' },
                          summary: status === 'failed' ? 'Whish reported the payment failed' : 'Whish checkout closed without paying' });
    }
    return true;
  });
}
