/* Public booking endpoints (README.md, "API contracts: patient booking").

     GET  /api/services
     GET  /api/availability?service_id=&practitioner_id=&mode=&date=
     POST /api/appointments
     POST /api/enquiries */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError, E } from '../lib/errors.js';
import { checkOrigin, idempotent, parse, send } from '../lib/http.js';
import { id } from '../lib/util.js';
import { PG, pgCode } from '../db/db.js';
import { instants, loadService, loadServices, slotsFor } from '../services/scheduling.js';
import { logEvent } from '../services/records.js';
import { staffEmail, whatsapp } from '../services/notify.js';
import { T } from '../lib/util.js';

const name = (what: string) => z.string().trim()
  .min(2, 'That looks too short.').max(80, 'That looks too long.')
  .regex(/[A-Za-zÀ-ɏ؀-ۿ]/, 'Use letters for your ' + what + '.');

const Booking = z.object({
  service_id: z.string().min(1).max(40),
  practitioner_id: z.string().max(40).nullable().optional(),
  for_whom: z.enum(['me', 'child']),
  mode: z.enum(['clinic', 'online']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'),
  time: z.string().regex(/^[0-2]\d:[0-5]\d$/, 'Choose a time.'),
  timezone: z.literal('Asia/Beirut').optional(),
  first_name: name('first name'),
  last_name: name('last name'),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a WhatsApp number with its country code.'),
  email: z.string().trim().max(160).email('Check the email address.').nullable().optional().or(z.literal('')),
  note: z.string().max(2000, 'Keep it under 2000 characters.').optional().default(''),
  consents: z.object({
    storage: z.literal(true, { message: 'Consent is required.' }),
    whatsapp: z.literal(true, { message: 'Consent is required.' }),
    version: z.string().min(1).max(40)
  }, { message: 'Consent is required.' }),
  website: z.string().optional(),
  elapsed_ms: z.number().optional()
});

const Enquiry = z.object({
  first_name: name('first name'),
  last_name: name('last name'),
  email: z.string().trim().max(160).email('Check the email address.'),
  phone: z.string().max(40).optional().or(z.literal('')).refine((v) => !v || /^[0-9+()\-\s]{8,30}$/.test(v), 'Check the number.'),
  message: z.string().trim().min(10, 'Add a little more detail.').max(2000, 'Keep it under 2000 characters.'),
  website: z.string().optional(),
  elapsed_ms: z.number().optional()
});

export function publicRoutes(app: FastifyInstance, { cfg, db }: Deps) {
  app.get('/api/services', async () => {
    const services = await loadServices(db);
    const practitioners = await db.query(`select id, name, title from rayhab.practitioners
                                           where active and bookable order by name`);
    return {
      services: services.map((s) => ({
        id: s.id, name: s.name, description: s.description, tag: s.tag, duration_min: s.duration_min,
        price: s.price_amount == null ? null : { amount: s.price_amount, currency: s.currency },
        modes: s.modes, practitioner_ids: s.practitioner_ids
      })),
      practitioners,
      timezone: T.TZ
    };
  });

  app.get('/api/availability', async (req) => {
    const q = req.query as Record<string, string>;
    const mode = q.mode === 'online' ? 'online' : 'clinic';
    const slots = await slotsFor(db, cfg, { serviceId: q.service_id, practitionerId: q.practitioner_id || null, mode, date: q.date });
    return {
      date: q.date, service_id: q.service_id, practitioner_id: q.practitioner_id || null, mode, timezone: T.TZ,
      slots: slots.map((s) => ({ time: s.time, available: s.available }))
    };
  });

  app.post('/api/appointments', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    checkOrigin(cfg, req);
    const res = await idempotent(db, req, 'appointments', async () => {
      const raw = (req.body || {}) as Record<string, unknown>;
      if (raw.website) throw E.rejected();
      const b = parse(Booking, raw);
      if (typeof b.elapsed_ms === 'number' && b.elapsed_ms < 3000) req.log.warn({ elapsed: b.elapsed_ms }, 'booking sent very fast');

      // At most five requests a day from one number.
      const recent = await db.one<{ n: number }>(`
        select count(*)::int as n from rayhab.appointments a join rayhab.patients p on p.id = a.patient_id
         where p.phone_e164 = $1 and a.created_at > now() - interval '1 day'`, [b.phone]);
      if (recent && recent.n >= 5) throw new ApiError(429, 'rate_limited', 'Too many requests for this number today.');

      const svc = await loadService(db, b.service_id);
      if (!svc) throw E.validation({ service_id: 'Unknown service.' });
      const slots = await slotsFor(db, cfg, { serviceId: b.service_id, practitionerId: b.practitioner_id, mode: b.mode, date: b.date });
      const slot = slots.find((s) => s.time === b.time);
      if (!slot || !slot.available) throw E.conflict('slot_taken', 'That time is no longer available.');
      const practitionerId = b.practitioner_id && slot.practitioners.includes(b.practitioner_id) ? b.practitioner_id : slot.practitioners[0];
      const { start, end } = instants(b.date, b.time, svc.duration_min);

      try {
        return await db.tx(async (t) => {
          const patient = await t.one<{ id: string }>(`
            insert into rayhab.patients (first_name, last_name, phone_e164, email) values ($1, $2, $3, $4) returning id`,
            [b.first_name, b.last_name, b.phone, b.email || null]);
          const ref = await t.one<{ r: string }>(`select 'RQ-' || nextval('rayhab.reference_seq') as r`);
          const apptId = id('apt');
          const appt = await t.one<any>(`
            insert into rayhab.appointments (id, reference, patient_id, practitioner_id, service_id, mode, for_whom,
              starts_at, ends_at, local_date, local_time, status, note, hold_expires_at,
              consent_storage_at, consent_whatsapp_at, consent_version)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'requested', $12,
                    now() + make_interval(hours => $13), now(), now(), $14)
            returning id, reference, hold_expires_at, consent_whatsapp_at`,
            [apptId, ref!.r, patient!.id, practitionerId, svc.id, b.mode, b.for_whom, start, end, b.date, b.time,
             b.note || '', cfg.HOLD_HOURS, b.consents.version]);
          const amount = svc.price_amount ?? 0;
          await t.query(`insert into rayhab.payment_intents (id, appointment_id, amount, currency, outstanding)
                         values ($1, $2, $3, $4, $3)`, [id('pay'), apptId, amount, svc.currency]);
          await logEvent(t, { type: 'requested', appointmentId: apptId, actor: { kind: 'patient', name: b.first_name + ' ' + b.last_name },
                              summary: 'Requested ' + svc.name + ' for ' + T.dayLabel(b.date) + ' ' + b.time, newStatus: 'requested', requestId: req.id });
          const msg = { id: apptId, reference: ref!.r, service_name: svc.name, local_date: b.date, local_time: b.time,
                        mode: b.mode, phone_e164: b.phone, consent_whatsapp_at: appt.consent_whatsapp_at };
          await whatsapp(t, cfg, msg, 'request_received', [svc.name, T.dayLabel(b.date, true), b.time], { dedupe: 'received:' + apptId });
          await staffEmail(t, cfg, msg, 'new_request');
          return { status: 201, body: { status: 'requested', id: apptId, reference: ref!.r, hold_expires_at: appt.hold_expires_at } };
        });
      } catch (err) {
        if (pgCode(err) === PG.exclusion) throw E.conflict('slot_taken', 'That time is no longer available.');
        throw err;
      }
    });
    return send(reply, res);
  });

  app.post('/api/enquiries', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    checkOrigin(cfg, req);
    const res = await idempotent(db, req, 'enquiries', async () => {
      const raw = (req.body || {}) as Record<string, unknown>;
      if (raw.website) throw E.rejected();
      const b = parse(Enquiry, raw);
      await db.tx(async (t) => {
        await t.query(`insert into rayhab.enquiries (first_name, last_name, email, phone, message) values ($1, $2, $3, $4, $5)`,
                      [b.first_name, b.last_name, b.email, b.phone || null, b.message]);
        // The question goes to the clinic's inbox, so it can be answered by
        // replying. Health details may be in it: the inbox is the clinic's own.
        for (const to of cfg.STAFF_EMAILS) {
          await t.query(`insert into rayhab.notification_outbox (channel, template, recipient, payload) values ('email', 'enquiry', $1, $2)`,
            [to, JSON.stringify({ subject: 'Website question from ' + b.first_name + ' ' + b.last_name,
                                  text: b.message + '\n\n— ' + b.first_name + ' ' + b.last_name + ', ' + b.email + (b.phone ? ', ' + b.phone : '') + '\n',
                                  reply_to: b.email })]);
        }
      });
      return { status: 201, body: { status: 'received' } };
    });
    return send(reply, res);
  });
}
