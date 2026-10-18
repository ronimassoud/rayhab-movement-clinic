/* The clinic's starting data: the services, the practitioner and the
   opening hours the booking page shows today (site/assets/js/booking.js).

   Idempotent: it fills what is missing and never overwrites what staff or
   the clinic have since changed. Prices are left empty on purpose; the
   clinic sets them (runbook, "Prices"), and until then the booking page
   shows none. */
import type { Db } from './db.js';

export const SEED_PRACTITIONER = { id: 'pr-rayan', name: 'Dr. Rayan Halimeh', title: 'Physiotherapist, DPT' };

export const SEED_SERVICES = [
  { id: 'assessment', name: 'Scoliosis assessment', duration: 60, tag: 'Start here', modes: ['clinic', 'online'],
    description: 'First visit. Three-dimensional assessment, movement screen, and the first version of your plan.' },
  { id: 'follow', name: 'Scoliosis rehabilitation session', duration: 45, tag: '', modes: ['clinic', 'online'],
    description: 'Coached corrective exercise and progression. For existing patients.' },
  { id: 'online', name: 'Online scoliosis consultation', duration: 40, tag: '', modes: ['online'],
    description: 'Imaging review, exercise guidance and a remote plan. For patients outside Lebanon.' },
  { id: 'sports', name: 'Sports or general physiotherapy', duration: 45, tag: '', modes: ['clinic', 'online'],
    description: 'Injury rehabilitation, return to sport, mobility and joint training.' },
  { id: 'pain', name: 'Pain management assessment', duration: 60, tag: '', modes: ['clinic', 'online'],
    description: 'Persistent or recurring pain: a full assessment, a clear explanation and a graded plan.' },
  { id: 'pain-follow', name: 'Pain management follow-up', duration: 45, tag: '', modes: ['clinic', 'online'],
    description: 'Coached graded activity, progression and updates to your home program. For existing patients.' }
];

// Closed Sunday and Wednesday; Saturday mornings only (booking.js HOURS).
export const SEED_HOURS: [number, string, string][] = [
  [1, '09:00', '12:00'], [1, '15:00', '18:00'],
  [2, '09:00', '12:00'], [2, '15:00', '18:00'],
  [4, '09:00', '12:00'], [4, '15:00', '18:00'],
  [5, '09:00', '12:00'], [5, '15:00', '18:00'],
  [6, '09:00', '13:00']
];

export async function seed(db: Db, log: (m: string) => void = console.log): Promise<void> {
  await db.tx(async (t) => {
    const p = SEED_PRACTITIONER;
    await t.query(`insert into rayhab.practitioners (id, name, title, role) values ($1, $2, $3, 'admin')
                   on conflict (id) do nothing`, [p.id, p.name, p.title]);
    let sort = 0;
    for (const s of SEED_SERVICES) {
      await t.query(`insert into rayhab.services (id, name, description, tag, duration_min, modes, sort)
                     values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
                    [s.id, s.name, s.description, s.tag, s.duration, s.modes, sort++]);
      await t.query(`insert into rayhab.service_practitioners values ($1, $2) on conflict do nothing`, [s.id, p.id]);
    }
    const has = await t.one<{ n: number }>('select count(*)::int as n from rayhab.working_hours where practitioner_id = $1', [p.id]);
    if (!has || has.n === 0) {
      for (const [d, a, b] of SEED_HOURS) {
        await t.query('insert into rayhab.working_hours (practitioner_id, weekday, start_time, end_time) values ($1, $2, $3, $4)', [p.id, d, a, b]);
      }
    }
  });
  log('seed: services, practitioner and opening hours are present');
}
