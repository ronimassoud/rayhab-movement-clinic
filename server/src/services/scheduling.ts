/* Which times can be requested.

   Built from the database: each practitioner's working hours for the
   weekday, minus their blocked times, minus every live appointment.
   A slot is a start time on the service's own grid (the same grid the
   booking page used before the API existed). The database's exclusion
   constraint stays the final word: if two requests race for one slot,
   one of them is refused there. */
import type { Db } from '../db/db.js';
import type { Config } from '../config.js';
import { T } from '../lib/util.js';
import { E } from '../lib/errors.js';

export const LIVE = ['requested', 'approved', 'confirmed', 'reschedule_requested'];

export interface Service {
  id: string; name: string; description: string; tag: string; duration_min: number; buffer_min: number;
  price_amount: number | null; currency: string; modes: string[]; practitioner_ids: string[];
}

export async function loadServices(db: Db): Promise<Service[]> {
  return db.query<Service>(`
    select s.id, s.name, s.description, s.tag, s.duration_min, s.buffer_min, s.price_amount, s.currency, s.modes,
           coalesce(array_agg(sp.practitioner_id order by sp.practitioner_id)
                    filter (where p.id is not null), '{}') as practitioner_ids
      from rayhab.services s
      left join rayhab.service_practitioners sp on sp.service_id = s.id
      left join rayhab.practitioners p on p.id = sp.practitioner_id and p.active and p.bookable
     where s.active
     group by s.id
     order by s.sort, s.name`);
}

export async function loadService(db: Db, id: string): Promise<Service | undefined> {
  return (await loadServices(db)).find((s) => s.id === id);
}

export interface Slot { time: string; available: boolean; practitioners: string[] }

export function bookableWindow(cfg: Config, now = Date.now()) {
  const today = T.today(now);
  return { first: T.addDays(today, cfg.LEAD_DAYS), last: T.addDays(today, cfg.HORIZON_DAYS) };
}

/* The slots for one service on one Beirut day. `practitionerId` empty means
   "any": a time is free if any practitioner who offers the service is. */
export async function slotsFor(db: Db, cfg: Config, q: {
  serviceId: string; practitionerId?: string | null; mode: string; date: string; now?: number;
  excludeId?: string;   // an appointment being moved: its own current time counts as free
}): Promise<Slot[]> {
  const svc = await loadService(db, q.serviceId);
  if (!svc) throw E.validation({ service_id: 'Unknown service.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw E.validation({ date: 'Use yyyy-mm-dd.' });
  if (svc.modes.indexOf(q.mode) < 0) return [];
  const win = bookableWindow(cfg, q.now);
  if (q.date < win.first || q.date > win.last) return [];

  let pracs = svc.practitioner_ids;
  if (q.practitionerId) pracs = pracs.filter((p) => p === q.practitionerId);
  if (!pracs.length) return [];

  const weekday = T.dow(q.date);
  const hours = await db.query<{ practitioner_id: string; start_time: string; end_time: string }>(
    `select practitioner_id, start_time, end_time from rayhab.working_hours
      where weekday = $1 and practitioner_id = any($2) order by start_time`, [weekday, pracs]);
  const busy = await db.query<{ practitioner_id: string; local_time: string; mins: number }>(
    `select practitioner_id, local_time, (extract(epoch from ends_at - starts_at) / 60)::int as mins
       from rayhab.appointments
      where local_date = $1 and practitioner_id = any($2) and status = any($3) and id <> $4`, [q.date, pracs, LIVE, q.excludeId || '']);
  const blocked = await db.query<{ practitioner_id: string; start_time: string; end_time: string }>(
    `select practitioner_id, start_time, end_time from rayhab.schedule_exceptions
      where local_date = $1 and practitioner_id = any($2)`, [q.date, pracs]);

  const dur = svc.duration_min, buf = svc.buffer_min || 0;
  const byTime = new Map<string, Slot>();
  for (const p of pracs) {
    const ranges: [number, number][] = [
      ...busy.filter((b) => b.practitioner_id === p).map((b) => [T.toMin(b.local_time), T.toMin(b.local_time) + b.mins + buf] as [number, number]),
      ...blocked.filter((b) => b.practitioner_id === p).map((b) => [T.toMin(b.start_time), T.toMin(b.end_time)] as [number, number])
    ];
    for (const h of hours.filter((x) => x.practitioner_id === p)) {
      for (let t = T.toMin(h.start_time); t + dur <= T.toMin(h.end_time); t += dur + buf) {
        const label = T.fromMin(t);
        const free = !ranges.some(([a, b]) => t < b && t + dur > a);
        const slot = byTime.get(label) || { time: label, available: false, practitioners: [] };
        if (free) { slot.available = true; slot.practitioners.push(p); }
        byTime.set(label, slot);
      }
    }
  }
  return [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}

/* Start and end instants for a Beirut day and wall time. */
export function instants(date: string, time: string, minutes: number) {
  const start = T.toUtc(date, time);
  return { start: new Date(start), end: new Date(start + minutes * 60000) };
}
