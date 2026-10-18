/* Appointments and payments, shaped exactly as the admin and the payment
   page expect them (README.md, "API contracts: clinic admin"), including
   the actions the server allows on each record. */
import type { Db } from '../db/db.js';
import { iso } from '../lib/util.js';

export type Role = 'admin' | 'practitioner' | 'reception';

export function permissions(role: Role) {
  return { confirm_cash: true, manage_schedule: role !== 'reception' };
}

const ACTIONS: Record<string, string[]> = {
  requested: ['approve', 'decline', 'reschedule'],
  approved: ['reschedule', 'cancel'],
  confirmed: ['reschedule', 'cancel', 'complete', 'no_show'],
  reschedule_requested: ['cancel']
};

export const APPT_SELECT = `
  select a.id, a.reference, a.status, a.mode, a.for_whom, a.starts_at, a.ends_at, a.local_date, a.local_time,
         a.note, a.hold_expires_at, a.financial_closed_at, a.created_at, a.updated_at,
         a.consent_whatsapp_at, a.patient_id,
         s.id as service_id, s.name as service_name, s.duration_min,
         p.id as practitioner_id, p.name as practitioner_name,
         pt.first_name, pt.last_name, pt.phone_e164, pt.email,
         pi.id as pay_id, pi.method as pay_method, pi.status as pay_status, pi.amount as pay_amount,
         pi.currency as pay_currency, pi.outstanding as pay_outstanding, pi.updated_at as pay_updated_at
    from rayhab.appointments a
    join rayhab.services s on s.id = a.service_id
    join rayhab.practitioners p on p.id = a.practitioner_id
    join rayhab.patients pt on pt.id = a.patient_id
    join rayhab.payment_intents pi on pi.appointment_id = a.id`;

interface Tx { id: string; intent_id: string; provider: string; status: string; amount: number; currency: string;
               reference: string | null; external_ref: string | null; created_at: Date; updated_at: Date; recorded_by_name: string | null }

async function transactionsFor(db: Db, intentIds: string[]): Promise<Map<string, Tx[]>> {
  const out = new Map<string, Tx[]>();
  if (!intentIds.length) return out;
  const rows = await db.query<Tx>(`
    select t.id, t.intent_id, t.provider, t.status, t.amount, t.currency, t.reference, t.external_ref,
           t.created_at, t.updated_at, p.name as recorded_by_name
      from rayhab.payment_transactions t left join rayhab.practitioners p on p.id = t.recorded_by
     where t.intent_id = any($1) order by t.created_at`, [intentIds]);
  for (const r of rows) {
    if (!out.has(r.intent_id)) out.set(r.intent_id, []);
    out.get(r.intent_id)!.push(r);
  }
  return out;
}

function payment(row: any, txs: Tx[], role: Role | null) {
  const verified = txs.filter((t) => t.status === 'verified');
  const lastVerified = verified[verified.length - 1];
  const whish = txs.filter((t) => t.provider === 'whish');
  const lastWhish = whish[whish.length - 1];
  const lastCash = verified.filter((t) => t.provider === 'cash').pop();
  const live = ['approved', 'confirmed', 'completed'].indexOf(row.status) >= 0;
  const canCash = !!role && permissions(role).confirm_cash && row.pay_method === 'cash' &&
                  row.pay_status === 'awaiting_payment' && live;
  return {
    id: row.pay_id,
    method: row.pay_method,
    status: row.pay_status,
    amount: row.pay_amount,
    currency: row.pay_currency,
    outstanding: row.pay_outstanding,
    last_attempt: lastWhish ? { status: lastWhish.status === 'verified' ? 'succeeded' : lastWhish.status, at: iso(lastWhish.updated_at) } : null,
    verified_by: row.pay_status === 'paid' && lastVerified ? (lastVerified.provider === 'whish' ? 'whish' : 'cash_receipt') : null,
    receipt_reference: lastVerified ? lastVerified.reference : null,
    recorded_by: lastCash && lastCash.recorded_by_name ? { name: lastCash.recorded_by_name } : null,
    transactions: txs.map((t) => ({ id: t.id, provider: t.provider, status: t.status, amount: t.amount, currency: t.currency,
                                    reference: t.reference, at: iso(t.updated_at) })),
    updated_at: iso(row.pay_updated_at),
    actions: canCash ? ['confirm_cash'] : []
  };
}

export function appointment(row: any, txs: Tx[], role: Role | null) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    service: { id: row.service_id, name: row.service_name, duration_min: row.duration_min },
    practitioner: { id: row.practitioner_id, name: row.practitioner_name },
    mode: row.mode,
    for_whom: row.for_whom,
    start: iso(row.starts_at),
    end: iso(row.ends_at),
    local_date: row.local_date,
    local_time: row.local_time,
    timezone: 'Asia/Beirut',
    patient: { name: (row.first_name + ' ' + row.last_name).trim(), phone: row.phone_e164, email: row.email || null },
    note: row.note || '',
    hold_expires_at: iso(row.hold_expires_at),
    payment: payment(row, txs, role),
    financial_closed_at: iso(row.financial_closed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    actions: role ? (ACTIONS[row.status] || []).slice() : []
  };
}

export async function shape(db: Db, rows: any[], role: Role | null) {
  const txs = await transactionsFor(db, rows.map((r) => r.pay_id));
  return rows.map((r) => appointment(r, txs.get(r.pay_id) || [], role));
}

export async function loadAppointment(db: Db, id: string, role: Role | null) {
  const row = await db.one(APPT_SELECT + ' where a.id = $1', [id]);
  if (!row) return null;
  return (await shape(db, [row], role))[0];
}

export function paymentRow(a: ReturnType<typeof appointment>) {
  return {
    ...a.payment,
    appointment: { id: a.id, reference: a.reference, status: a.status, service_name: a.service.name,
                   local_date: a.local_date, local_time: a.local_time, patient_name: a.patient.name },
    financial_closed_at: a.financial_closed_at
  };
}

export async function logEvent(db: Db, e: {
  type: string; appointmentId?: string | null; actor: { kind: 'staff' | 'patient' | 'system'; id?: string | null; name?: string };
  summary?: string; oldStatus?: string | null; newStatus?: string | null; requestId?: string;
}) {
  await db.query(`insert into rayhab.events (type, appointment_id, actor_kind, actor_id, actor_name, summary, old_status, new_status, request_id)
                  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.type, e.appointmentId || null, e.actor.kind, e.actor.id || null, e.actor.name || '', e.summary || '',
     e.oldStatus || null, e.newStatus || null, e.requestId || null]);
}
